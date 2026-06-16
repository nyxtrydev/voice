import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthUser } from "../types/domain.js";

interface TokenPayload {
  sub: string;
  email: string;
  plan: string;
}

export function signAuthToken(user: AuthUser) {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  };

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      plan: user.plan
    } satisfies TokenPayload,
    env.JWT_SECRET,
    options
  );
}

export function verifyAuthToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  return {
    id: payload.sub,
    email: payload.email,
    plan: payload.plan
  };
}
