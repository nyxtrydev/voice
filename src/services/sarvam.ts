import { env } from "../config/env.js";

export const SARVAM_VOICES = [
  { id: "priya", label: "Priya — Female" },
  { id: "shubh", label: "Subh — Male" },
] as const;

export const DEFAULT_SARVAM_VOICE = "priya";

export function sarvamEnabled(): boolean {
  return !!env.SARVAM_API_KEY;
}

/** Transcribes a WAV buffer using Sarvam saarika:v2 STT. */
export async function sarvamStt(wavBuffer: Buffer, languageCode = "en-IN"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }), "speech.wav");
  form.append("model", "saarika:v2.5");
  form.append("language_code", languageCode);

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": env.SARVAM_API_KEY },
    body: form
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`Sarvam STT ${res.status}: ${err}`);
  }

  const data = await res.json() as { transcript?: string };
  return (data.transcript || "").trim();
}

/** Returns raw WAV bytes from Sarvam AI. */
export async function sarvamTts(text: string, speaker: string): Promise<Buffer> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": env.SARVAM_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs: [text.slice(0, 500)],
      target_language_code: "en-IN",
      speaker,
      model: "bulbul:v3-beta"
    })
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`Sarvam TTS ${res.status}: ${err}`);
  }

  const data = await res.json() as { audios?: string[] };
  const wavBase64 = data.audios?.[0];
  if (!wavBase64) throw new Error("Sarvam TTS: empty audio response");
  return Buffer.from(wavBase64, "base64");
}
