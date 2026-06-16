import { env } from "../config/env.js";
import type { Agent } from "../types/domain.js";

const TWILIO_BASE = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function mediaStreamTwiml(agent: Agent): string {
  const wsUrl = `${env.PUBLIC_BASE_URL.replace(/^http/, "ws")}/ws?agentId=${agent.id}`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Connect>`,
    `    <Stream url="${escapeXml(wsUrl)}" track="inbound_track">`,
    `      <Parameter name="agentId" value="${escapeXml(agent.id)}" />`,
    `    </Stream>`,
    `  </Connect>`,
    `</Response>`
  ].join("\n");
}

function twilioAuth() {
  return "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

export function buildWelcomeGreeting(agent: Agent): string {
  const firstName = agent.name.split(" ")[0];
  return `Hello, thank you for calling ${agent.businessName}. I'm ${firstName}. How can I help you today?`;
}

export async function provisionPhoneNumber(agent: Agent) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    return { phoneNumber: `DEV-${agent.id.slice(0, 8)}`, phoneSid: null };
  }

  const phoneSid = await getTwilioPhoneSid(env.TWILIO_PHONE_NUMBER);
  if (phoneSid) {
    await updateTwilioWebhook(agent, phoneSid);
  }

  return { phoneNumber: env.TWILIO_PHONE_NUMBER, phoneSid: phoneSid ?? null };
}

// Update Twilio phone number webhook to route calls to this agent
export async function updateTwilioWebhook(agent: Agent, phoneSid?: string | null): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return;

  const sid = phoneSid ?? await getTwilioPhoneSid(env.TWILIO_PHONE_NUMBER);
  if (!sid) return;

  const webhookUrl = `${env.PUBLIC_BASE_URL}/twilio/voice?agentId=${agent.id}`;
  const body = new URLSearchParams({ VoiceUrl: webhookUrl, VoiceMethod: "POST" });

  await fetch(`${TWILIO_BASE}/IncomingPhoneNumbers/${sid}.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
}

async function getTwilioPhoneSid(phoneNumber: string): Promise<string | null> {
  const res = await fetch(
    `${TWILIO_BASE}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
    { headers: { Authorization: twilioAuth() } }
  );
  const data = await res.json() as { incoming_phone_numbers?: Array<{ sid: string }> };
  return data.incoming_phone_numbers?.[0]?.sid ?? null;
}

