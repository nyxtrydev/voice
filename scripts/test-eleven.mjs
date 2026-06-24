import fs from "node:fs";

const KEY = fs.readFileSync(".env", "utf8").match(/ELEVENLABS_API_KEY=(.*)/)[1].trim();
const MODEL = (fs.readFileSync(".env", "utf8").match(/ELEVENLABS_MODEL=(.*)/)?.[1] || "eleven_flash_v2_5").trim();

const VOICES = [
  { id: "f0JpDwzbGK384Dd1WH2s", name: "diana", text: "Hi, this is Diana from VoiceAgentOS. How can I help you today?" },
  { id: "fPIfC3elMLbN9tNwMXkw", name: "viraj", text: "Hello, this is Viraj from VoiceAgentOS. How can I help you today?" },
];

async function tts(voiceId, text, format) {
  const t0 = Date.now();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${format}`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
    }
  );
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ms: Date.now() - t0 };
}

for (const v of VOICES) {
  // 1) The exact format the app sends to Twilio
  const ulaw = await tts(v.id, v.text, "ulaw_8000");
  // 2) A playable MP3 sample to listen to
  const mp3 = await tts(v.id, v.text, "mp3_44100_128");
  fs.writeFileSync(`tts_samples/${v.name}.mp3`, mp3.buf);
  console.log(`${v.name.padEnd(6)} ulaw_8000: ${ulaw.buf.length} bytes (${ulaw.ms}ms)  |  mp3 saved: ${mp3.buf.length} bytes (${mp3.ms}ms)  model=${MODEL}`);
}
console.log("OK — both voices synthesized. MP3 samples in tts_samples/");
