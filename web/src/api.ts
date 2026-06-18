const TOKEN_KEY = "vaos_token";

// Base URL for the backend API. Set VITE_API_URL in production (e.g. Vercel) to
// the separately-hosted backend domain. Empty in local dev so requests stay
// relative and go through the Vite proxy in vite.config.ts.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "https://voice.nyxtry.in").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ApiHooks {
  onUnauthorized: () => void;
}

let hooks: ApiHooks = { onUnauthorized: () => {} };
export function setApiHooks(h: ApiHooks) {
  hooks = h;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  isMultipart = false
): Promise<T | null> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isMultipart) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isMultipart ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    hooks.onUnauthorized();
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { message?: string }).message || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(p: string) => request<T>("GET", p),
  post: <T = unknown>(p: string, b?: unknown) => request<T>("POST", p, b),
  put: <T = unknown>(p: string, b?: unknown) => request<T>("PUT", p, b),
  upload: <T = unknown>(p: string, form: FormData) => request<T>("POST", p, form, true)
};
