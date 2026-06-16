import type { AgentEvent, AgentStatus } from "../types";

export function fmtDuration(secs: number | null | undefined): string {
  const s = Number(secs) || 0;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function statusBadgeClass(status: AgentStatus): string {
  if (status === "live") return "positive";
  return "neutral";
}

export function eventLabel(ev: AgentEvent): { title: string; detail: string } {
  const p = ev.payload || {};
  const map: Record<string, { title: string; detail: string }> = {
    "agent.created": { title: "Agent created", detail: p.name || "" },
    "agent.updated": { title: "Agent updated", detail: p.promptVersion ? `Prompt v${p.promptVersion}` : "" },
    "agent.provisioned": { title: "Agent provisioned", detail: p.phoneNumber || "" },
    "call.inbound": { title: "Inbound call", detail: "" },
    "call.started": { title: "Call started", detail: p.callId?.slice(0, 8) || "" },
    "call.ended": { title: "Call ended", detail: p.outcome || "" },
    "booking.created": { title: "Booking captured", detail: "" },
    "booking.updated": { title: "Booking updated", detail: p.status || "" },
    "knowledge.uploaded": { title: "Knowledge uploaded", detail: p.fileName || "" }
  };
  return map[ev.event_type] || { title: ev.event_type, detail: "" };
}
