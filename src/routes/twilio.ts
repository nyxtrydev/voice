import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { agentRepository, callRepository } from "../db/repositories.js";
import { twilioMulawToWhisperWav, mulawRms } from "../lib/audio.js";
import { publishAgentEvent } from "../lib/sseHub.js";
import { extractControlTokens, groqChatPipelined } from "../services/llm.js";
import { analyzeSentiment } from "../services/sentiment.js";
import { sarvamStt } from "../services/sarvam.js";
import { elevenLabsTts, resolveVoice } from "../services/elevenlabs.js";
import { transcribeAudio } from "../services/stt.js";
import { buildWelcomeGreeting, mediaStreamTwiml } from "../services/twilio.js";
import type { Agent } from "../types/domain.js";

const voiceQuery = z.object({ agentId: z.string().uuid() });
type ChatMsg = { role: "user" | "assistant"; content: string };

function valueOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Rejects LLM placeholders (<name>, "...", etc.) — only accepts real user input
function realValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length < 2) return null;
  if (/^[.<>\[\]]+$/.test(v) || /^<.+>$/.test(v)) return null;
  return v;
}

// Words that follow "I'm" / "this is" / "my name is" but are never a real name.
const NAME_STOPWORDS = new Set([
  "calling", "looking", "just", "fine", "good", "great", "not", "interested", "having",
  "trying", "here", "from", "sorry", "okay", "ok", "actually", "really", "still",
  "wondering", "hoping", "afraid", "about", "going", "gonna", "sure", "the", "a", "an",
  "my", "your", "with", "for", "and", "but", "very", "so", "hi", "hello", "hey", "yes",
  "no", "yeah", "well", "can", "could", "would", "need", "want", "like", "to", "in", "on"
]);

// Best-effort caller name extraction. Handles single first names ("I'm Achu"),
// full names, and patient-name phrasing. Returns a Title-Cased name or null.
function extractName(text: string): string | null {
  const patterns = [
    /\b(?:my|the patient(?:'s)?|patient(?:'s)?|his|her|their)\s+name\s+is\s+([a-z]+(?:\s+[a-z]+){0,2})/i,
    /\bname(?:'s| is)?[:\-]?\s+([a-z]+(?:\s+[a-z]+){0,2})/i,
    /\b(?:i am|i'?m|this is|it'?s|myself|call me)\s+([a-z]+(?:\s+[a-z]+){0,2})/i,
    /\b([a-z]+)\s+(?:here|speaking)\b/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const words: string[] = [];
    for (const w of m[1].trim().split(/\s+/)) {
      if (NAME_STOPWORDS.has(w.toLowerCase())) break;
      words.push(w);
      if (words.length === 3) break;
    }
    if (words.length && words[0].length >= 2) {
      return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }
  }
  return null;
}

// Forces an LLM booking date into the present/future. The model sometimes emits a
// past year (e.g. 2024) for relative dates like "tomorrow"; natural-language dates
// are left untouched so the LLM's own resolution stands.
function normalizeBookingDate(value: unknown, todayIso: string): string | null {
  const v = valueOrNull(value);
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v; // not ISO — leave as-is
  const today = new Date(`${todayIso}T00:00:00`);
  const dt = new Date(`${v}T00:00:00`);
  if (isNaN(dt.getTime()) || isNaN(today.getTime())) return v;
  if (dt.getFullYear() < today.getFullYear()) dt.setFullYear(today.getFullYear());
  if (dt < today) dt.setFullYear(dt.getFullYear() + 1); // still past → next occurrence
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// VAD — 20 ms chunks at 8 kHz (160 samples each)
// The caller speaks into the phone mic and is far louder than people in the
// room, so the RMS gate doubles as a proximity filter: a higher threshold
// rejects background voices that are audible but distant. Lower it toward 600
// if soft-spoken callers get cut off; raise it if room chatter still leaks in.
const SPEECH_RMS_THRESHOLD = 800;
const SILENCE_CHUNKS_END   = 45;   // 45 × 20 ms = 900 ms silence (end-of-turn) — enough patience for a mid-sentence thinking pause without making every reply feel laggy
const MAX_SPEECH_CHUNKS    = 1500; // 30 s safety cap
const MIN_SPEECH_CHUNKS    = 16;   // 16 × 20 ms = 320 ms minimum real speech — a brief background blurt won't trigger a turn
// Barge-in must be sustained long enough that a cough or short noise burst doesn't
// cut the bot off — a cough is a sharp transient that fades well before this.
// The counter decays (rather than hard-resetting) on quiet chunks, so the
// micro-gaps between real syllables don't keep knocking it back to zero —
// genuine "wait, stop" speech sustains long enough to reach the threshold.
// Tuned down from 25 because barge-in was effectively impossible: the caller could
// talk over the bot and it would keep going. Raise toward 18 (360 ms) if coughs
// or room noise start cutting the bot off again.
const INTERRUPT_MIN_CHUNKS = 12;   // 12 × 20 ms = 240 ms sustained speech before barging in over the bot

// Phrases Whisper emits when fed silence or faint background noise. Matched on
// the whole utterance only (normalized), so a real sentence containing "thank
// you" is never dropped.
const WHISPER_HALLUCINATIONS = new Set([
  "", "you", "thank you", "thanks", "thank you very much", "thanks for watching",
  "thank you for watching", "please subscribe", "subscribe", "bye", "bye bye",
  "see you next time", "see you in the next video", "subtitles by the amara org community"
]);
// Carrier / handset "this call is being recorded" disclaimers get transcribed
// and look like caller speech — the bot must ignore them, not answer them.
const RECORDING_NOTICE = /\b(call|conversation)\s+(is|may be|is being|will be|could be)\s+(being\s+)?(recorded|monitored)|recorded\s+for\s+(quality|training)|for\s+(quality|training)\s+(and\s+\w+\s+)?purposes\b/i;
function isWhisperHallucination(text: string): boolean {
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (norm.length < 2 || WHISPER_HALLUCINATIONS.has(norm)) return true;
  return RECORDING_NOTICE.test(text);
}

// Filled pauses / non-lexical vocalizations the caller makes while still
// thinking ("um", "uh", "hmm", "ahh"…). When the whole utterance is just
// these, the caller hasn't finished — keep listening instead of replying.
// Affirmative backchannels ("uh huh", "mm hmm") are deliberately excluded so a
// caller confirming something still advances the conversation.
const FILLER_WORD = /^(u+h+|u+m+|h+m+|e+r+|e+r+m+|a+h+|e+h+|m+)$/;
function isFillerOnly(text: string): boolean {
  const norm = text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (!norm) return false;
  return norm.split(" ").every(w => FILLER_WORD.test(w));
}
// Same floor as SPEECH_RMS_THRESHOLD on purpose. Any volume that counts as the
// caller talking should also be able to cut the bot off — otherwise normal-volume
// speech registers as a turn (RMS > 800) but never barges in (RMS < 900), so the
// bot plays its sentence to the end and only then answers. Cough/noise rejection
// is handled by the 240 ms sustain (INTERRUPT_MIN_CHUNKS), not by a louder gate.
const INTERRUPT_RMS_THRESHOLD = SPEECH_RMS_THRESHOLD;

export async function twilioRoutes(app: FastifyInstance) {
  const agents = agentRepository(pool);
  const calls  = callRepository(pool);

  // Twilio webhook — returns Media Streams TwiML
  app.route({
    method: ["GET", "POST"],
    url: "/twilio/voice",
    handler: async (request, reply) => {
      const { agentId } = voiceQuery.parse(request.query);
      const agent = await agents.getById(agentId);
      await agents.recordEvent(agent.id, "call.inbound", { source: "twilio" });
      publishAgentEvent(agent.id, "call.inbound", { agentId: agent.id });
      return reply.type("text/xml").send(mediaStreamTwiml(agent));
    }
  });

  // Twilio Media Streams WebSocket
  app.get("/ws", { websocket: true }, async (socket: any, request) => {
    const pending: Buffer[] = [];
    let handleMessage: ((raw: Buffer) => Promise<void>) | null = null;

    socket.on("message", (raw: Buffer) => {
      if (handleMessage) handleMessage(raw).catch(err => request.log.error(err));
      else pending.push(raw);
    });

    // agentId from URL query (preferred) — fallback to start.customParameters
    let agentIdHint: string | null = null;
    try { agentIdHint = voiceQuery.parse(request.query).agentId; } catch { /* wait for start */ }

    let agent: Agent | null    = null;
    let callId: string | null  = null;
    let callEnded              = false;
    let streamSid: string | null = null;

    // Playback state
    let isBotSpeaking  = false;
    let turnCounter    = 0;
    let isProcessing   = false;
    let turnGeneration = 0; // increments on every interrupt — cancels in-flight turns
    // Caller spoke again while we were still processing the previous turn — handle it next
    let pendingTurn: Buffer | null = null;

    // VAD state
    const speechChunks: Buffer[] = [];
    let hasSpeech      = false;
    let silentCount    = 0;
    let voiceChunkCount = 0; // chunks above RMS threshold in current utterance
    let interruptChunks = 0; // consecutive above-threshold chunks while bot is speaking

    const history: ChatMsg[] = [];
    let systemContent = "";
    let todayIso = ""; // local (IST) YYYY-MM-DD — used to keep booking dates in the future
    // Persists key caller facts across the whole call so the LLM never forgets them
    const callerInfo: { name?: string; phone?: string; service?: string; reason?: string } = {};
    // Prevents duplicate bookings if the caller speaks again before hang-up fires
    let bookingDone = false;

    // ── helpers ────────────────────────────────────────────────────

    function sendMedia(mulaw: Buffer) {
      if (!streamSid || socket.readyState !== 1) return;
      socket.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: mulaw.toString("base64") }
      }));
    }

    function sendMark(name: string) {
      if (!streamSid || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ event: "mark", streamSid, mark: { name } }));
    }

    function sendClear() {
      if (!streamSid || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ event: "clear", streamSid }));
    }

    async function playTts(text: string) {
      if (!agent) return;
      const speaker = resolveVoice(agent.voice);
      const mulaw   = await elevenLabsTts(text, speaker);
      isBotSpeaking = true;
      sendMedia(mulaw);
      sendMark(`turn-${++turnCounter}`);
      // Safety: mark events can be lost — reset after audio duration + 3 s buffer
      const safetyMs = Math.ceil(mulaw.length / 8) + 3000;
      setTimeout(() => { if (isBotSpeaking) isBotSpeaking = false; }, safetyMs);
    }

    async function closeCall(outcome = "completed") {
      if (callEnded || !callId || !agent) return;
      callEnded = true;
      try {
        const detail     = await calls.detail(callId, agent.id);
        const transcript = detail.transcript || "";
        const sentiment  = transcript
          ? await analyzeSentiment(transcript)
          : { sentiment: "neutral" as const, score: 70, summary: "Call ended.", keyIssues: [], resolved: true };
        const ended = await calls.end(callId, {
          outcome,
          sentiment:      sentiment.sentiment,
          sentimentScore: sentiment.score,
          summary:        sentiment.summary
        });
        await agents.recordEvent(agent.id, "call.ended", { callId, outcome: ended.outcome });
        publishAgentEvent(agent.id, "call.ended", { call: ended });
      } catch (err) { request.log.error(err); }
      // Close the Media Stream — with <Connect><Stream>, closing the socket hangs up
      // the call. Wrapped so a caller-initiated close (already gone) is harmless.
      try { if (socket.readyState === 1) socket.close(); } catch { /* already closed */ }
    }

    async function processTurn(mulawBuf: Buffer) {
      if (!agent || !callId) return;
      // If bot is still "speaking" (e.g. mark event was lost), cancel it
      if (isBotSpeaking) {
        isBotSpeaking = false;
        isProcessing  = false;
        turnGeneration++;
        sendClear();
      }
      // Already handling a turn — don't drop the caller's new speech, queue the latest
      // utterance so it's answered as soon as the current turn finishes.
      if (isProcessing) {
        pendingTurn = mulawBuf;
        return;
      }
      isProcessing = true;
      const myGeneration = turnGeneration;
      try {
        // STT: Groq Whisper turbo primary (fastest for English), Sarvam fallback
        const wavBuf = twilioMulawToWhisperWav(mulawBuf);
        let transcript: string;
        try {
          transcript = await transcribeAudio(wavBuf);
        } catch (err) {
          request.log.warn(err, "Groq STT failed — trying Sarvam fallback");
          transcript = "";
        }

        if (!transcript) {
          try {
            transcript = await sarvamStt(wavBuf);
          } catch (err) {
            request.log.error(err, "Sarvam STT fallback also failed");
          }
        }

        if (!transcript) {
          request.log.info("Empty STT — skipping turn");
          isProcessing = false;
          return;
        }

        // Whisper hallucinates stock filler on near-silent / background-noise
        // audio that slipped past VAD ("you", "Thank you.", YouTube outros).
        // These never occur as a real opening utterance — drop them.
        if (isWhisperHallucination(transcript)) {
          request.log.info({ transcript }, "Dropping likely STT hallucination");
          isProcessing = false;
          return;
        }

        // Caller is just hesitating ("um", "uh") — they aren't done talking.
        // Don't reply; let VAD pick up the rest of their sentence.
        if (isFillerOnly(transcript)) {
          request.log.info({ transcript }, "Filler/hesitation only — waiting for caller to continue");
          isProcessing = false;
          return;
        }

        request.log.info({ transcript }, "Caller spoke");
        await calls.addTurn(callId, "caller", transcript);

        // The very first thing the caller says is their reason for calling
        // (e.g. "I have a hair problem"). Pin it so it survives the whole call.
        const isFirstUserTurn = !history.some(m => m.role === "user");
        if (isFirstUserTurn && !callerInfo.reason) {
          callerInfo.reason = transcript.slice(0, 160);
        }

        // Extract key caller facts so they survive long calls
        const name = extractName(transcript);
        const phoneMatch = transcript.match(/\b(\+?91[\s\-]?)?([6-9]\d{9})\b/)
                        ?? transcript.match(/\b(\d[\d\s\-]{8,13}\d)\b/);
        if (name && !callerInfo.name) callerInfo.name = name;
        if (phoneMatch && !callerInfo.phone) {
          const raw = (phoneMatch[2] || phoneMatch[1] || phoneMatch[0]);
          callerInfo.phone = raw.replace(/[\s\-]/g, "");
        }

        history.push({ role: "user", content: transcript });

        // Build system prompt with pinned caller facts + trimmed history
        const memNote = Object.keys(callerInfo).length
          ? `\n\nCALLER DETAILS captured so far this call — remember these and do NOT ask again for anything already filled in: ${JSON.stringify(callerInfo)}`
          : "";
        const sysWithMemory = systemContent + memNote;
        // Keep first 2 history messages (greeting context) + most recent 12 to avoid
        // context overflow while preserving enough conversation to stay coherent.
        const trimmedHistory = history.length > 16
          ? [...history.slice(0, 2), ...history.slice(-12)]
          : history;

        // LLM (streaming) + TTS per sentence, played as soon as each sentence is ready.
        // This streams audio out WHILE the model is still generating, so the caller hears
        // the first sentence almost immediately instead of waiting for the whole reply.
        const speaker = resolveVoice(agent.voice);
        let totalAudioBytes = 0;
        let audioSent = false;
        // A turn is "stale" once the caller has spoken again (pendingTurn) or interrupted
        // (turnGeneration moved). When stale, stop playing — the newer utterance takes over.
        const stale = () => turnGeneration !== myGeneration || pendingTurn !== null;
        // Sequential sender so sentences play in order while their TTS runs concurrently.
        let sendChain: Promise<void> = Promise.resolve();

        const enqueueAudio = (sentence: string) => {
          if (stale()) return;
          const ttsPromise = elevenLabsTts(sentence, speaker);
          sendChain = sendChain.then(async () => {
            if (stale()) return;
            let mulaw: Buffer;
            try {
              mulaw = await ttsPromise;
            } catch (ttsErr) {
              request.log.warn(ttsErr, "TTS sentence failed — skipping");
              return;
            }
            if (stale()) return;
            isBotSpeaking    = true;
            audioSent        = true;
            totalAudioBytes += mulaw.length;
            sendMedia(mulaw);
          });
        };

        let llmOut: string;
        try {
          llmOut = await groqChatPipelined(
            [{ role: "system", content: sysWithMemory }, ...trimmedHistory],
            enqueueAudio
          );
        } catch (err) {
          request.log.error(err, "LLM failed");
          await playTts("I'm having a little trouble right now. Please hold on.").catch(() => {});
          return;
        }

        // Wait for any in-flight sentence audio to finish sending before wrapping up.
        await sendChain;

        const output     = llmOut || "I understand. Could you tell me a bit more?";
        const tokens     = extractControlTokens(output);
        const spokenText = tokens.spokenText || output;

        await calls.addTurn(callId, "agent", spokenText);
        history.push({ role: "assistant", content: spokenText });

        // Short replies may not trigger a sentence boundary — speak the whole thing once.
        if (!audioSent && !stale()) {
          await playTts(spokenText).catch(err => request.log.error(err, "TTS failed"));
        }

        // Booking capture — one booking per call, with real name + phone required
        let bookingCreated = false;
        if (tokens.booking && agent.bookingEnabled && !bookingDone) {
          const b = tokens.booking;
          const resolvedName  = realValue(b.name)  || callerInfo.name  || null;
          const resolvedPhone = realValue(b.phone) || callerInfo.phone || null;
          if (resolvedName && resolvedPhone) {
            try {
              const booking = await calls.createBooking({
                agentId: agent.id, callId,
                name:        resolvedName,
                phone:       resolvedPhone,
                bookingDate: normalizeBookingDate(b.date ?? b.appointment_date ?? b.booking_date, todayIso),
                bookingTime: valueOrNull(b.time ?? b.appointment_time ?? b.booking_time),
                service:     String(b.service || b.model || b.doctor || b.reason || "Booking"),
                details: b
              });
              await agents.recordEvent(agent.id, "booking.created", { bookingId: booking.id });
              publishAgentEvent(agent.id, "booking.created", { booking });
              bookingCreated = true;
              bookingDone    = true;
            } catch (err) { request.log.error(err); }
          } else {
            request.log.info({ resolvedName, resolvedPhone }, "Booking token present but missing name/phone — skipping");
          }
        }

        if (!stale() && (audioSent || totalAudioBytes > 0)) {
          sendMark(`turn-${++turnCounter}`);
          const safetyMs = Math.ceil(totalAudioBytes / 8) + 3000;
          setTimeout(() => { if (isBotSpeaking) isBotSpeaking = false; }, safetyMs);
        }

        // Hang up after the closing line finishes playing — either a confirmed booking
        // or an explicit END_CALL from the model (it is instructed to emit END_CALL only
        // after a real goodbye). Don't hang up if the caller just interrupted.
        if ((bookingCreated || tokens.endCall) && !stale()) {
          const audioMs = Math.ceil(totalAudioBytes / 8);
          const delay   = audioMs + 2500;
          setTimeout(() => closeCall(bookingCreated ? "booking" : "completed").catch(() => {}), delay);
        }
      } finally {
        // Only release the lock if no newer turn has taken over.
        // An interrupted turn's finally must NOT reset isProcessing for the turn that replaced it.
        if (myGeneration === turnGeneration) {
          isProcessing = false;
          // Caller spoke again mid-processing — answer that utterance now instead of losing it.
          if (pendingTurn) {
            const next = pendingTurn;
            pendingTurn = null;
            processTurn(next).catch(err => request.log.error(err));
          }
        }
      }
    }

    // ── message handler ────────────────────────────────────────────

    handleMessage = async (raw: Buffer) => {
      let msg: Record<string, any>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      const event: string = msg.event ?? "";

      if (event === "connected") return;

      // ── start: initialise agent + call ──────────────────────────
      if (event === "start") {
        streamSid = msg.start?.streamSid ?? msg.streamSid ?? null;

        // Resolve agentId: URL query param takes priority, then customParameters
        const agentId = agentIdHint ?? msg.start?.customParameters?.agentId ?? null;
        if (!agentId) {
          request.log.error("No agentId — closing WebSocket");
          socket.close();
          return;
        }

        try {
          agent = await agents.getById(agentId);
          const call = await calls.create({ agentId: agent.id, promptVersion: agent.promptVersion });
          callId = call.id;
          publishAgentEvent(agent.id, "call.started", { callId });
          await agents.recordEvent(agent.id, "call.started", { callId });
        } catch (err) {
          request.log.error(err);
          socket.close();
          return;
        }

        const now     = new Date();
        const tz      = "Asia/Kolkata";
        todayIso      = now.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
        const dateStr = now.toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const timeStr = now.toLocaleTimeString("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
        const curYear = todayIso.slice(0, 4);
        systemContent = [
          `Today's date is ${dateStr} (${todayIso}). The current year is ${curYear}. The current time is ${timeStr}.`,
          `DATE RULES: When the caller says "tomorrow", "next Monday", "the 20th", etc., calculate the exact calendar date from today's date above. Every booking date MUST be ${todayIso} or later and use the year ${curYear} (only use ${Number(curYear) + 1} if the caller is clearly booking for next year). NEVER use a past date or a past year.`,
          `MEMORY: Pay attention to everything the caller has already told you in this call — their name, phone number, and the reason they called. Never ask again for something they have already given you.`,
          agent.systemPrompt,
          agent.knowledgeBase ? `\n\nKNOWLEDGE BASE:\n${agent.knowledgeBase}` : "",
          `\n\nENDING THE CALL: Keep the conversation going normally — phrases like "thank you", "okay", "sure", or "got it" are NOT reasons to end the call. Only end when (a) a booking has been fully confirmed and you have read back the confirmation, or (b) the caller clearly says they need nothing else or says goodbye. To end, say ONE short warm closing line (for example "Thanks for calling, have a great day!") and then output END_CALL on its own line as the very last thing. Do not say goodbye or output END_CALL at any other time.`,
          agent.bookingEnabled
            ? `\n\nBOOKING: When the caller confirms all details (name, phone, date, time, service) output exactly once on its own line: BOOK:{"name":"<full name>","phone":"<phone number>","date":"<YYYY-MM-DD>","time":"<HH:MM 24h>","service":"<service>"} then say a short friendly confirmation and output END_CALL on its own line. Use the real date in ${curYear} (or later) — never a past year. Only do this after the caller has explicitly confirmed the booking details.`
            : ""
        ].join("\n\n").trim();

        const callSid = msg.start?.callSid ?? null;
        const from    = msg.start?.customParameters?.from ?? null;
        if (callSid || from) {
          await pool.query(
            `UPDATE calls SET call_sid = COALESCE($2, call_sid), caller_phone = COALESCE($3, caller_phone) WHERE id = $1`,
            [callId, callSid, from]
          );
        }

        // Greeting
        const greeting = buildWelcomeGreeting(agent);
        history.push({ role: "assistant", content: greeting });
        await calls.addTurn(callId, "agent", greeting);
        await playTts(greeting).catch(err => request.log.error(err, "Greeting TTS failed"));
        return;
      }

      // Guard: ignore events that arrive before start initialises the agent
      if (!agent || !callId) return;

      // ── inbound audio ───────────────────────────────────────────
      if (event === "media") {
        const track = msg.media?.track as string | undefined;
        if (track && track !== "inbound" && track !== "inbound_track") return;
        const payload = msg.media?.payload as string | undefined;
        if (!payload) return;

        const chunk = Buffer.from(payload, "base64");
        const rms   = mulawRms(chunk);

        // Interrupt: caller speaks while bot is playing. Require sustained speech
        // (INTERRUPT_MIN_CHUNKS) so a cough, backchannel, or noise blip doesn't kill
        // the bot mid-sentence and leave the call silent.
        if (isBotSpeaking) {
          if (rms > INTERRUPT_RMS_THRESHOLD) {
            if (++interruptChunks >= INTERRUPT_MIN_CHUNKS) {
              isBotSpeaking = false;
              isProcessing  = false; // allow new turn to start
              turnGeneration++;      // cancel any in-flight TTS send loop
              pendingTurn   = null;  // drop any queued turn — the new speech supersedes it
              interruptChunks = 0;
              sendClear();
              // keep history intact so the LLM retains full context
            }
          } else {
            // Decay instead of hard-reset: tolerate the brief sub-threshold dips
            // between syllables, but let a short burst (a cough) fade back to 0.
            // Decays slower than it builds (−1 vs +1) so the natural gaps inside a
            // real "wait, stop" don't keep knocking progress back down.
            interruptChunks = Math.max(0, interruptChunks - 1);
          }
        }

        // VAD
        if (rms > SPEECH_RMS_THRESHOLD) {
          hasSpeech   = true;
          silentCount = 0;
          voiceChunkCount++;
          speechChunks.push(chunk);
          if (speechChunks.length >= MAX_SPEECH_CHUNKS) {
            const combined = Buffer.concat(speechChunks);
            const voiced = voiceChunkCount;
            speechChunks.length = 0; hasSpeech = false; silentCount = 0; voiceChunkCount = 0;
            if (voiced >= MIN_SPEECH_CHUNKS) {
              processTurn(combined).catch(err => request.log.error(err));
            }
          }
        } else if (hasSpeech) {
          silentCount++;
          speechChunks.push(chunk);
          if (silentCount >= SILENCE_CHUNKS_END) {
            const combined = Buffer.concat(speechChunks);
            const voiced = voiceChunkCount;
            speechChunks.length = 0; hasSpeech = false; silentCount = 0; voiceChunkCount = 0;
            if (voiced >= MIN_SPEECH_CHUNKS) {
              processTurn(combined).catch(err => request.log.error(err));
            }
          }
        }
        return;
      }

      // ── mark: bot audio finished playing ───────────────────────
      if (event === "mark") {
        isBotSpeaking = false;
        return;
      }

      // ── stop: caller hung up ────────────────────────────────────
      if (event === "stop") {
        await closeCall("completed");
        return;
      }

      request.log.warn({ event }, "Unhandled Media Streams event");
    };

    for (const raw of pending) await handleMessage(raw).catch(err => request.log.error(err));
    pending.length = 0;

    socket.on("close", () => closeCall("completed").catch(() => {}));
    socket.on("error", (err: Error) => {
      request.log.error(err);
      closeCall("error").catch(() => {});
    });
  });
}
