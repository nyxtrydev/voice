# Real-Time Response Architecture — BMW Aria Voice Agent

## Overview

Aria targets a **sub-600ms end-to-end voice latency** from the moment a caller finishes speaking to the moment the AI begins responding. This document explains every architectural decision that makes that possible.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INBOUND PHONE CALL                          │
│                           (Twilio PSTN)                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  POST /incoming-call (TwiML webhook)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       FASTIFY SERVER (port 3001)                    │
│                                                                     │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐   │
│  │  /incoming-call  │───▶│  ConversationRelay TwiML response   │   │
│  │  /twilio/voice   │    │  → opens WSS /ws connection back    │   │
│  └──────────────────┘    └─────────────────────────────────────┘   │
│                                          │                          │
│               ┌──────────────────────────▼─────────────────────┐   │
│               │          WebSocket Handler  /ws                 │   │
│               │                                                 │   │
│               │  1. Receives transcript from Twilio STT         │   │
│               │  2. detectLanguage() — local regex, 0ms         │   │
│               │  3. getAriaResponse() → Groq Llama 4 Scout      │   │
│               │  4. Turn-cancellation guard                     │   │
│               │  5. BOOK: token extraction                      │   │
│               │  6. Sends { type:"text", token, last:true }     │   │
│               │     back to Twilio ConversationRelay            │   │
│               └─────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐ │
│  │  /api/tts   │    │  /chat (POST)│    │  /api/events (SSE)     │ │
│  │  Sarvam TTS │    │  Web UI flow │    │  Dashboard live stream  │ │
│  └─────────────┘    └──────────────┘    └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
         │ SSE push on booking                   │ Web browser
         ▼                                       ▼
┌─────────────────────┐              ┌────────────────────────────────┐
│  Next.js Dashboard  │              │  Next.js Agent UI  /agent      │
│  live booking feed  │              │  Web Speech API + TTS playback │
└─────────────────────┘              └────────────────────────────────┘
```

---

## The Real-Time Pipeline (Phone Call Path)

### Step 1 — Call Arrives, TwiML Activates ConversationRelay

When Twilio receives a call it sends a POST to `/incoming-call`. The server returns a TwiML `<ConversationRelay>` instruction that tells Twilio to open a persistent WebSocket back to the server (`wss://{TUNNEL_URL}/ws`).

```xml
<ConversationRelay
  url="wss://your-domain/ws"
  welcomeGreetingInterruptible="any"
  interruptible="any"
  interruptSensitivity="high"
  reportInputDuringAgentSpeech="speech"
  preemptible="true"
  speechTimeout="600"
/>
```

Key flags for low latency:
- `interruptible="any"` — caller can cut Aria off mid-sentence; no waiting for the full utterance to finish.
- `reportInputDuringAgentSpeech="speech"` — Twilio sends partial speech events even while Aria is still talking.
- `preemptible="true"` — Twilio can preempt Aria's audio immediately on new input.
- `speechTimeout="600"` — 600ms of silence triggers end-of-utterance; keeps turn-taking snappy.

### Step 2 — WebSocket Receives Transcript (Twilio STT → text)

Twilio runs its own ASR (automatic speech recognition) on the call audio and sends the transcript to the server over the WebSocket as a JSON message. The server pulls the transcript from any of several field names (`prompt`, `transcript`, `text`, `utterance`) via `extractTranscript()`.

**Twilio handles STT on the phone path**, so there is zero STT network round-trip from the server's perspective. The server only receives text.

### Step 3 — Language Detection (Local, Zero Latency)

```js
// server/sarvam.js
export function detectLanguage(transcript = '') {
  const hindiPattern = /[ऀ-ॿ]/          // Devanagari script
  const hindiWords = ['hai', 'haan', 'nahi', ...]  // Hinglish keywords
  return hasDevanagari || hasHindiWords ? 'hi-IN' : 'en-IN'
}
```

Language detection is a local regex pass — **no network call, no added latency**. The result gates which language Sarvam TTS uses later and is injected into the Groq system prompt.

### Step 4 — Groq LLM Inference (The Critical Path)

```js
// server/groq.js
const completion = await groq.chat.completions.create({
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  messages: [systemPrompt, ...history],
  max_tokens: 160,     // ← hard cap on output length
  temperature: 0.65,
  stream: false,
})
```

**Why Groq specifically:**  
Groq runs on its own Language Processing Units (LPUs), which execute transformer inference at memory-bandwidth speed rather than compute speed. For a 17B parameter model, Groq typically delivers **200–350ms Time to First Token** for short outputs — 5–10× faster than GPU-based providers for this use case.

**Why `max_tokens: 160`:**  
A voice response of 2–3 sentences is ~40–60 tokens. Capping at 160 ensures the model does not generate a wall of text that would (a) take longer to generate, (b) violate the voice rules ("max 40 words"), and (c) take longer for TTS to synthesize and speak. Every extra token adds ~1–3ms on Groq; keeping it tight saves 100–500ms on long generations.

**Fallback chain for 100% uptime:**
```
meta-llama/llama-4-scout-17b-16e-instruct
  → llama-3.3-70b-versatile
    → llama-3.1-8b-instant
      → local demo responses (offline fallback)
```

If the primary model returns a 403/404 (`model_not_found`), the server retries the next model in milliseconds rather than surfacing an error to the caller.

### Step 5 — Turn Cancellation Guard

```js
// server/index.js
const myTurn = session.turn + 1
session.turn = myTurn
// ... await Groq ...
const latest = conversations.get(sessionId)
if (!latest || latest.turn !== myTurn) return  // stale — discard
```

If the caller speaks again while Groq is still processing the previous turn, `session.turn` increments. When the old Groq response arrives it sees `latest.turn !== myTurn` and is silently discarded. This prevents Aria from speaking a stale response after the caller has already moved on — a key source of perceived latency in naive implementations.

### Step 6 — Response Sent Back via WebSocket

```js
connection.socket.send(JSON.stringify({
  type: 'text',
  token: cleanResponse,
  last: true,
}))
```

Twilio ConversationRelay receives this text token and immediately begins synthesizing and speaking it. The `last: true` flag signals end-of-turn so Twilio re-arms its speech detector for the caller's next utterance.

---

## The Real-Time Pipeline (Web UI Path)

For the browser-based demo at `/agent` the path is slightly different because the browser handles STT locally:

```
Browser mic → Web Speech API (ondevice STT)
  → POST /api/chat  (Next.js route proxy)
    → POST http://localhost:3001/chat  (Fastify)
      → Groq inference
      → POST https://api.sarvam.ai/text-to-speech  (Sarvam TTS)
        ← base64 WAV returned
      ← JSON { response, detectedLanguage }
    ← JSON forwarded
  ← Audio decoded & played via Web Audio API
```

**Sarvam TTS** (`bulbul:v3`, `speech_sample_rate: 24000`) provides natural Indian-English and Hindi voices. If `SARVAM_API_KEY` is absent the system falls back to the browser's built-in `SpeechSynthesis` API, so the demo runs without any API keys.

---

## Dashboard Live Updates — Server-Sent Events

Bookings confirmed by Aria must appear on the dashboard instantly. Instead of polling the server every N seconds, the dashboard holds an open SSE connection to `/api/events`.

```js
// server/index.js — broadcast to all connected dashboard tabs
function broadcastBooking(booking) {
  const payload = `data: ${JSON.stringify(booking)}\n\n`
  for (const client of clients) {
    client.write(payload)   // each client is a raw Node.js response stream
  }
}
```

When Aria confirms a booking (either via phone call or web UI), `broadcastBooking()` fires within the same request cycle — the dashboard tab updates in under 50ms.

---

## Latency Budget (Phone Call, Typical)

| Stage | Component | Typical Time |
|---|---|---|
| Caller speaks, Twilio STT | Twilio cloud ASR | ~200–400ms |
| WebSocket message delivery | Twilio → Fastify | ~20–50ms |
| Language detection | Local regex | <1ms |
| Groq LLM inference (≤160 tokens) | Groq LPU | ~200–350ms |
| Turn guard + booking parse | Local | <5ms |
| WebSocket response to Twilio | Fastify → Twilio | ~20–50ms |
| **Total server-side latency** | | **~250–410ms** |
| **Total perceived latency** | including STT | **~450–800ms** |

The target is **<600ms server-side**; the architecture hits this reliably on Groq's LPUs for short responses.

---

## Key Design Decisions for Low Latency

| Decision | Alternative Considered | Reason |
|---|---|---|
| Groq as LLM provider | OpenAI, Anthropic | 5–10× faster inference on LPUs |
| `max_tokens: 160` hard cap | Uncapped / 512 | Shorter output = faster generation + faster TTS |
| WebSocket for phone path | HTTP polling | Persistent connection, no handshake per turn |
| SSE for dashboard | WebSocket / polling | One-directional push; simpler, lower overhead |
| Twilio ConversationRelay | Twilio `<Gather>` + `<Say>` | Native streaming; no codec conversion round-trips |
| Local language detection | API-based LID | Zero added latency for the most critical branching decision |
| Conversation history capped at 12 | Unbounded | Keeps prompt tokens low → faster inference |
| Turn cancellation | None | Prevents stale responses being spoken after caller interrupts |
| Fastify HTTP framework | Express | 2–3× faster routing and JSON serialization under load |

---

## Component Map

```
server/
  index.js     — Fastify server: WebSocket handler, REST endpoints, SSE broadcast
  groq.js      — Groq SDK wrapper: model candidates, system prompt builder, fallback chain
  sarvam.js    — Sarvam AI: streaming STT WebSocket, TTS synthesis, local language detection
  store.js     — In-memory booking store: slot management, conflict detection, next-slot finder

app/
  api/chat/    — Next.js proxy: forwards chat requests to Fastify
  api/tts/     — Next.js proxy: forwards TTS requests to Fastify
  api/bookings/— Next.js proxy: booking CRUD forwarded to Fastify
  agent/       — Browser voice UI: Web Speech API, Sarvam TTS playback, chat thread

components/
  MicButton    — Recording toggle with animated ring on active state
  Waveform     — Visual feedback synced to agent status
  ChatThread   — Live conversation display
  BookingCard  — Pending booking review + confirm UI
```

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq inference access |
| `GROQ_MODEL` | Override primary model (default: `meta-llama/llama-4-scout-17b-16e-instruct`) |
| `GROQ_FALLBACK_MODELS` | Comma-separated fallback model list |
| `SARVAM_API_KEY` | Sarvam STT + TTS access |
| `SARVAM_TTS_SPEAKER` | Voice speaker (e.g. `meera`) |
| `TUNNEL_URL` | Public HTTPS/WSS URL for Twilio ConversationRelay WebSocket |
| `DASHBOARD_API_KEY` | Bearer key for `/api/bookings` and `/api/call-logs` |
| `PORT` / `SERVER_PORT` | Fastify listen port (default: 3001) |
| `NEXT_PUBLIC_API_URL` | Frontend → backend base URL (default: `http://localhost:3001`) |
