# VoiceAgentOS — Developer & DevOps Guide

A no-code AI voice agent platform. Operators create an agent in the dashboard, provision it to a phone number, and the agent handles real inbound phone calls end-to-end: speech-to-text, LLM reasoning, text-to-speech, booking capture, sentiment analysis, and a live dashboard.

This document covers the implementation, the runtime internals, and how to host it. For a quick product overview see [README.md](README.md); for the realtime audio design see [REALTIME_ARCHITECTURE.md](REALTIME_ARCHITECTURE.md).

---

## 1. Architecture at a glance

```
                       ┌─────────────────────────────────────────────┐
   Caller (PSTN) ──▶ Twilio ──▶ Media Streams (WSS)                   │
                       │            │                                 │
                       │   POST /twilio/voice  (returns TwiML)        │
                       │            │                                 │
                       ▼            ▼                                 │
                 ┌──────────────────────────────────────────┐        │
                 │            Fastify 5 server               │        │
                 │  ┌─────────────┐   ┌────────────────────┐ │        │
   Browser ───▶  │  │ REST + SSE  │   │ /ws  Media Streams │ │        │
   (dashboard)   │  │ /api/*      │   │ voice runtime loop │ │        │
                 │  └──────┬──────┘   └─────────┬──────────┘ │        │
                 │         │                    │            │        │
                 └─────────┼────────────────────┼────────────┘        │
                           │                    │                     │
                           ▼                    ▼                     │
                     ┌──────────┐   ┌──────────────────────────┐      │
                     │ Postgres │   │ Groq (LLM + Whisper STT)  │ ◀────┘
                     │   16     │   │ Sarvam (TTS + STT)        │
                     └──────────┘   └──────────────────────────┘
```

- **Control plane** — REST API (`/api/*`) for auth, agent CRUD, knowledge upload, provisioning, analytics; Server-Sent Events (`/api/agents/:id/sse`) push live call/booking events to the dashboard.
- **Data plane** — Twilio dials the agent's webhook (`/twilio/voice`), which returns TwiML that opens a Media Streams WebSocket to `/ws`. All real-time audio flows over that socket.
- **Stateless app, stateful DB** — the Fastify process holds no durable state; all data lives in Postgres. Per-call state (VAD buffers, conversation history, pinned caller facts) lives only for the lifetime of a single WebSocket connection.

---

## 2. Tech stack

| Layer            | Choice                                                            |
| ---------------- | ----------------------------------------------------------------- |
| Runtime          | Node.js 20+ (Docker image uses Node 22-alpine), ESM (`"type":"module"`) |
| Web framework    | Fastify 5 + `@fastify/websocket`, `cors`, `helmet`, `formbody`, `multipart`, `static` |
| Language         | TypeScript 5 (strict), compiled with `tsc`; `tsx` for dev/watch    |
| Database         | PostgreSQL 16, accessed via `pg` connection pool                   |
| Auth             | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) password hashing        |
| LLM              | Groq Chat Completions (Llama 4 Scout default, Llama 3.x fallbacks), streaming |
| STT              | Sarvam `speech-to-text` (primary), Groq Whisper `whisper-large-v3-turbo` (fallback) |
| TTS              | Sarvam `text-to-speech`                                            |
| Telephony        | Twilio Voice + Media Streams                                       |
| Local tunnel     | ngrok (`scripts/tunnel.sh`)                                         |
| Validation       | Zod (env + request schemas)                                        |
| Doc parsing      | `mammoth` (DOCX → text for knowledge base)                         |

---

## 3. Repository layout

```
.
├── src/
│   ├── server.ts              # Process entry: builds app, listens, graceful shutdown
│   ├── app.ts                 # Fastify instance: plugins, route registration, error handler
│   ├── config/env.ts          # Zod-validated environment config (single source of truth)
│   ├── db/
│   │   ├── pool.ts            # pg Pool (max 20 prod / 8 dev)
│   │   ├── migrate.ts         # Forward-only SQL migration runner
│   │   └── repositories.ts    # All SQL: users, agents, calls, turns, bookings, events
│   ├── lib/
│   │   ├── auth.ts            # requireAuth preHandler, currentUser
│   │   ├── jwt.ts / password.ts
│   │   ├── audio.ts           # μ-law ⇄ PCM ⇄ WAV resampling, RMS (VAD)
│   │   ├── sseHub.ts          # In-process pub/sub for dashboard SSE
│   │   └── httpErrors.ts      # AppError + helpers (notFound, etc.)
│   ├── routes/
│   │   ├── auth.ts            # /api/auth/*, /api/me, /api/info
│   │   ├── agents.ts          # /api/agents/* (CRUD, provision, knowledge, analytics, SSE)
│   │   ├── twilio.ts          # /twilio/voice (TwiML) + /ws (voice runtime)  ← core loop
│   │   └── health.ts          # /healthz (checks DB)
│   ├── services/
│   │   ├── llm.ts             # Groq chat (streaming + non-streaming), control-token parsing
│   │   ├── sarvam.ts          # Sarvam TTS/STT clients, voice list
│   │   ├── stt.ts             # Groq Whisper fallback STT
│   │   ├── sentiment.ts       # Post-call sentiment via Groq
│   │   ├── twilio.ts          # TwiML builder, webhook provisioning, greeting
│   │   └── promptTemplates.ts # System-prompt templates per business type
│   └── types/domain.ts        # Shared domain types
├── db/migrations/             # 001_initial.sql, 002_agent_voice.sql
├── index.html / styles.css / app.js   # Static single-page dashboard (served at /)
├── scripts/tunnel.sh          # ngrok + dev server one-shot
├── Dockerfile                 # Multi-stage build → node dist/src/server.js
├── docker-compose.yml         # postgres + api (runs migrations then server)
└── dist/                      # tsc output (generated; not edited by hand)
```

---

## 4. Configuration (environment variables)

All config is parsed and validated once in [src/config/env.ts](src/config/env.ts). The process **fails fast** at startup if `DATABASE_URL` is missing or `JWT_SECRET` is shorter than 24 characters. Copy `.env.example` → `.env` and fill in.

| Variable               | Required | Default                                              | Notes |
| ---------------------- | -------- | ---------------------------------------------------- | ----- |
| `NODE_ENV`             | no       | `development`                                        | `production` raises log level to `info`, pool max to 20 |
| `PORT`                 | no       | `4000`                                               | |
| `HOST`                 | no       | `0.0.0.0`                                             | |
| `PUBLIC_BASE_URL`      | **yes (for calls)** | `http://localhost:4000`                   | Public HTTPS origin. Used to build the Twilio webhook URL and the `wss://…/ws` Media Streams URL. **Must be reachable by Twilio.** |
| `DATABASE_URL`         | **yes**  | —                                                    | `postgres://user:pass@host:5432/voiceagentos` |
| `JWT_SECRET`           | **yes**  | — (min 24 chars)                                     | Sign/verify dashboard JWTs |
| `JWT_EXPIRES_IN`       | no       | `30d`                                                | |
| `CORS_ORIGIN`          | no       | `http://localhost:4000`                              | Comma-separated allowlist, or `*` for any |
| `GROQ_API_KEY`         | for LLM  | `""`                                                 | Empty disables LLM/STT-fallback/sentiment |
| `GROQ_MODEL`           | no       | `meta-llama/llama-4-scout-17b-16e-instruct`          | Primary chat model |
| `GROQ_FALLBACK_MODELS` | no       | `llama-3.3-70b-versatile,llama-3.1-8b-instant`       | Tried in order if primary fails |
| `SARVAM_API_KEY`       | for voice| `""`                                                 | Empty disables Sarvam TTS/STT |
| `TWILIO_ACCOUNT_SID`   | for calls| `""`                                                 | |
| `TWILIO_AUTH_TOKEN`    | for calls| `""`                                                 | |
| `TWILIO_PHONE_NUMBER`  | for calls| `""`                                                 | The single provisioned number (E.164, e.g. `+17432562043`) |

> **Single-number constraint:** A Twilio number's voice webhook can point to only one agent at a time. Provisioning a second agent re-points `TWILIO_PHONE_NUMBER` to it and takes it away from the first. The agent that actually answers is whichever the Twilio `voice_url` query string (`agentId=…`) currently names — the DB column can drift from this.

---

## 5. Local development

### Prerequisites
- Node.js 20+
- PostgreSQL running locally (or `docker compose up -d postgres`)
- ngrok authenticated (`ngrok config add-authtoken <TOKEN>`) — only needed for real calls
- Groq, Sarvam, Twilio accounts/keys for full functionality

### Steps
```bash
cp .env.example .env          # then fill in secrets
npm install
npm run db:migrate            # create / update schema
npm run dev                   # dashboard + API only, http://localhost:4000
# — or, for real phone calls —
npm run dev:tunnel            # starts ngrok, rewrites PUBLIC_BASE_URL + CORS_ORIGIN in .env,
                              # prints the Twilio webhook URL, then runs npm run dev
```

`npm run dev` uses `tsx watch` (hot reload). The dashboard SPA is served from the repo root at `/`.

### Why the tunnel?
Twilio Media Streams needs a public **WSS** endpoint. `localhost` is unreachable from Twilio, so for live calls you need ngrok (dev) or a real public HTTPS host (prod). `scripts/tunnel.sh` automates the dev path and even lists `live` agents' webhook URLs from the DB.

### Useful scripts
| Command              | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | Watch-mode dev server                    |
| `npm run dev:tunnel` | ngrok tunnel + dev server                |
| `npm run build`      | `tsc` → `dist/`                          |
| `npm start`          | Run compiled `dist/src/server.js`        |
| `npm run db:migrate` | Apply pending SQL migrations             |
| `npm run typecheck`  | `tsc --noEmit`                           |

---

## 6. Database

### Schema (migration `001_initial.sql` + `002_agent_voice.sql`)
- `users` — accounts (bcrypt password hash).
- `agents` — agent config: persona, `system_prompt`, `booking_enabled`, `status` (`draft|provisioning|live|paused|archived`), `business_type` (`clinic|auto|tech|other`), `voice`, `twilio_phone_number`, `twilio_phone_sid`. Scoped by `user_id`.
- `prompt_versions` — history of generated prompts per agent.
- `knowledge_documents` — uploaded KB text per agent.
- `calls` — one row per call: `call_sid`, `caller_phone`, `outcome`, `sentiment`, `sentiment_score`, `summary`, timestamps.
- `call_turns` — transcript turns (`caller` / `agent`), ordered by `created_at`.
- `bookings` — `name`, `phone`, `booking_date` (**`date` type**), `booking_time` (text), `service`, `status` (`pending` default), `details` (jsonb). Linked to agent + call.
- `support_tickets` — escalations.
- `agent_events` — audit/event log feeding analytics + SSE.
- `schema_migrations` — applied migration ids.

All operational tables are scoped by `agent_id` with `ON DELETE CASCADE`; agents are scoped by `user_id`.

### Migrations
[src/db/migrate.ts](src/db/migrate.ts) is a **forward-only** runner: it creates `schema_migrations`, reads `db/migrations/*.sql` sorted by filename, and applies any not yet recorded — all inside one transaction (rolls back on error). To add a migration, create `db/migrations/00N_description.sql`; it runs on next `npm run db:migrate` (and automatically on container start in `docker-compose`). There is no down/rollback mechanism — write additive migrations.

Because `booking_date` is a real `date` column, the voice runtime normalizes LLM-produced dates to `YYYY-MM-DD` in the present/future before inserting (see §7).

---

## 7. Voice runtime internals (`/ws`)

This is the heart of the system, in [src/routes/twilio.ts](src/routes/twilio.ts). One WebSocket = one call. Lifecycle:

1. **`connected` / `start`** — Twilio sends `start` with `streamSid` and `customParameters.agentId` (the URL query `agentId` takes priority). The handler loads the agent, creates a `calls` row, builds the system prompt, and plays the greeting via TTS.
2. **System prompt assembly** (per call, at `start`):
   - Current date/time computed in **`Asia/Kolkata`** with an explicit ISO date (`YYYY-MM-DD`) and current year.
   - **Date rules** forbidding past dates/years and instructing relative-date resolution from "today".
   - **Memory directive** telling the model never to re-ask for facts already given.
   - The agent's `system_prompt` + optional `KNOWLEDGE BASE`.
   - **End-call rules**: end only on a confirmed booking or a clear caller goodbye; emit `END_CALL` on its own line as the last token after a short closing line.
   - **Booking format** (if `booking_enabled`): emit `BOOK:{json}` once, then confirm, then `END_CALL`.
3. **`media` (inbound audio)** — μ-law @ 8 kHz, 20 ms chunks. A **VAD** (RMS threshold) buffers speech and detects end-of-utterance after ~1 s of silence (`SILENCE_CHUNKS_END=50`), with a 30 s safety cap and a 160 ms minimum to ignore blips. Sustained loud speech while the bot is talking triggers a **barge-in interrupt** (`INTERRUPT_*` thresholds): it clears playback and starts a new turn.
4. **`processTurn`** — the core pipeline:
   - **STT**: Sarvam first; on failure, Groq Whisper fallback; empty transcript → skip.
   - **Fact extraction** → `callerInfo` (persists for the whole call):
     - First caller utterance is pinned as `reason` (e.g. "I have a hair problem").
     - `extractName()` handles single names, full names, and patient phrasing with a stopword guard against false positives ("I'm calling…").
     - Phone via regex (Indian mobile + generic fallback).
   - **Memory pinning**: `callerInfo` is injected into the system prompt each turn so facts survive even after history trimming (keep first 2 + last 12 messages beyond 16).
   - **LLM (streaming)**: `groqChatPipelined` streams tokens; complete sentences are sent to TTS *as they arrive* (`enqueueAudio`), so the caller hears the first sentence while the model is still generating. A `stale()` check cancels playback if the caller interrupts or speaks again.
   - **Control tokens** (`extractControlTokens`): `BOOK:{…}`, `TICKET:{…}`, `END_CALL` are stripped from spoken text.
   - **Booking**: on a `BOOK` token with a real name + phone (placeholders rejected), `normalizeBookingDate()` forces the date into the present/future, then a `bookings` row is created (once per call).
   - **Hang-up**: after a confirmed booking *or* an `END_CALL` token (and not interrupted), the call closes after the closing audio finishes. `closeCall()` records outcome + post-call sentiment, emits SSE, and **closes the WebSocket** — which, with `<Connect><Stream>`, hangs up the PSTN call.
5. **`stop` / socket close / error** → `closeCall()`.

Concurrency control uses `turnGeneration` (bumped on interrupt) and `isProcessing` + `pendingTurn` so a new utterance supersedes an in-flight one without dropping the caller's latest speech.

### Audio conversions ([src/lib/audio.ts](src/lib/audio.ts))
- `twilioMulawToWhisperWav` — μ-law 8 kHz → WAV for STT.
- `sarvamWavToTwilioMulaw` — Sarvam WAV → μ-law 8 kHz for Twilio playback.
- `mulawRms` — energy estimate for VAD.

---

## 8. HTTP API reference

All `/api/*` (except auth + `/api/info`) require `Authorization: Bearer <JWT>`. Errors are normalized by the central handler in [src/app.ts](src/app.ts): Zod → `400 VALIDATION_ERROR`, `AppError` → its status/code, else `500 INTERNAL_SERVER_ERROR`.

**Auth**
- `POST /api/auth/register` — create account → `{ token, user }`
- `POST /api/auth/login` — → `{ token, user }`
- `GET /api/me` — current user
- `GET /api/info` — public build/config info

**Agents**
- `GET /api/agents` · `POST /api/agents` · `GET /api/agents/:id` · `PUT /api/agents/:id`
- `POST /api/agents/generate-prompt` — LLM-generate a system prompt
- `POST /api/agents/:id/provision` — assign `TWILIO_PHONE_NUMBER` + update the Twilio voice webhook to this agent; sets status `live`
- `POST /api/agents/:id/stop` · `POST /api/agents/:id/resume`
- `POST /api/agents/:id/chat` — text test harness for the agent
- `POST /api/agents/:id/knowledge` — upload KB (multipart; DOCX parsed via mammoth)
- `GET /api/agents/:id/analytics`
- `GET /api/agents/:id/sse` — Server-Sent Events stream of live events

**Calls & bookings**
- `GET /api/agents/:id/calls` · `GET /api/agents/:id/calls/:callId`
- `GET /api/agents/:id/bookings` · `PUT /api/agents/:id/bookings/:bookingId`

**Voice runtime & health**
- `GET|POST /twilio/voice?agentId=:id` — returns Media Streams TwiML
- `GET /ws?agentId=:id` — Twilio Media Streams WebSocket
- `GET /healthz` — `{ ok, service, at }`; runs `SELECT 1` against Postgres

---

## 9. External integrations

- **Groq** ([llm.ts](src/services/llm.ts), [stt.ts](src/services/stt.ts), [sentiment.ts](src/services/sentiment.ts)): Chat Completions with streaming; model fallback chain; `temperature 0.3`, short `max_tokens` for latency. Whisper used only as STT fallback. Sentiment computed once post-call.
- **Sarvam** ([sarvam.ts](src/services/sarvam.ts)): TTS (`/text-to-speech`, default voice `priya`) and STT (`/speech-to-text`, `en-IN`).
- **Twilio** ([services/twilio.ts](src/services/twilio.ts)): `mediaStreamTwiml` returns `<Connect><Stream url="wss://…/ws?agentId=…">`; `provisionPhoneNumber` / `updateTwilioWebhook` set the number's `VoiceUrl` to `PUBLIC_BASE_URL/twilio/voice?agentId=…`. With no Twilio creds, provisioning returns a `DEV-<id>` placeholder so the dashboard still works offline.

Each integration degrades gracefully: missing keys disable that capability rather than crashing the server.

---

## 10. Build & run (production process)

```bash
npm ci
npm run build            # → dist/
npm run db:migrate       # apply schema
NODE_ENV=production node dist/src/server.js
```

The runtime serves both the API and the static dashboard (`index.html`, `styles.css`, `app.js`) from the working directory, so those files must sit alongside `dist/` (the Dockerfile copies them).

Graceful shutdown: `SIGINT`/`SIGTERM` close the Fastify server and the PG pool ([src/server.ts](src/server.ts)).

---

## 11. Deployment & hosting

### Option A — Docker Compose (single host)
[docker-compose.yml](docker-compose.yml) brings up `postgres` (with healthcheck + named volume) and `api`. The `api` container runs migrations then the server:

```bash
docker compose up --build -d
```

The [Dockerfile](Dockerfile) is multi-stage (deps → build → slim runtime on `node:22-alpine`, `npm ci --omit=dev`). **Before deploying, override the compose defaults** — `JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGIN`, and add `GROQ_API_KEY`, `SARVAM_API_KEY`, `TWILIO_*` (the committed compose file has placeholder secrets and no provider keys).

### Option B — Managed platform (Render / Railway / Fly / ECS, etc.)
- Build: `npm ci && npm run build`; Start: `node dist/src/server.js`.
- Run `npm run db:migrate` as a release/pre-deploy step (or keep the compose-style `migrate && start` command).
- Use a managed Postgres; set `DATABASE_URL` (add `?sslmode=require` if the provider needs TLS).
- Bind `HOST=0.0.0.0` and the platform's `PORT`.

### Critical hosting requirements for live calls
1. **Public HTTPS + WSS.** `PUBLIC_BASE_URL` must be a real `https://` origin. The app derives the Media Streams URL by swapping the scheme to `wss://`, so your TLS/reverse proxy **must upgrade and proxy WebSockets** on `/ws`. Twilio will not connect to plain `ws://` or to localhost.
2. **Reverse proxy / `trustProxy`.** Fastify runs with `trustProxy: true`, so deploy behind a TLS-terminating proxy (Nginx, Caddy, ALB, Cloudflare). Ensure it forwards `Upgrade`/`Connection` headers and uses a generous idle/read timeout (calls can run minutes). Disable response buffering on `/api/agents/:id/sse` (SSE) and `/ws`.
3. **Twilio webhook.** After deploy, point the number's *A call comes in* webhook to `https://<host>/twilio/voice?agentId=<AGENT_ID>` (POST), or use the in-app **Provision** action which sets it for you.
4. **Outbound egress** to `api.groq.com` and `api.sarvam.ai` must be allowed.

### Example Nginx location (WebSocket + SSE)
```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;       # long calls
    proxy_buffering off;           # SSE + streamed audio
}
```

### Scaling notes
- **SSE hub is in-process** ([lib/sseHub.ts](src/lib/sseHub.ts)). With multiple instances behind a load balancer, an event published on one node won't reach a dashboard connected to another. For horizontal scale, make the LB **sticky** for `/api/agents/:id/sse` and `/ws`, or replace the hub with Redis pub/sub.
- **A call lives on one process** — the Twilio WebSocket pins the whole call to a single instance; rolling deploys drop active calls (drain before deploy).
- **PG pool** is 20 (prod) per instance; size your database `max_connections` for `instances × 20` plus headroom.
- The single Twilio number means a single concurrent "phone identity"; multi-tenant call routing requires more numbers (one webhook → one agent each).

---

## 12. Observability & operations

- **Health:** `GET /healthz` returns `200` with `{ ok: true }` only when Postgres responds. Use it as the platform liveness/readiness probe (compose already healthchecks Postgres).
- **Logs:** Fastify structured logger — `debug` in dev, `info` in prod. Call lifecycle (`Caller spoke`, STT fallbacks, LLM failures, booking skips, end-of-call) is logged with context.
- **Events & analytics:** `agent_events` is the audit trail; `/api/agents/:id/analytics` aggregates it; SSE streams it live.
- **Backups:** all durable state is in Postgres — back up the database (and the compose `voiceagentos_pg` volume).

### Troubleshooting quick reference
| Symptom | Likely cause / check |
| ------- | -------------------- |
| Twilio call connects then silence | `/ws` not proxied as WebSocket, or `PUBLIC_BASE_URL` not `https`/wrong host |
| Server exits at boot | `DATABASE_URL` missing or `JWT_SECRET` < 24 chars (Zod fails fast) |
| Dashboard shows wrong agent number | DB column drifted from live Twilio `voice_url`; re-provision the intended agent |
| No bot voice / no transcription | `SARVAM_API_KEY` empty (TTS+STT off); check Groq Whisper fallback + `GROQ_API_KEY` |
| Booking saved with wrong year | should be auto-corrected by `normalizeBookingDate`; verify server timezone handling |
| SSE updates missing under load | multiple instances without sticky sessions — pin LB or move to Redis |

---

## 13. Security checklist (production)

- [ ] Strong, unique `JWT_SECRET` (≥ 24 chars; rotate on suspected compromise).
- [ ] `CORS_ORIGIN` set to the real dashboard origin(s), **not** `*`.
- [ ] TLS everywhere; HSTS at the proxy (Helmet is enabled; CSP is currently off — add one if you lock down the SPA).
- [ ] Secrets via the platform's secret store / env, never committed (the sample `docker-compose.yml` ships placeholders).
- [ ] Restrict Postgres network exposure; don't publish `5432` publicly in production compose.
- [ ] Consider validating Twilio request signatures on `/twilio/voice` if the webhook URL could be guessed.
- [ ] Rate-limit `/api/auth/*` at the proxy.

---

## 14. Hosting walkthroughs — EC2 vs Vercel

### Can this run on Vercel? No (not the backend).

VoiceAgentOS depends on a **persistent inbound WebSocket** for Twilio Media Streams (`/ws`) that stays open for the whole call, plus a long-running Fastify process and a stateful in-process SSE hub. Vercel is serverless: functions are short-lived, can't accept long-lived inbound WebSocket upgrades, and the function instance can be torn down mid-request. So **the voice runtime cannot run on Vercel.**

What *is* possible (optional, not required): split the repo and host only a static dashboard front-end on Vercel while the Fastify backend (API + `/ws`) runs on EC2. But the dashboard here is already served by the same Fastify server, so this split adds work for no benefit. **Recommendation: host the whole app on EC2 (or any persistent VM/container host).** The rest of this section is the EC2 path.

---

### EC2 — prerequisites
- A domain you control (e.g. `voice.yourdomain.com`) — required because Twilio needs **HTTPS/WSS**, and TLS needs a hostname.
- Groq, Sarvam, and Twilio credentials.

### Step 1 — Launch the instance
1. EC2 → Launch instance. **Ubuntu Server 24.04 LTS**, `t3.small` (2 GB RAM; needed for the TypeScript build — `t3.micro`/1 GB can OOM during `npm run build`), 20 GB gp3 disk.
2. Create/assign a key pair for SSH.
3. **Security group inbound rules:**
   - `22` (SSH) — your IP only.
   - `80` (HTTP) — `0.0.0.0/0` (for Certbot + redirect).
   - `443` (HTTPS/WSS) — `0.0.0.0/0` (Twilio connects here).
   - Do **not** open `4000` or `5432` to the world.
4. Allocate an **Elastic IP** and associate it with the instance (so the IP survives reboots).
5. In your DNS, add an **A record** for your hostname → the Elastic IP.

### Step 2 — Get the code on the box
```bash
ssh -i your-key.pem ubuntu@<elastic-ip>
sudo apt update && sudo apt -y upgrade
# copy the project up (git clone, scp, or rsync). e.g.:
git clone <your-repo-url> voiceagentos && cd voiceagentos
```

You can now choose **Path A (Docker — recommended)** or **Path B (native Node + systemd)**.

---

### Path A — Docker Compose (recommended)
1. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
2. Harden the compose file so the app port is **not** public — bind it to localhost and remove the placeholder secrets. Edit `docker-compose.yml`:
   ```yaml
   api:
     ports:
       - "127.0.0.1:4000:4000"     # was "4000:4000"
   ```
   Provide real secrets via an env file instead of inline values. Create `.env` (compose reads it for `${VAR}` substitution, or use `env_file:`):
   ```bash
   # .env  (production)
   NODE_ENV=production
   PUBLIC_BASE_URL=https://voice.yourdomain.com
   CORS_ORIGIN=https://voice.yourdomain.com
   JWT_SECRET=<openssl rand -hex 32>
   DATABASE_URL=postgres://voiceagentos:<strong-pw>@postgres:5432/voiceagentos
   GROQ_API_KEY=...
   SARVAM_API_KEY=...
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
   ```
   Point the compose `api.environment` (and the `postgres` password) at these values. The `api` service already runs `migrate` then `server` on start.
3. Bring it up:
   ```bash
   docker compose up --build -d
   docker compose logs -f api        # watch boot + migrations
   curl -s http://127.0.0.1:4000/healthz   # {"ok":true,...}
   ```
4. Continue to **Step 3 (Nginx + TLS)** below.

> Postgres data persists in the `voiceagentos_pg` Docker volume. Back it up (`docker compose exec postgres pg_dump ...`). For production-grade durability, consider **Amazon RDS for PostgreSQL** instead — drop the `postgres` service and point `DATABASE_URL` at the RDS endpoint (`?sslmode=require`).

---

### Path B — Native Node + systemd
1. Install Node 20+ and Postgres (or use RDS):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt -y install nodejs postgresql
   sudo -u postgres psql -c "CREATE USER voiceagentos WITH PASSWORD 'strong-pw';"
   sudo -u postgres psql -c "CREATE DATABASE voiceagentos OWNER voiceagentos;"
   ```
2. Build and migrate:
   ```bash
   cd ~/voiceagentos
   npm ci
   npm run build
   sudo tee /etc/voiceagentos.env >/dev/null <<'EOF'
   NODE_ENV=production
   PORT=4000
   HOST=127.0.0.1
   PUBLIC_BASE_URL=https://voice.yourdomain.com
   CORS_ORIGIN=https://voice.yourdomain.com
   DATABASE_URL=postgres://voiceagentos:strong-pw@localhost:5432/voiceagentos
   JWT_SECRET=__run: openssl rand -hex 32__
   GROQ_API_KEY=...
   SARVAM_API_KEY=...
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
   EOF
   set -a && . /etc/voiceagentos.env && set +a && npm run db:migrate
   ```
3. Create a systemd service `/etc/systemd/system/voiceagentos.service`:
   ```ini
   [Unit]
   Description=VoiceAgentOS
   After=network.target postgresql.service

   [Service]
   WorkingDirectory=/home/ubuntu/voiceagentos
   EnvironmentFile=/etc/voiceagentos.env
   ExecStart=/usr/bin/node dist/src/server.js
   Restart=always
   RestartSec=3
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now voiceagentos
   sudo systemctl status voiceagentos
   curl -s http://127.0.0.1:4000/healthz
   ```

---

### Step 3 — Nginx reverse proxy + TLS (both paths)
TLS is mandatory: Twilio only connects over `https`/`wss`. Nginx terminates TLS and proxies to the app on `127.0.0.1:4000`, upgrading WebSockets.

```bash
sudo apt -y install nginx
sudo tee /etc/nginx/sites-available/voiceagentos >/dev/null <<'NGINX'
server {
    listen 80;
    server_name voice.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # WebSocket upgrade for /ws
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;                    # long calls
        proxy_buffering off;                        # SSE + streamed audio
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/voiceagentos /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Issue + auto-renew a Let's Encrypt cert (rewrites the server block to 443 + HTTP→HTTPS redirect)
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d voice.yourdomain.com --redirect -m you@example.com --agree-tos -n
```

Verify from your laptop: `https://voice.yourdomain.com/healthz` returns `{"ok":true,...}`.

### Step 4 — Wire up Twilio
1. Twilio Console → Phone Numbers → your number → **Voice & Fax → A call comes in**:
   - Webhook: `https://voice.yourdomain.com/twilio/voice?agentId=<AGENT_ID>`, method **POST**.
   - (Or just hit **Provision** on the agent in the dashboard — it sets this webhook for you, since `PUBLIC_BASE_URL` now points at your domain.)
2. Make sure `PUBLIC_BASE_URL` matches the domain exactly — the app derives the `wss://voice.yourdomain.com/ws` Media Streams URL from it.
3. Place a test call and watch logs (`docker compose logs -f api` or `journalctl -u voiceagentos -f`).

### Step 5 — Operational notes for EC2
- **Updates/deploys:** `git pull && docker compose up --build -d` (Path A) or `git pull && npm ci && npm run build && npm run db:migrate && sudo systemctl restart voiceagentos` (Path B). Active calls drop on restart — deploy during a quiet window.
- **Scaling:** the in-process SSE hub and per-call WebSocket pinning mean a single instance is simplest. If you ever put this behind an ALB with >1 instance, enable **sticky sessions** for `/ws` and `/api/agents/:id/sse`, or move the SSE hub to Redis (see §11).
- **Cost/right-sizing:** a single `t3.small` comfortably handles low call volume. CPU spikes are mostly during the build; consider building a Docker image in CI and pulling it rather than building on the box.
- **Backups:** snapshot the Postgres volume / use RDS automated backups; keep `JWT_SECRET` and provider keys in a secret store, not in the repo.
