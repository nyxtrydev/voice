export type AgentType = "clinic" | "auto" | "tech" | "other";
export type AgentStatus = "draft" | "provisioning" | "live" | "paused" | "archived";
export type Sentiment = "positive" | "neutral" | "negative";
export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface AuthUser {
  id: string;
  email: string;
  plan: string;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  businessName: string;
  businessType: AgentType;
  persona: string;
  systemPrompt: string;
  promptVersion: number;
  knowledgeBase: string;
  bookingEnabled: boolean;
  status: AgentStatus;
  language: string;
  voice: string | null;
  phoneCountry: string;
  twilioPhoneNumber: string | null;
  twilioPhoneSid: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallLog {
  id: string;
  agentId: string;
  callSid: string | null;
  callerPhone: string | null;
  callerName: string | null;
  transcript: string;
  sentiment: Sentiment | null;
  sentimentScore: number | null;
  summary: string | null;
  outcome: string;
  durationSeconds: number;
  startedAt: string;
  endedAt: string | null;
  promptVersion: number;
}

export interface Booking {
  id: string;
  agentId: string;
  callId: string | null;
  name: string;
  phone: string | null;
  bookingDate: string | null;
  bookingTime: string | null;
  service: string;
  status: BookingStatus;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthUser;
  }
}
