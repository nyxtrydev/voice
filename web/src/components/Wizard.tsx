import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "../store";
import { BackChevron, CloseIcon, TemplateAutoIcon, TemplateClinicIcon, TemplateTechIcon, UploadIcon } from "../lib/icons";

type Template = "clinic" | "auto" | "tech";

const TEMPLATES: { value: Template; name: string; desc: string; iconClass: string; Icon: () => JSX.Element }[] = [
  { value: "clinic", name: "Clinic Receptionist", desc: "Appointments, FAQs, emergency routing", iconClass: "template-icon--blue", Icon: TemplateClinicIcon },
  { value: "auto", name: "Car Booking", desc: "Test drives, service, lead capture", iconClass: "template-icon--orange", Icon: TemplateAutoIcon },
  { value: "tech", name: "Tech Support", desc: "L1 troubleshooting, ticket intake", iconClass: "template-icon--purple", Icon: TemplateTechIcon }
];

export function Wizard({ onClose }: { onClose: () => void }) {
  const { generatePrompt, createAgent } = useStore();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [businessType, setBusinessType] = useState("clinic");
  const [phoneCountry, setPhoneCountry] = useState("India");
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("");
  const [address, setAddress] = useState("");
  const [template, setTemplate] = useState<Template>("clinic");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runGenerate = async () => {
    setGenerating(true);
    try {
      const res = await generatePrompt({
        businessName: businessName || "My Business",
        agentName: agentName || "Aria",
        businessType: template,
        description: description || "A business that serves customers.",
        hours: hours || undefined,
        address: address || undefined
      });
      if (res) {
        setGeneratedPrompt(res.systemPrompt);
        setBookingEnabled(res.bookingEnabled);
      }
    } catch (err) {
      setError("Could not generate prompt: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const next = async () => {
    if (step < 3) {
      const nextStep = step + 1;
      setStep(nextStep);
      if (nextStep === 3) await runGenerate();
    }
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await createAgent(
        {
          businessName,
          agentName: agentName || "Aria",
          businessType: template,
          description,
          hours: hours || undefined,
          address: address || undefined,
          systemPrompt: generatedPrompt || undefined,
          bookingEnabled,
          phoneCountry
        },
        file
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="modal-backdrop active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wizard">
        <div className="wizard-header">
          <div>
            <p className="wizard-eyebrow">Under 10 minutes</p>
            <h2 className="wizard-title" id="wizard-title">
              Create voice agent
            </h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="wizard-steps-indicator" aria-label="Wizard progress">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={"ws-step" + (i <= step ? " active" : "")} />
          ))}
        </div>

        {error && (
          <div className="auth-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          {/* Step 0 */}
          <div className={"wizard-step" + (step === 0 ? " active" : "")}>
            <label>
              <span className="field-label">Business name</span>
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} required placeholder="e.g. Nyxtry Health Clinic" />
            </label>
            <label>
              <span className="field-label">Agent name</span>
              <input value={agentName} onChange={e => setAgentName(e.target.value)} required placeholder="e.g. Aria" />
            </label>
            <label>
              <span className="field-label">Business type</span>
              <div className="select-wrapper">
                <select value={businessType} onChange={e => setBusinessType(e.target.value)}>
                  <option value="clinic">Clinic / Healthcare</option>
                  <option value="auto">Auto Dealer</option>
                  <option value="tech">Tech Support</option>
                  <option value="other">Other</option>
                </select>
                <Chevron />
              </div>
            </label>
            <label>
              <span className="field-label">Phone country</span>
              <div className="select-wrapper">
                <select value={phoneCountry} onChange={e => setPhoneCountry(e.target.value)}>
                  <option value="India">India</option>
                  <option value="United States">United States</option>
                  <option value="United Kingdom">United Kingdom</option>
                </select>
                <Chevron />
              </div>
            </label>
          </div>

          {/* Step 1 */}
          <div className={"wizard-step" + (step === 1 ? " active" : "")}>
            <label>
              <span className="field-label">
                Business description{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(used to generate your prompt)</span>
              </span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
                placeholder="Describe your business: services offered, typical caller needs, any special policies…"
                style={{ minHeight: 130 }}
              />
            </label>
            <label>
              <span className="field-label">Operating hours</span>
              <input value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. Mon-Sat 9:00 AM – 7:00 PM" />
            </label>
            <label>
              <span className="field-label">Address</span>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. Indiranagar, Bengaluru" />
            </label>
            <label className="file-label">
              <span className="field-label">
                Knowledge upload <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </span>
              <div className="file-drop" onClick={() => fileInputRef.current?.click()}>
                <UploadIcon />
                <span>
                  Drop file here or <em>browse</em>
                </span>
                <span className="file-hint">{file ? file.name : "PDF, DOCX, or TXT · max 5 MB"}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                className="sr-only"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {/* Step 2 */}
          <div className={"wizard-step" + (step === 2 ? " active" : "")}>
            <p style={{ fontSize: 14, color: "var(--label-2)", marginBottom: 4 }}>
              Choose the template that best matches your agent's role. The generated prompt will be customised for you.
            </p>
            <div className="template-grid" role="radiogroup" aria-label="Agent template">
              {TEMPLATES.map(t => (
                <label className={"template-card" + (template === t.value ? " active" : "")} key={t.value}>
                  <input
                    type="radio"
                    name="template"
                    value={t.value}
                    checked={template === t.value}
                    onChange={() => setTemplate(t.value)}
                  />
                  <div className={`template-icon ${t.iconClass}`}>
                    <t.Icon />
                  </div>
                  <strong className="template-name">{t.name}</strong>
                  <span className="template-desc">{t.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Step 3 */}
          <div className={"wizard-step" + (step === 3 ? " active" : "")}>
            <p style={{ fontSize: 14, color: "var(--label-2)", marginBottom: 4 }}>
              Review and edit the auto-generated system prompt. It will be saved as version 1.
            </p>
            <label>
              <span className="field-label">
                System prompt{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--apple-blue)" }}>
                  {generating ? "Generating…" : ""}
                </span>
              </span>
              <textarea
                value={generatedPrompt}
                onChange={e => setGeneratedPrompt(e.target.value)}
                style={{ minHeight: 320, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
            </label>
            <label className="toggle-label">
              <input type="checkbox" className="toggle-input" checked={bookingEnabled} onChange={e => setBookingEnabled(e.target.checked)} />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              <span className="field-label" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, fontWeight: 600 }}>
                Enable booking capture
              </span>
            </label>
          </div>

          <div className="wizard-footer">
            <button className="ghost-btn" type="button" disabled={step === 0} onClick={back}>
              <BackChevron />
              Back
            </button>
            <div className="wizard-footer-right">
              {step !== 3 && (
                <button className="secondary-btn" type="button" onClick={() => void next()}>
                  Continue
                </button>
              )}
              {step === 3 && (
                <button className="primary-btn" type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Provision & launch"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="select-chevron" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
