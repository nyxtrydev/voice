import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { userRepository } from "../db/repositories.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { badRequest, unauthorized } from "../lib/httpErrors.js";
import { signAuthToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

const authBody = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function authRoutes(app: FastifyInstance) {
  const users = userRepository(pool);

  app.post("/api/auth/register", async (request, reply) => {
    const body = authBody.parse(request.body);
    const passwordHash = await hashPassword(body.password);

    try {
      const user = await users.create(body.email, passwordHash);
      const authUser = { id: user.id, email: user.email, plan: user.plan };
      return reply.code(201).send({
        token: signAuthToken(authUser),
        user: authUser
      });
    } catch (error: any) {
      if (error?.code === "23505") throw badRequest("Email is already registered");
      throw error;
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = authBody.parse(request.body);
    const user = await users.findByEmail(body.email);
    if (!user) throw unauthorized("Invalid email or password");

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) throw unauthorized("Invalid email or password");

    const authUser = { id: user.id, email: user.email, plan: user.plan };
    return reply.send({
      token: signAuthToken(authUser),
      user: authUser
    });
  });

  app.get("/api/me", { preHandler: requireAuth }, async (request) => {
    return { user: currentUser(request) };
  });

  // Public — exposes only safe config values (no credentials)
  app.get("/api/info", async () => {
    return {
      twilioPhone: env.TWILIO_PHONE_NUMBER || null,
      publicBaseUrl: env.PUBLIC_BASE_URL
    };
  });
}
