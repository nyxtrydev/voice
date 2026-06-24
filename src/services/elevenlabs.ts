import { env } from "../config/env.js";

// ElevenLabs voices (custom voice IDs from the account library). Played through
// Flash v2.5 for low-latency telephony. Labels mirror the dashboard dropdown.
export const ELEVENLABS_VOICES = [
  { id: "f0JpDwzbGK384Dd1WH2s", label: "Diana — Female" },
  { id: "fPIfC3elMLbN9tNwMXkw", label: "Viraj — Male" },
] as const;

export const DEFAULT_ELEVENLABS_VOICE = "f0JpDwzbGK384Dd1WH2s"; // Diana

// Older agents store legacy Sarvam speaker names. Map each to the nearest
// ElevenLabs voice so existing agents keep a valid voice without a migration.
const LEGACY_VOICE_MAP: Record<string, string> = {
  anushka:  "f0JpDwzbGK384Dd1WH2s", // female
  manisha:  "f0JpDwzbGK384Dd1WH2s",
  vidya:    "f0JpDwzbGK384Dd1WH2s",
  arya:     "f0JpDwzbGK384Dd1WH2s",
  abhilash: "fPIfC3elMLbN9tNwMXkw", // male
  karun:    "fPIfC3elMLbN9tNwMXkw",
  hitesh:   "fPIfC3elMLbN9tNwMXkw",
  priya:    "f0JpDwzbGK384Dd1WH2s",
  shubh:    "fPIfC3elMLbN9tNwMXkw",
};

export function resolveVoice(voice?: string | null): string {
  if (!voice) return DEFAULT_ELEVENLABS_VOICE;
  return LEGACY_VOICE_MAP[voice] ?? voice;
}

export function elevenLabsEnabled(): boolean {
  return !!env.ELEVENLABS_API_KEY;
}

/**
 * Synthesizes speech and returns raw μ-law 8 kHz bytes — exactly the format
 * Twilio Media Streams expect, so no extra audio conversion is needed.
 */
export async function elevenLabsTts(text: string, voiceId: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/basic"
      },
      body: JSON.stringify({
        text: text.slice(0, 500),
        model_id: env.ELEVENLABS_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`ElevenLabs TTS ${res.status}: ${err}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) throw new Error("ElevenLabs TTS: empty audio response");
  return audio;
}
