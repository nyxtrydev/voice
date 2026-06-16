import { env, groqFallbackModels } from "../config/env.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function groqChat(messages: ChatMessage[], model = env.GROQ_MODEL, maxTokens = 120): Promise<string> {
  if (!env.GROQ_API_KEY) {
    return "";
  }

  const models = [model, ...groqFallbackModels.filter((fallback) => fallback !== model)];
  let lastError: Error | null = null;

  for (const modelName of models) {
    try {
      return await groqChatWithModel(messages, modelName, maxTokens);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Groq request failed");
    }
  }

  throw lastError || new Error("Groq request failed");
}

async function groqChatWithModel(messages: ChatMessage[], model: string, maxTokens: number): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as GroqResponse;
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Streaming version — calls `onSentence` with each complete sentence as it
 * arrives from Groq, so the caller can start TTS in parallel with generation.
 * Returns the full raw text (including control tokens) when the stream ends.
 */
export async function groqChatPipelined(
  messages: ChatMessage[],
  onSentence: (sentence: string) => void,
  model = env.GROQ_MODEL,
  maxTokens = 120
): Promise<string> {
  if (!env.GROQ_API_KEY) return "";

  const models = [model, ...groqFallbackModels.filter(m => m !== model)];
  for (const m of models) {
    try { return await streamWithSentences(messages, onSentence, m, maxTokens); }
    catch { /* try next model */ }
  }
  // All streaming attempts failed — fall back to non-streaming
  const full = await groqChat(messages, model, maxTokens);
  const clean = full.replace(/BOOK:\{[\s\S]*?\}/g, "").replace(/TICKET:\{[\s\S]*?\}/g, "").replace(/\bEND_CALL\b/g, "").trim();
  if (clean) onSentence(clean);
  return full;
}

async function streamWithSentences(
  messages: ChatMessage[],
  onSentence: (s: string) => void,
  model: string,
  maxTokens: number
): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.3, stream: true, max_tokens: maxTokens })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);

  const reader  = res.body!.getReader();
  const dec     = new TextDecoder();
  let sseBuf    = "";
  let sentBuf   = "";
  let fullText  = "";

  const flush = (final = false) => {
    while (true) {
      // Sentence boundary: punctuation followed by space, or end-of-string (final)
      const idx = final
        ? (sentBuf.trim().length ? sentBuf.length - 1 : -1)
        : findBoundary(sentBuf);
      if (idx === -1) break;

      const sentence = sentBuf.slice(0, idx + 1).trim();
      sentBuf = sentBuf.slice(idx + 1).trimStart();

      // Skip bare control token lines
      if (sentence.length > 4 && !/^(BOOK:|TICKET:|END_CALL)/.test(sentence)) {
        const clean = sentence
          .replace(/BOOK:\{[\s\S]*?\}/g, "")
          .replace(/TICKET:\{[\s\S]*?\}/g, "")
          .replace(/\bEND_CALL\b/g, "")
          .trim();
        if (clean.length > 4) onSentence(clean);
      }
      if (final) break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += dec.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const delta: string = (JSON.parse(data) as any).choices?.[0]?.delta?.content || "";
        if (delta) { sentBuf += delta; fullText += delta; flush(); }
      } catch { /* ignore malformed SSE frame */ }
    }
  }
  flush(true);
  return fullText.trim();
}

function findBoundary(text: string): number {
  // Find the FIRST sentence-ending punctuation followed by whitespace (min 8 chars in)
  for (let i = 8; i < text.length - 1; i++) {
    if ("!?".includes(text[i]) && (text[i + 1] === " " || text[i + 1] === "\n")) return i;
    if (text[i] === "." && (text[i + 1] === " " || text[i + 1] === "\n") &&
        !/^\d$/.test(text[i - 1]) /* not a decimal number */) return i;
  }
  return -1;
}

export function extractControlTokens(text: string) {
  const bookingMatch = text.match(/BOOK:(\{[\s\S]*?\})(?=\s|$)/);
  const ticketMatch = text.match(/TICKET:(\{[\s\S]*?\})(?=\s|$)/);
  const endCall = /\bEND_CALL\b/.test(text);
  

  return {
    spokenText: text.replace(/BOOK:\{[\s\S]*?\}/g, "").replace(/TICKET:\{[\s\S]*?\}/g, "").replace(/\bEND_CALL\b/g, "").trim(),
    booking: safeJson(bookingMatch?.[1]),
    ticket: safeJson(ticketMatch?.[1]),
    endCall
  };
}

function safeJson(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
