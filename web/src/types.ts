export type AgentStatus = "draft" | "provisioning" | "live" | "paused" | "archived";
export type BusinessType = "clinic" | "auto" | "tech" | "other";
export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface User {
  id?: string;
  email: string;
  plan?: "starter" | "growth" | "pro";
}

export interface Agent {
  id: string;
  name: string;
  businessName: string;
  businessType: BusinessType;
  persona: string;
  status: AgentStatus;
  systemPrompt: string;
  promptVersion: number;
  bookingEnabled: boolean;
  twilioPhoneNumber: string | null;
  voice: string | null;
}

export interface CallTurn {
  speaker: "caller" | "agent";
  text: string;
}

export interface Call {
  id: string;
  callerName: string | null;
  callerPhone: string | null;
  outcome: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  sentimentScore: number | null;
  durationSeconds: number | null;
  startedAt: string;
  summary: string | null;
  transcript: string | null;
  turns?: CallTurn[];
}

export interface Booking {
  id: string;
  name: string;
  phone: string | null;
  bookingDate: string | null;
  bookingTime: string | null;
  service: string;
  status: BookingStatus;
}

export interface Analytics {
  calls?: {
    calls_today?: number;
    calls_week?: number;
    calls_month?: number;
    avg_duration_seconds?: number;
    avg_sentiment_score?: number;
    positive?: number;
    neutral?: number;
    negative?: number;
  };
  bookings?: {
    total?: number;
    confirmed?: number;
    today?: number;
  };
}

export interface AgentEvent {
  id?: string;
  event_type: string;
  payload: Record<string, unknown> & {
    name?: string;
    promptVersion?: number;
    phoneNumber?: string;
    callId?: string;
    outcome?: string;
    status?: string;
    fileName?: string;
  };
  created_at: string;
}

export interface AppConfig {
  twilioPhone: string | null;
  publicBaseUrl: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ViewName = "dashboard" | "agents" | "bookings" | "calls" | "prompts";
