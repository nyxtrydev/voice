import { useState, type FormEvent } from "react";
import { useStore } from "../store";
import { BrandIcon } from "../lib/icons";

export function AuthScreen() {
  const { login, register } = useStore();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  const switchTab = (next: "login" | "register") => {
    setTab(next);
    setError("");
  };

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!loginEmail.trim() || !loginPassword) {
      setError("Email and password are required.");
      return;
    }
    setLoginBusy(true);
    try {
      await login(loginEmail.trim(), loginPassword);
    } catch (err) {
      setError((err as Error).message || "Sign in failed.");
    } finally {
      setLoginBusy(false);
    }
  };

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!regEmail.trim() || !regPassword) {
      setError("Email and password are required.");
      return;
    }
    if (regPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setRegBusy(true);
    try {
      await register(regEmail.trim(), regPassword);
    } catch (err) {
      setError((err as Error).message || "Registration failed.");
    } finally {
      setRegBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="brand-icon" aria-hidden="true">
          <BrandIcon />
        </div>
        <span className="auth-brand-name">VoiceAgentOS</span>
      </div>

      <div className="auth-card">
        <div className="auth-tabs" role="tablist">
          <button
            className={"auth-tab" + (tab === "login" ? " active" : "")}
            role="tab"
            aria-selected={tab === "login"}
            onClick={() => switchTab("login")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={"auth-tab" + (tab === "register" ? " active" : "")}
            role="tab"
            aria-selected={tab === "register"}
            onClick={() => switchTab("register")}
            type="button"
          >
            Create account
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {tab === "login" ? (
          <form className="auth-form" noValidate onSubmit={onLogin}>
            <label>
              <span className="field-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="field-label">Password</span>
              <input
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
              />
            </label>
            <button className="primary-btn full-width" type="submit" disabled={loginBusy}>
              {loginBusy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form className="auth-form" noValidate onSubmit={onRegister}>
            <label>
              <span className="field-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={regEmail}
                onChange={e => setRegEmail(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="field-label">
                Password{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(min 8 characters)</span>
              </span>
              <input
                type="password"
                placeholder="Create password"
                autoComplete="new-password"
                value={regPassword}
                onChange={e => setRegPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <button className="primary-btn full-width" type="submit" disabled={regBusy}>
              {regBusy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>

      <p className="auth-footer">No-code AI voice agents for any business.</p>
    </div>
  );
}
