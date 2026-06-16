# VoiceAgentOS — Product Requirements Document
### No-Code AI Voice Agent Builder · MVP v1.0
**Prepared for:** Achu / Nyxtry  
**Date:** May 2026  
**Status:** MVP Scoping

---

## 1. Executive Summary

VoiceAgentOS is a no-code SaaS platform that lets any business — a clinic, car dealership, or tech company — spin up a fully operational AI voice receptionist in under 10 minutes. Users register, describe their business in plain language, upload supporting documents, and receive a live phone agent. The platform auto-generates the system prompt, stores it as editable memory, handles inbound/outbound calls via Twilio, performs real-time booking, captures sentiment, and delivers per-call analytics on a premium dashboard.

The MVP is built on the existing Aria stack (Fastify + Next.js + Groq + Sarvam TTS/STT + Twilio ConversationRelay) and extends it into a multi-tenant, self-serve product.

---

## 2. Problem Statement

Small and mid-size businesses waste significant revenue on missed calls, inconsistent receptionist quality, and after-hours silence. Existing solutions are either too expensive (enterprise voice AI), too rigid (IVR), or require developer resources to configure. There is a gap for a truly no-code voice agent platform that produces domain-specific, persona-driven agents from a business description alone.

---

## 3. Goals & Success Metrics

| Goal | Metric | MVP Target |
|------|--------|-----------|
| Time-to-live-agent | Minutes from sign-up to first call handled | ≤ 10 minutes |
| Prompt quality | % of auto-generated prompts rated "good" by user without edits | ≥ 70% |
| Call completion | % of calls reaching natural closure (agent ends call politely) | ≥ 85% |
| Booking accuracy | % of bookings correctly captured from voice to table | ≥ 90% |
| Retention | % of users returning after first live call | ≥ 60% (30-day) |

---

## 4. Target Users

| Persona | Description | Primary Use Case |
|---------|-------------|-----------------|
| **Clinic Owner** | GP, dental, or specialist clinic; 1–5 staff | Appointment booking, FAQ, triage routing |
| **Auto Dealer** | Car showroom or service center | Test drive booking, service scheduling |
| **Tech SMB** | SaaS company or IT services firm | L1 support, ticket intake, escalation |
| **Solo Operator** | Salon, tutor, consultant | Call-handling when unavailable |

---

## 5. Scope — MVP vs. Future

### MVP (v1.0)
- User registration & authentication
- Agent creation wizard (business description → auto-prompt)
- Document/knowledge upload (clinic plans, FAQs, menus, price lists)
- Auto-generated system prompt with editable memory
- 3 pre-built agent templates: Clinic Receptionist, Car Booking, Tech Support
- Twilio phone number provisioning (one per agent)
- Inbound call handling (Twilio ConversationRelay → Groq → Sarvam TTS)
- **Call-end detection** — agent gracefully terminates calls when conversation concludes
- Real-time booking table (auto-populated from booking agent calls)
- Per-call log: transcript, duration, sentiment score, outcome
- Dashboard: calls today, bookings, sentiment trend, agent status
- Prompt editor (view, edit, save prompt versions)
- Basic SSE dashboard refresh

### Deferred to v2
- Outbound calling campaigns
- Multi-agent per account
- CRM integrations (Salesforce, HubSpot, Zoho)
- WhatsApp/SMS follow-up after call
- Multi-language agent switching mid-call
- Voice persona customization (accent, gender, pitch)
- Custom analytics & CSV export
- Team member access / role-based permissions

---

## 6. User Flows

### 6.1 Onboarding & Agent Creation

```
Sign Up → Email Verification → Business Setup Wizard
  Step 1: Business name, type (clinic / auto / tech / other), phone country
  Step 2: Upload documents (PDF, DOCX, TXT — plans, FAQs, pricing)
  Step 3: Select agent persona template
  Step 4: Review auto-generated prompt → Edit if needed → Save
  Step 5: Provision Twilio phone number → Agent is LIVE
```

### 6.2 Inbound Call Flow (Runtime)

```
Caller dials provisioned number
→ Twilio webhook hits POST /twilio/voice?agentId={id}
→ Server loads agent config (system prompt, tools, booking flag)
→ Returns TwiML <ConversationRelay>
→ WebSocket opens at /ws?agentId={id}
→ STT: Sarvam transcribes caller speech
→ Groq generates response using agent system prompt + conversation history
→ Response includes optional BOOK:{...} token
→ TTS: Sarvam synthesizes voice response
→ Call-end detection: when Groq returns END_CALL signal → server sends <Stop> to Twilio
→ Post-call: sentiment analysis job runs, call log saved, booking extracted
```

### 6.3 Booking Flow (Booking-enabled agents)

```
During call: Groq detects booking intent → asks clarifying questions (name, date, service)
→ Groq emits BOOK:{name, date, time, service, phone}
→ Server parses token → inserts row into bookings table (agentId, timestamp, details)
→ SSE push to dashboard → booking appears in real-time table
→ Caller receives verbal confirmation + booking reference
```

### 6.4 Call-End Detection

The agent must end calls gracefully. Two mechanisms:

**A. LLM-initiated (primary):** Groq prompt instructs agent to output `END_CALL` as a standalone token when the conversation has reached a natural close (all questions answered, booking confirmed, or user says goodbye). Server intercepts this token, sends TwiML `<Stop>` to Twilio, and terminates the WebSocket.

**B. Silence/timeout fallback:** If no speech is detected for 8 seconds after agent last spoke, and the agent has asked "Is there anything else I can help you with?" once, send farewell TTS + END_CALL.

---

## 7. Agent Templates — System Prompts

### 7.1 Clinic Receptionist

**Persona:** Friendly, calm, professional medical receptionist  
**Voice tone:** Warm, reassuring, clear  
**Booking-enabled:** Yes  

```
You are {clinic_name}'s virtual receptionist. Your name is {agent_name}.

CLINIC INFORMATION:
{clinic_knowledge_base}

YOUR ROLE:
- Greet callers warmly and identify their need
- Book, reschedule, or cancel appointments
- Answer questions about services, timings, and location
- Triage urgency: if caller describes an emergency, instruct them to call 108/112 immediately
- Collect: caller name, preferred date/time, doctor preference (if applicable), reason for visit

BOOKING FORMAT: When ready to confirm, output exactly:
BOOK:{"name":"...","date":"...","time":"...","doctor":"...","reason":"...","phone":"..."}

CONVERSATION RULES:
- Never diagnose or give medical advice
- If unsure, offer to connect with the clinic directly during working hours
- Keep responses concise — no more than 3 sentences per turn
- When the caller is satisfied and says goodbye, respond warmly and output END_CALL

CLINIC HOURS: {hours}
LOCATION: {address}
EMERGENCY LINE: Advise to call 108
```

**Sample call flow:**

> Agent: "Thank you for calling {Clinic Name}. This is Aria, how can I help you today?"  
> Caller: "I need to book an appointment with Dr. Sharma for next Tuesday"  
> Agent: "Of course! May I have your name and a preferred time on Tuesday?"  
> Caller: "Ravi Kumar, around 11am"  
> Agent: "Perfect. I've booked Ravi Kumar with Dr. Sharma on Tuesday at 11:00 AM. You'll receive a confirmation shortly. Is there anything else I can help you with?"  
> Caller: "No, thanks"  
> Agent: "Have a great day, Ravi. Take care!" → END_CALL

---

### 7.2 Car Booking Agent

**Persona:** Enthusiastic, knowledgeable automotive consultant  
**Voice tone:** Confident, helpful, premium feel  
**Booking-enabled:** Yes  

```
You are a virtual sales consultant for {dealership_name}. Your name is {agent_name}.

DEALERSHIP INFORMATION:
{dealership_knowledge_base}

YOUR ROLE:
- Greet callers and understand their vehicle interest (new car, test drive, service)
- Recommend models based on stated budget and preference
- Schedule test drives or service appointments
- Answer questions about features, pricing, finance options, and availability
- Capture lead details for follow-up

BOOKING FORMAT:
BOOK:{"name":"...","phone":"...","date":"...","time":"...","model":"...","type":"test_drive|service|enquiry"}

CONVERSATION RULES:
- Never quote exact final prices — say "starting from ₹X" and offer to connect with a sales advisor for specifics
- Do not discuss competitor vehicles
- If the caller is ready to visit, confirm the showroom address and parking info
- After booking, confirm details verbally and thank them
- When conversation ends naturally, respond politely and output END_CALL

SHOWROOM HOURS: {hours}
ADDRESS: {address}
```

**Sample call flow:**

> Agent: "Welcome to {Dealership}! I'm Alex, your virtual consultant. Are you looking to explore a new car, book a test drive, or schedule a service?"  
> Caller: "I want to test drive the new Creta"  
> Agent: "Excellent choice! The new Creta is very popular right now. May I know your name and what date works for you?"  
> Caller: "Priya, this Saturday morning"  
> Agent: "Saturday works perfectly. What time — 10 AM or 11 AM, Priya?"  
> Caller: "10 is fine"  
> Agent: "Confirmed! Test drive for Priya on Saturday at 10 AM for the Hyundai Creta. We'll see you then!" → END_CALL

---

### 7.3 Tech Support Agent

**Persona:** Patient, technically proficient support specialist  
**Voice tone:** Calm, methodical, empathetic  
**Booking-enabled:** No (escalation-focused)  

```
You are {company_name}'s Level-1 support agent. Your name is {agent_name}.

PRODUCT INFORMATION:
{product_knowledge_base}

YOUR ROLE:
- Greet the caller and understand their issue
- Gather: account/order ID, product/feature affected, error message or behavior
- Walk through standard troubleshooting steps from the knowledge base
- If issue is resolved: confirm, log it, and close the call
- If unresolved: collect caller email and phone, promise a callback from the team within {sla_hours} hours, and create a ticket

TICKET FORMAT:
TICKET:{"name":"...","phone":"...","email":"...","issue":"...","product":"...","priority":"low|medium|high"}

CONVERSATION RULES:
- Speak in plain language; avoid jargon unless the caller uses it first
- Never promise features that don't exist
- For billing disputes, always escalate to human — do not attempt resolution
- If the caller is frustrated: acknowledge, empathize ("I completely understand how frustrating this is"), then proceed
- When issue is resolved or escalated and caller is satisfied, output END_CALL

SLA: First response within {sla_hours} hours
SUPPORT EMAIL: {support_email}
```

**Sample call flow:**

> Agent: "Hello, thanks for calling {Company} support. I'm Sam. Can I get your name and a brief description of the issue?"  
> Caller: "I'm Ankit. My dashboard keeps showing a 404 error after I log in"  
> Agent: "Ankit, let's sort this out. Can you try clearing your browser cache and logging in again? I'll wait."  
> Caller: "Still same issue"  
> Agent: "Got it. This looks like an account configuration issue. I'll flag this for our team. Can I get your email address so we can follow up within 4 hours?"  
> Caller: "ankit@example.com"  
> Agent: "Done, Ankit. Ticket raised. Our team will reach out to ankit@example.com within 4 hours. Anything else?"  
> Caller: "No, thanks"  
> Agent: "Thank you for your patience. Have a good day!" → END_CALL

---

## 8. Technical Architecture

### 8.1 Multi-Tenant Extension to Existing Stack

The existing Aria codebase (single-tenant) is extended as follows:

**New data stores (in-memory for MVP, migrate to Postgres in v2):**
```
agents: { id, userId, name, persona, systemPrompt, promptVersion, knowledgeBase, bookingEnabled, twilioPhoneNumber, createdAt }
users:  { id, email, passwordHash, plan, createdAt }
calls:  { id, agentId, callSid, transcript, sentiment, sentimentScore, outcome, duration, startedAt, endedAt }
bookings: { id, agentId, callId, name, phone, date, time, service/model/doctor, status, createdAt }
```

**Modified Twilio routes:**
```
POST /twilio/voice?agentId={id}   → loads agent config, returns ConversationRelay TwiML
WS   /ws?agentId={id}             → uses agent's system prompt for Groq calls
```

**New API routes (Fastify):**
```
POST /api/auth/register
POST /api/auth/login
GET  /api/agents                  → list agents for user
POST /api/agents                  → create agent
PUT  /api/agents/:id              → update prompt / config
POST /api/agents/:id/knowledge    → upload + process knowledge doc
GET  /api/agents/:id/calls        → paginated call history
GET  /api/agents/:id/bookings     → booking table
GET  /api/agents/:id/analytics    → aggregated metrics
POST /api/agents/:id/provision    → provision Twilio number
GET  /api/agents/:id/sse          → SSE stream for live dashboard
```

**Prompt auto-generation flow:**
```
User fills wizard form → POST /api/agents/generate-prompt
→ Groq call with meta-prompt:
  "You are a system prompt engineer. Given this business info: {input}, 
   generate a comprehensive voice agent system prompt for a {template} agent.
   Include persona, rules, knowledge base injection points, booking format, and END_CALL instruction."
→ Return generated prompt → user reviews → saved as promptVersion 1
```

**Sentiment analysis (post-call):**
```
After call ends → POST /api/sentiment (internal)
→ Send full transcript to Groq:
  "Analyze this call transcript. Return JSON: 
   {sentiment: 'positive|neutral|negative', score: 0-100, 
    summary: '1 sentence', keyIssues: [], resolved: true|false}"
→ Store in calls table → push to dashboard via SSE
```

### 8.2 Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) |
| Backend API | Fastify (Node.js) |
| LLM | Groq (Llama 4 Scout primary, fallback chain) |
| STT/TTS | Sarvam AI |
| Telephony | Twilio ConversationRelay |
| Auth | JWT + bcrypt (MVP); NextAuth v5 in v2 |
| Storage | In-memory Map (MVP) → Postgres + S3 (v2) |
| Tunnel | ngrok (dev) → production domain (v2) |
| Realtime | Server-Sent Events (SSE) |

### 8.3 Groq Prompt Configuration

**Model:** `meta-llama/llama-4-scout-17b-16e-instruct`  
**Fallback:** `llama-3.3-70b-versatile` → `llama-3.1-8b-instant`

Special output tokens the server must intercept and NOT pass to TTS:
- `END_CALL` → trigger call termination
- `BOOK:{...}` → parse and save booking
- `TICKET:{...}` → parse and save support ticket

---

## 9. Dashboard — Key Screens

### 9.1 Agent Overview Dashboard
- Total calls today / this week / this month
- Average call duration
- Sentiment breakdown (positive / neutral / negative) — donut chart
- Live call indicator (SSE-powered)
- Recent calls list (last 10 with transcript preview)
- Bookings today count

### 9.2 Bookings Table (booking-enabled agents)
- Columns: Name, Phone, Date, Time, Service/Model/Doctor, Status (Pending/Confirmed/Cancelled), Call ID
- Inline status edit
- Export to CSV (v2)
- Filter by date range

### 9.3 Call Detail View
- Full transcript (speaker-separated)
- Sentiment score badge + timeline
- Call duration, start/end time
- Agent version used (prompt version)
- Outcome: Resolved / Escalated / Booking / Dropped

### 9.4 Prompt Editor
- Textarea with syntax highlighting (key tokens highlighted: BOOK, END_CALL, TICKET)
- Version history (v1, v2, …)
- "Test this prompt" → opens web chat console with selected prompt
- Save & Deploy button

---

## 10. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Call setup latency (webhook to first TTS word) | < 2 seconds |
| TTS generation latency | < 800ms per turn |
| Concurrent calls per agent | ≥ 5 (MVP) |
| Platform uptime | 99% (dev MVP) |
| Transcript accuracy (Sarvam STT) | ≥ 85% WER |
| Data retention | 90 days for calls/transcripts (MVP) |

---

## 11. Open Questions / Decisions Needed

| # | Question | Default Assumption |
|---|----------|--------------------|
| OQ-01 | Twilio number provisioning: auto-assign or user selects area code? | Auto-assign, India numbers |
| OQ-02 | Knowledge base: how many MB per upload? | 5 MB per doc, 3 docs max (MVP) |
| OQ-03 | Billing model: per-minute or per-call? | Per-call (MVP, flat rate) |
| OQ-04 | Should booking notifications go via SMS/WhatsApp? | Email only for MVP |
| OQ-05 | Multi-language: auto-detect or user-configured? | Fixed language per agent (MVP) |

---

## 12. MVP Development Milestones

| Sprint | Deliverable | Duration |
|--------|-------------|----------|
| S1 | Multi-tenant data model + auth routes | 1 week |
| S2 | Agent creation wizard + prompt auto-generation | 1 week |
| S3 | Knowledge upload + injection into Groq context | 1 week |
| S4 | Multi-tenant Twilio routing (agentId in webhook) | 3 days |
| S5 | END_CALL detection + graceful call termination | 2 days |
| S6 | Booking table + real-time SSE push | 3 days |
| S7 | Sentiment analysis post-call job | 2 days |
| S8 | Dashboard screens (Next.js) | 1 week |
| S9 | Premium landing page + pricing page | 3 days |
| S10 | QA, lint, end-to-end call tests | 3 days |

**Total estimated MVP:** ~6 weeks

---

## 13. Pricing (Suggested)

| Plan | Monthly | Calls/month | Agents | Bookings | Support |
|------|---------|-------------|--------|----------|---------|
| Starter | ₹999 | 100 | 1 | Included | Email |
| Growth | ₹2,499 | 500 | 3 | Included | Priority |
| Pro | ₹5,999 | Unlimited | 10 | Included | Dedicated |

Overage: ₹2/call beyond plan limit.

---

*End of VoiceAgentOS PRD v1.0*
