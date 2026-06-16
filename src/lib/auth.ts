import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "./httpErrors.js";
import { verifyAuthToken } from "./jwt.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const header = request.headers.authorization;
  // EventSource cannot send headers; allow ?token= for SSE endpoints
  const queryToken = (request.query as Record<string, string>)?.token;

  const raw = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : queryToken || null;

  if (!raw) throw unauthorized();

  try {
    request.auth = verifyAuthToken(raw);
  } catch (err: any) {
    // JsonWebTokenError / TokenExpiredError → always 401, never 500
    const msg = err?.name === "TokenExpiredError"
      ? "Session expired — please log in again"
      : "Invalid token";
    throw unauthorized(msg);
  }
}

export function currentUser(request: FastifyRequest) {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
