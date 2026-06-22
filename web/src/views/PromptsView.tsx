import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "../store";
import { SaveCheck } from "../lib/icons";
import type { ChatMessage } from "../types";

interface ConsoleMsg {
  role: "user" | "agent" | "system";
  content: string;
  typing?: boolean;
  endCall?: boolean;
  error?: boolean;
}

const VOICES = [
  { value: "anushka",  label: "Anushka — Female (Sarvam AI)" },
  { value: "manisha",  label: "Manisha — Female (Sarvam AI)" },
  { value: "vidya",    label: "Vidya — Female (Sarvam AI)" },
  { value: "arya",     label: "Arya — Female (Sarvam AI)" },
  { value: "abhilash", label: "Abhilash — Male (Sarvam AI)" },
  { value: "karun",    label: "Karun — Male (Sarvam AI)" },
  { value: "hitesh",   label: "Hitesh — Male (Sarvam AI)" }
];

// Map legacy v3-beta voices on older agents to their v2 equivalents so the
// dropdown always shows a valid selection.
const LEGACY_VOICE_MAP: Record<string, string> = { priya: "anushka", shubh: "abhilash" };
const normalizeVoice = (v?: string | null) => (v && LEGACY_VOICE_MAP[v]) || v || "anushka";

export function PromptsView({ active }: { active: boolean }) {
  const { selectedAgent: agent, savePrompt, showToast, testChat } = useStore();
  const viewClass = "view" + (active ? " active" : "");

  const [prompt, setPrompt] = useState(agent?.systemPrompt || "");
  const [voice, setVoice] = useState(normalizeVoice(agent?.voice));
  const [saving, setSaving] = useState(false);

  const [messages, setMessages] = useState<ConsoleMsg[]>([]);
  const conversation = useRef<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);

  const resetConsole = () => {
    conversation.current = [];
    const greeting = agent
      ? `Hello! I'm ${agent.name.split(" ")[0]}, calling for ${agent.businessName}. How can I help you today?`
      : "Select an agent to start testing.";
    setMessages([{ role: "agent", content: greeting }]);
  };

  // When the selected agent changes, reload editor + reset console.
  useEffect(() => {
    setPrompt(agent?.systemPrompt || "");
    setVoice(normalizeVoice(agent?.voice));
    resetConsole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [messages]);

  const onSave = async () => {
    if (!agent) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      showToast("Prompt cannot be empty.", "error");
      return;
    }
    setSaving(true);
    try {
      await savePrompt(agent.id, trimmed, voice);
    } catch (err) {
      showToast("Save failed: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!agent) {
      showToast("Select an agent first", "error");
      return;
    }
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSending(true);

    setMessages(prev => [...prev, { role: "user", content: text }, { role: "agent", content: "", typing: true }]);
    conversation.current.push({ role: "user", content: text });

    try {
      const { reply, endCall } = await testChat(conversation.current);
      conversation.current.push({ role: "assistant", content: reply });
      setMessages(prev => {
        const next = prev.filter(m => !m.typing);
        next.push({ role: "agent", content: reply, endCall });
        if (endCall) next.push({ role: "system", content: "— Call ended by agent —" });
        return next;
      });
      if (endCall) conversation.current = [];
    } catch (err: unknown) {
      setMessages(prev => {
        const next = prev.filter(m => !m.typing);
        next.push({ role: "agent", content: "Error: " + (err as Error).message, error: true });
        return next;
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={viewClass} aria-labelledby="view-title">
      <div className="view-header">
        <div>
          <p className="view-eyebrow">Memory</p>
          <h2 className="view-heading">Prompt editor</h2>
        </div>
        <button className="primary-btn" type="button" onClick={() => void onSave()} disabled={saving}>
          <SaveCheck />
          {saving ? "Saving…" : "Save & deploy"}
        </button>
      </div>
      <div className="prompt-layout">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-eyebrow">Version {agent?.promptVersion ?? 1}</p>
              <h2 className="card-title">{agent ? `${agent.name} — system prompt` : "No agent selected"}</h2>
            </div>
            <div className="token-chips">
              <span className="token-chip">BOOK</span>
              <span className="token-chip">TICKET</span>
              <span className="token-chip">END_CALL</span>
            </div>
          </div>
          <textarea
            className="prompt-editor"
            spellCheck={false}
            placeholder={agent ? "" : "Create an agent first."}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <div className="voice-settings-row">
            <label className="field-label" htmlFor="voice-select">
              Agent voice
            </label>
            <div className="select-wrapper" style={{ flex: 1 }}>
              <select id="voice-select" value={voice} onChange={e => setVoice(e.target.value)}>
                {VOICES.map(v => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              <svg className="select-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-eyebrow">Console</p>
              <h2 className="card-title">Prompt test</h2>
            </div>
            <button className="ghost-btn" type="button" onClick={resetConsole}>
              Clear
            </button>
          </div>
          <div className="test-console" ref={consoleRef}>
            {messages.map((m, i) => {
              if (m.typing) {
                return (
                  <div className="console-msg agent typing" key={i}>
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                );
              }
              if (m.role === "system") {
                return (
                  <div className="console-msg system" key={i}>
                    {m.content}
                  </div>
                );
              }
              return (
                <div
                  className={`console-msg ${m.role}`}
                  key={i}
                  style={m.error ? { color: "var(--apple-red)" } : undefined}
                >
                  {m.content}
                  {m.endCall && <span className="end-call-badge"> END CALL</span>}
                </div>
              );
            })}
          </div>
          <form className="test-form" onSubmit={onSend}>
            <input
              type="text"
              placeholder="Caller says…"
              autoComplete="off"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending}
            />
            <button className="secondary-btn" type="submit" disabled={sending}>
              Send
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
