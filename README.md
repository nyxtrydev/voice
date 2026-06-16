# VoiceAgentOS

A no-code AI voice agent platform. Create agents in minutes, deploy to a phone number, and start handling real calls with Groq LLM + Sarvam TTS/STT.

## Stack

- React 18 + TypeScript dashboard (Vite) in [`web/`](web/) — a **separate** nginx-served service that proxies `/api` to the backend
- Fastify 5 API + WebSocket (Twilio Media Streams)
- PostgreSQL 16
- JWT auth with bcrypt
- Groq LLM (llama-4-scout) + fallback models
- Sarvam AI — TTS and STT
- Twilio — phone numbers, Media Streams
- ngrok — local tunnel for Twilio webhooks
- Server-Sent Events for live dashboard updates
- TypeScript strict mode

## Local Setup

### Prerequisites

- Node.js 20+
- PostgreSQL running (or `docker compose up -d postgres`)
- ngrok installed and authenticated (`ngrok config add-authtoken <YOUR_TOKEN>`)
- Twilio account with a phone number
- Groq API key
- Sarvam API key

### Steps

1. Copy and fill environment variables:

```bash
cp .env.example .env
# Edit .env and set all required keys
```

2. Start Postgres:

```bash
docker compose up -d postgres
```

3. Install dependencies:

```bash
npm install
```

4. Run migrations:

```bash
npm run db:migrate
```

5. Start the API + ngrok tunnel (required for Twilio calls):

```bash
npm run dev:tunnel
```

This starts ngrok, updates `PUBLIC_BASE_URL` in `.env`, prints your Twilio webhook URL, and starts the dev server — all in one command.

> **Why the tunnel?** Twilio's Media Streams WebSocket needs a public HTTPS/WSS URL to connect to your local server. `npm run dev` alone won't work for real phone calls because `localhost` is unreachable from Twilio.

If you only need the API (no real calls), you can run just the backend:

```bash
npm run dev
```

The API listens on `http://localhost:4000` (API-only — it does **not** serve the dashboard).

### Frontend / backend are separate services

The dashboard lives in [`web/`](web/) (React + TypeScript + Vite) and is deployed
independently of the API. Nothing in the backend serves the SPA.

**Local development (hot reload):** run the backend and the Vite dev server side by side:

```bash
npm run dev        # backend API on :4000
npm run dev:web    # Vite dev server on :5173 (proxies /api, /ws, /twilio → :4000)
```

Open `http://localhost:5173`.

**Production:** `docker compose up --build` runs three services — `postgres`, `api`
(backend), and `web` (nginx serving the built dashboard and proxying `/api` → `api:4000`).
The dashboard is then at `http://localhost:8080` and the API at `http://localhost:4000`.
To build the dashboard alone: `npm run build:web` (output in `web/dist`).

The previous vanilla-JS dashboard is preserved in [`legacy/`](legacy/) for reference.

### Twilio Webhook Setup

After running `dev:tunnel`, copy the printed webhook URL and set it in Twilio:

1. Go to [Twilio Console](https://console.twilio.com) → Phone Numbers → Manage
2. Click your phone number
3. Under **Voice & Fax → A call comes in**, set:
   - Webhook: `https://<your-ngrok-url>/twilio/voice?agentId=<AGENT_ID>`
   - Method: `HTTP POST`
4. Save

Your agent ID is shown in the dashboard after creating an agent.

## Production

Set strong values for:

- `JWT_SECRET`
- `DATABASE_URL`
- `PUBLIC_BASE_URL`
- `CORS_ORIGIN`
- `GROQ_API_KEY`
- `SARVAM_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Then run:

```bash
docker compose up --build
```

The `api` service runs migrations before starting.

## API Map

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`

Agents:

- `POST /api/agents/generate-prompt`
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:id`
- `PUT /api/agents/:id`
- `POST /api/agents/:id/provision`
- `POST /api/agents/:id/knowledge`
- `GET /api/agents/:id/analytics`
- `GET /api/agents/:id/sse`

Calls and bookings:

- `GET /api/agents/:id/calls`
- `GET /api/agents/:id/calls/:callId`
- `GET /api/agents/:id/bookings`
- `PUT /api/agents/:id/bookings/:bookingId`

Voice runtime:

- `GET|POST /twilio/voice?agentId=:id`
- `WS /ws?agentId=:id`

Health:

- `GET /healthz`

## Database

The first migration is `db/migrations/001_initial.sql`. It creates:

- `users`
- `agents`
- `prompt_versions`
- `knowledge_documents`
- `calls`
- `call_turns`
- `bookings`
- `support_tickets`
- `agent_events`
- `schema_migrations`

All operational data is scoped by `agent_id`, and agents are scoped by `user_id`.

## Verification Run Here

Completed:

```bash
npm run typecheck
npm run build
npm audit --omit=dev
```

Not completed in this environment:

- `docker compose up -d postgres`
- `npm run db:migrate`

Docker and `psql` are not installed in this machine image, so the database migration could not be executed locally here.
