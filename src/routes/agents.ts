import type { FastifyInstance } from "fastify";
import { z } from "zod";
import mammoth from "mammoth";
import { groqChat, extractControlTokens } from "../services/llm.js";
import { pool } from "../db/pool.js";
import { agentRepository, callRepository } from "../db/repositories.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/httpErrors.js";
import { publishAgentEvent, addSseClient } from "../lib/sseHub.js";
import { buildSystemPrompt, defaultBookingEnabled, personaForType } from "../services/promptTemplates.js";
import { provisionPhoneNumber, updateTwilioWebhook } from "../services/twilio.js";
import type { BookingStatus } from "../types/domain.js";

const agentTypeSchema = z.enum(["clinic", "auto", "tech", "other"]);

const generatePromptBody = z.object({
  businessName: z.string().min(2),
  agentName: z.string().min(2).default("Aria"),
  businessType: agentTypeSchema,
  description: z.string().min(10),
  hours: z.string().optional(),
  address: z.string().optional(),
  supportEmail: z.string().email().optional(),
  slaHours: z.number().int().positive().optional()
});

const createAgentBody = generatePromptBody.extend({
  name: z.string().min(2).optional(),
  systemPrompt: z.string().min(20).optional(),
  knowledgeBase: z.string().optional(),
  bookingEnabled: z.boolean().optional(),
  phoneCountry: z.string().default("India"),
  language: z.string().default("en-IN")
});

const updateAgentBody = z.object({
  name: z.string().min(2).optional(),
  systemPrompt: z.string().min(20).optional(),
  knowledgeBase: z.string().optional(),
  bookingEnabled: z.boolean().optional(),
  status: z.enum(["draft", "provisioning", "live", "paused", "archived"]).optional(),
  voice: z.string().optional()
});

const paramsSchema = z.object({
  id: z.string().uuid()
});

const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export async function agentRoutes(app: FastifyInstance) {
  const agents = agentRepository(pool);
  const calls = callRepository(pool);

  app.post("/api/agents/generate-prompt", { preHandler: requireAuth }, async (request) => {
    const body = generatePromptBody.parse(request.body);
    return {
      persona: personaForType(body.businessType),
      bookingEnabled: defaultBookingEnabled(body.businessType),
      systemPrompt: buildSystemPrompt(body)
    };
  });

  app.get("/api/agents", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    return { agents: await agents.listForUser(user.id) };
  });

  app.post("/api/agents", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const body = createAgentBody.parse(request.body);
    const systemPrompt = body.systemPrompt || buildSystemPrompt(body);
    const agent = await agents.create({
      userId: user.id,
      name: body.name || `${body.agentName} ${personaForType(body.businessType)}`,
      businessName: body.businessName,
      businessType: body.businessType,
      persona: personaForType(body.businessType),
      systemPrompt,
      knowledgeBase: body.knowledgeBase,
      bookingEnabled: body.bookingEnabled ?? defaultBookingEnabled(body.businessType),
      phoneCountry: body.phoneCountry,
      language: body.language
    });
    await agents.recordEvent(agent.id, "agent.created", { agentId: agent.id, name: agent.name });
    return reply.code(201).send({ agent });
  });

  app.get("/api/agents/:id", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    return { agent: await agents.getForUser(id, user.id) };
  });

  app.put("/api/agents/:id", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    const agent = await agents.update(id, user.id, body);
    await agents.recordEvent(id, "agent.updated", { agentId: id, promptVersion: agent.promptVersion });
    publishAgentEvent(id, "agent.updated", { agent });
    return { agent };
  });

  app.post("/api/agents/:id/stop", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const agent = await agents.update(id, user.id, { status: "paused" });
    await agents.recordEvent(id, "agent.stopped", { agentId: id });
    publishAgentEvent(id, "agent.updated", { agent });
    return { agent };
  });

  app.post("/api/agents/:id/resume", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const agent = await agents.update(id, user.id, { status: "live" });
    // Auto-update Twilio webhook to route calls to this agent
    updateTwilioWebhook(agent).catch(err => request.log.error(err));
    await agents.recordEvent(id, "agent.resumed", { agentId: id });
    publishAgentEvent(id, "agent.updated", { agent });
    return { agent };
  });

  app.post("/api/agents/:id/provision", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const agent = await agents.getForUser(id, user.id);
    const provisioned = await provisionPhoneNumber(agent);
    const updated = await agents.setProvisioned(id, user.id, provisioned.phoneNumber, provisioned.phoneSid);
    await agents.recordEvent(id, "agent.provisioned", { phoneNumber: updated.twilioPhoneNumber });
    publishAgentEvent(id, "agent.provisioned", { agent: updated });
    return { agent: updated };
  });

  app.post("/api/agents/:id/chat", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const agent = await agents.getForUser(id, user.id);

    const body = z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1)
      })).min(1).max(40)
    }).parse(request.body);

    const systemContent = [
      agent.systemPrompt,
      agent.knowledgeBase ? `\n\nKnowledge base:\n${agent.knowledgeBase}` : ""
    ].join("").trim();

    const groqMessages = [
      { role: "system" as const, content: systemContent },
      ...body.messages
    ];

    const raw = await groqChat(groqMessages);
    const { spokenText, endCall } = extractControlTokens(raw);

    return { reply: spokenText || raw, endCall };
  });

  app.post("/api/agents/:id/knowledge", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    await agents.getForUser(id, user.id);

    if (request.isMultipart()) {
      const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } });
      if (!file) throw badRequest("Knowledge file is required");
      const buffer = await file.toBuffer();

      const isDocx =
        file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.filename.toLowerCase().endsWith(".docx");

      let text: string;
      if (isDocx) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value.trim();
        if (!text) throw badRequest("Could not extract text from DOCX file");
      } else {
        text = buffer.toString("utf8");
      }

      await agents.addKnowledgeDocument(id, file.filename, file.mimetype, buffer.length, text);
      await agents.recordEvent(id, "knowledge.uploaded", { fileName: file.filename, sizeBytes: buffer.length });
      publishAgentEvent(id, "knowledge.uploaded", { fileName: file.filename });
      return { ok: true };
    }

    const body = z.object({
      fileName: z.string().min(1).default("manual.txt"),
      mimeType: z.string().min(1).default("text/plain"),
      text: z.string().min(1)
    }).parse(request.body);
    await agents.addKnowledgeDocument(id, body.fileName, body.mimeType, Buffer.byteLength(body.text), body.text);
    await agents.recordEvent(id, "knowledge.uploaded", { fileName: body.fileName, sizeBytes: Buffer.byteLength(body.text) });
    publishAgentEvent(id, "knowledge.uploaded", { fileName: body.fileName });
    return { ok: true };
  });

  app.get("/api/agents/:id/calls", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const query = paginationQuery.parse(request.query);
    await agents.getForUser(id, user.id);
    return { calls: await calls.list(id, query.limit, query.offset) };
  });

  app.get("/api/agents/:id/calls/:callId", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const params = z.object({ id: z.string().uuid(), callId: z.string().uuid() }).parse(request.params);
    await agents.getForUser(params.id, user.id);
    return { call: await calls.detail(params.callId, params.id) };
  });

  app.get("/api/agents/:id/bookings", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    const query = z.object({ status: z.enum(["pending", "confirmed", "cancelled"]).optional() }).parse(request.query);
    await agents.getForUser(id, user.id);
    return { bookings: await calls.listBookings(id, query.status) };
  });

  app.put("/api/agents/:id/bookings/:bookingId", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const params = z.object({ id: z.string().uuid(), bookingId: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(["pending", "confirmed", "cancelled"]) }).parse(request.body);
    await agents.getForUser(params.id, user.id);
    const booking = await calls.updateBookingStatus(params.id, params.bookingId, body.status as BookingStatus);
    await agents.recordEvent(params.id, "booking.updated", { bookingId: booking.id, status: booking.status });
    publishAgentEvent(params.id, "booking.updated", { booking });
    return { booking };
  });

  app.get("/api/agents/:id/analytics", { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    await agents.getForUser(id, user.id);
    return { analytics: await calls.analytics(id), events: await agents.recentEvents(id, 10) };
  });

  app.get("/api/agents/:id/sse", { preHandler: requireAuth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = paramsSchema.parse(request.params);
    await agents.getForUser(id, user.id);
    addSseClient(id, reply);
    return reply;
  });
}
