import type { FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";

type SseClient = {
  id: string;
  reply: FastifyReply;
};

const clients = new Map<string, Set<SseClient>>();

export function addSseClient(agentId: string, reply: FastifyReply) {
  const client: SseClient = {
    id: randomUUID(),
    reply
  };

  if (!clients.has(agentId)) clients.set(agentId, new Set());
  clients.get(agentId)?.add(client);

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ agentId })}\n\n`);

  const heartbeat = setInterval(() => {
    reply.raw.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, 25000);

  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    clients.get(agentId)?.delete(client);
  });
}

export function publishAgentEvent(agentId: string, event: string, payload: unknown) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.get(agentId)?.forEach((client) => {
    client.reply.raw.write(message);
  });
}
