import { env } from "../config/env.js";

export async function transcribeAudio(wavBuffer: Buffer): Promise<string> {
  if (!env.GROQ_API_KEY) return "";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }), "speech.wav");
  // Full large-v3 (not turbo): turbo is faster but loses accuracy on hard audio
  // — accents, 8 kHz phone narrowband, background noise. Worth the small latency
  // cost here since transcription quality drives the whole conversation.
  form.append("model", "whisper-large-v3");
  form.append("language", "en");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form
  });

  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const data = await res.json() as { text?: string };
  return (data.text || "").trim();
}
