import { env } from "../config/env.js";

// bulbul:v2 speakers — the fast TTS model (~0.84s vs ~2.3s on v3-beta)
export const SARVAM_VOICES = [
  { id: "anushka",  label: "Anushka — Female" },
  { id: "manisha",  label: "Manisha — Female" },
  { id: "vidya",    label: "Vidya — Female" },
  { id: "arya",     label: "Arya — Female" },
  { id: "abhilash", label: "Abhilash — Male" },
  { id: "karun",    label: "Karun — Male" },
  { id: "hitesh",   label: "Hitesh — Male" },
] as const;

export const DEFAULT_SARVAM_VOICE = "anushka";

// Legacy v3-beta speakers stored on older agents → nearest v2 equivalent.
const LEGACY_VOICE_MAP: Record<string, string> = { priya: "anushka", shubh: "abhilash" };

export function resolveVoice(voice?: string | null): string {
  if (!voice) return DEFAULT_SARVAM_VOICE;
  return LEGACY_VOICE_MAP[voice] ?? voice;
}

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
      model: "bulbul:v2"
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
