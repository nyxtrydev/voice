import type { Pool, PoolClient } from "pg";
import type { Agent, AgentStatus, AgentType, BookingStatus, CallLog, Sentiment } from "../types/domain.js";
import { notFound } from "../lib/httpErrors.js";

type Db = Pool | PoolClient;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  plan: string;
}

export interface CreateAgentInput {
  userId: string;
  name: string;
  businessName: string;
  businessType: AgentType;
  persona: string;
  systemPrompt: string;
  knowledgeBase?: string;
  bookingEnabled: boolean;
  phoneCountry?: string;
  language?: string;
  voice?: string;
}

export interface UpdateAgentInput {
  name?: string;
  systemPrompt?: string;
  knowledgeBase?: string;
  bookingEnabled?: boolean;
  status?: AgentStatus;
  voice?: string | null;
}

export interface CreateCallInput {
  agentId: string;
  callSid?: string;
  callerPhone?: string;
  callerName?: string;
  promptVersion: number;
}

export interface BookingInput {
  agentId: string;
  callId?: string | null;
  name: string;
  phone?: string | null;
  bookingDate?: string | null;
  bookingTime?: string | null;
  service: string;
  status?: BookingStatus;
  details?: Record<string, unknown>;
}

export function userRepository(db: Db) {
  return {
    async create(email: string, passwordHash: string) {
      const result = await db.query<UserRow>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, password_hash, plan`,
        [email.toLowerCase(), passwordHash]
      );
      return result.rows[0];
    },

    async findByEmail(email: string) {
      const result = await db.query<UserRow>(
        "SELECT id, email, password_hash, plan FROM users WHERE lower(email) = lower($1)",
        [email]
      );
      return result.rows[0] || null;
    }
  };
}

export function agentRepository(db: Db) {
  return {
    async create(input: CreateAgentInput) {
      const result = await db.query(
        `INSERT INTO agents (
          user_id, name, business_name, business_type, persona, system_prompt,
          knowledge_base, booking_enabled, status, phone_country, language, voice
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11)
        RETURNING *`,
        [
          input.userId,
          input.name,
          input.businessName,
          input.businessType,
          input.persona,
          input.systemPrompt,
          input.knowledgeBase || "",
          input.bookingEnabled,
          input.phoneCountry || "India",
          input.language || "en-IN",
          input.voice || null
        ]
      );
      const agent = mapAgent(result.rows[0]);
      await this.insertPromptVersion(agent.id, agent.promptVersion, agent.systemPrompt);
      return agent;
    },

    async insertPromptVersion(agentId: string, version: number, prompt: string) {
      await db.query(
        `INSERT INTO prompt_versions (agent_id, version, prompt)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, version) DO NOTHING`,
        [agentId, version, prompt]
      );
    },

    async listForUser(userId: string) {
      const result = await db.query("SELECT * FROM agents WHERE user_id = $1 AND status <> 'archived' ORDER BY created_at DESC", [userId]);
      return result.rows.map(mapAgent);
    },

    async getForUser(agentId: string, userId: string) {
      const result = await db.query("SELECT * FROM agents WHERE id = $1 AND user_id = $2", [agentId, userId]);
      if (!result.rows[0]) throw notFound("Agent not found");
      return mapAgent(result.rows[0]);
    },

    async getById(agentId: string) {
      const result = await db.query("SELECT * FROM agents WHERE id = $1", [agentId]);
      if (!result.rows[0]) throw notFound("Agent not found");
      return mapAgent(result.rows[0]);
    },

    async update(agentId: string, userId: string, input: UpdateAgentInput) {
      const existing = await this.getForUser(agentId, userId);
      const nextVersion = input.systemPrompt && input.systemPrompt !== existing.systemPrompt ? existing.promptVersion + 1 : existing.promptVersion;
      const result = await db.query(
        `UPDATE agents
         SET name = COALESCE($3, name),
             system_prompt = COALESCE($4, system_prompt),
             knowledge_base = COALESCE($5, knowledge_base),
             booking_enabled = COALESCE($6, booking_enabled),
             status = COALESCE($7, status),
             prompt_version = $8,
             voice = COALESCE($9, voice),
             updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [
          agentId,
          userId,
          input.name,
          input.systemPrompt,
          input.knowledgeBase,
          input.bookingEnabled,
          input.status,
          nextVersion,
          input.voice || null
        ]
      );
      const agent = mapAgent(result.rows[0]);
      if (nextVersion !== existing.promptVersion) {
        await this.insertPromptVersion(agent.id, agent.promptVersion, agent.systemPrompt);
      }
      return agent;
    },

    async setProvisioned(agentId: string, userId: string, phoneNumber: string, phoneSid: string | null) {
      const result = await db.query(
        `UPDATE agents
         SET status = 'live', twilio_phone_number = $3, twilio_phone_sid = $4, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [agentId, userId, phoneNumber, phoneSid]
      );
      if (!result.rows[0]) throw notFound("Agent not found");
      return mapAgent(result.rows[0]);
    },

    async addKnowledgeDocument(agentId: string, fileName: string, mimeType: string, sizeBytes: number, extractedText: string) {
      await db.query(
        `INSERT INTO knowledge_documents (agent_id, file_name, mime_type, size_bytes, extracted_text)
         VALUES ($1, $2, $3, $4, $5)`,
        [agentId, fileName, mimeType, sizeBytes, extractedText]
      );
      await db.query(
        `UPDATE agents
         SET knowledge_base = trim(concat_ws(E'\n\n', knowledge_base, $2::text)), updated_at = now()
         WHERE id = $1`,
        [agentId, extractedText]
      );
    },

    async recordEvent(agentId: string, eventType: string, payload: Record<string, unknown>) {
      const result = await db.query(
        `INSERT INTO agent_events (agent_id, event_type, payload)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [agentId, eventType, payload]
      );
      return result.rows[0];
    },

    async recentEvents(agentId: string, limit = 20) {
      const result = await db.query(
        `SELECT id, event_type, payload, created_at
         FROM agent_events
         WHERE agent_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [agentId, limit]
      );
      return result.rows;
    }
  };
}

export function callRepository(db: Db) {
  return {
    async create(input: CreateCallInput) {
      const result = await db.query(
        `INSERT INTO calls (agent_id, call_sid, caller_phone, caller_name, prompt_version)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.agentId, input.callSid || null, input.callerPhone || null, input.callerName || null, input.promptVersion]
      );
      return mapCall(result.rows[0]);
    },

    async list(agentId: string, limit = 50, offset = 0) {
      const result = await db.query(
        `SELECT * FROM calls
         WHERE agent_id = $1
         ORDER BY started_at DESC
         LIMIT $2 OFFSET $3`,
        [agentId, limit, offset]
      );
      return result.rows.map(mapCall);
    },

    async detail(callId: string, agentId: string) {
      const callResult = await db.query("SELECT * FROM calls WHERE id = $1 AND agent_id = $2", [callId, agentId]);
      if (!callResult.rows[0]) throw notFound("Call not found");
      const turnsResult = await db.query(
        "SELECT speaker, text, created_at FROM call_turns WHERE call_id = $1 ORDER BY created_at ASC",
        [callId]
      );
      return {
        ...mapCall(callResult.rows[0]),
        turns: turnsResult.rows
      };
    },

    async addTurn(callId: string, speaker: "agent" | "caller" | "system", text: string) {
      await db.query(
        `INSERT INTO call_turns (call_id, speaker, text)
         VALUES ($1, $2, $3)`,
        [callId, speaker, text]
      );
      await db.query(
        `UPDATE calls
         SET transcript = trim(concat_ws(E'\n', transcript, $2 || ': ' || $3))
         WHERE id = $1`,
        [callId, speaker, text]
      );
    },

    async end(callId: string, patch: { outcome: string; durationSeconds?: number; sentiment?: Sentiment; sentimentScore?: number; summary?: string }) {
      const result = await db.query(
        `UPDATE calls
         SET outcome = $2,
             duration_seconds = COALESCE($3, EXTRACT(EPOCH FROM (now() - started_at))::integer),
             sentiment = COALESCE($4, sentiment),
             sentiment_score = COALESCE($5, sentiment_score),
             summary = COALESCE($6, summary),
             ended_at = now()
         WHERE id = $1
         RETURNING *`,
        [callId, patch.outcome, patch.durationSeconds, patch.sentiment, patch.sentimentScore, patch.summary]
      );
      if (!result.rows[0]) throw notFound("Call not found");
      return mapCall(result.rows[0]);
    },

    async createBooking(input: BookingInput) {
      const result = await db.query(
        `INSERT INTO bookings (agent_id, call_id, name, phone, booking_date, booking_time, service, status, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'pending'), $9)
         RETURNING *`,
        [
          input.agentId,
          input.callId || null,
          input.name,
          input.phone || null,
          input.bookingDate || null,
          input.bookingTime || null,
          input.service,
          input.status || null,
          input.details || {}
        ]
      );
      return mapBooking(result.rows[0]);
    },

    async listBookings(agentId: string, status?: BookingStatus) {
      const result = await db.query(
        `SELECT * FROM bookings
         WHERE agent_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC`,
        [agentId, status || null]
      );
      return result.rows.map(mapBooking);
    },

    async updateBookingStatus(agentId: string, bookingId: string, status: BookingStatus) {
      const result = await db.query(
        `UPDATE bookings
         SET status = $3, updated_at = now()
         WHERE id = $1 AND agent_id = $2
         RETURNING *`,
        [bookingId, agentId, status]
      );
      if (!result.rows[0]) throw notFound("Booking not found");
      return mapBooking(result.rows[0]);
    },

    async analytics(agentId: string) {
      const result = await db.query(
        `SELECT
          count(*) FILTER (WHERE started_at::date = current_date)::integer AS calls_today,
          count(*) FILTER (WHERE started_at >= now() - interval '7 days')::integer AS calls_week,
          count(*) FILTER (WHERE started_at >= date_trunc('month', now()))::integer AS calls_month,
          coalesce(round(avg(duration_seconds)), 0)::integer AS avg_duration_seconds,
          coalesce(round(avg(sentiment_score)), 0)::integer AS avg_sentiment_score,
          count(*) FILTER (WHERE sentiment = 'positive')::integer AS positive,
          count(*) FILTER (WHERE sentiment = 'neutral')::integer AS neutral,
          count(*) FILTER (WHERE sentiment = 'negative')::integer AS negative
        FROM calls
        WHERE agent_id = $1`,
        [agentId]
      );
      const bookings = await db.query(
        `SELECT
          count(*)::integer AS total,
          count(*) FILTER (WHERE status = 'confirmed')::integer AS confirmed,
          count(*) FILTER (WHERE created_at::date = current_date)::integer AS today
        FROM bookings
        WHERE agent_id = $1`,
        [agentId]
      );
      return {
        calls: result.rows[0],
        bookings: bookings.rows[0]
      };
    }
  };
}

function mapAgent(row: any): Agent {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    businessName: row.business_name,
    businessType: row.business_type,
    persona: row.persona,
    systemPrompt: row.system_prompt,
    promptVersion: row.prompt_version,
    knowledgeBase: row.knowledge_base,
    bookingEnabled: row.booking_enabled,
    status: row.status,
    language: row.language,
    voice: row.voice ?? null,
    phoneCountry: row.phone_country,
    twilioPhoneNumber: row.twilio_phone_number,
    twilioPhoneSid: row.twilio_phone_sid,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCall(row: any): CallLog {
  return {
    id: row.id,
    agentId: row.agent_id,
    callSid: row.call_sid,
    callerPhone: row.caller_phone,
    callerName: row.caller_name,
    transcript: row.transcript,
    sentiment: row.sentiment,
    sentimentScore: row.sentiment_score,
    summary: row.summary,
    outcome: row.outcome,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    promptVersion: row.prompt_version
  };
}

function mapBooking(row: any) {
  return {
    id: row.id,
    agentId: row.agent_id,
    callId: row.call_id,
    name: row.name,
    phone: row.phone,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    service: row.service,
    status: row.status,
    details: row.details,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
