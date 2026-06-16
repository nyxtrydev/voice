import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { ZodError } from "zod";
import { corsOrigins } from "./config/env.js";
import { AppError } from "./lib/httpErrors.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { twilioRoutes } from "./routes/twilio.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug"
    },
    trustProxy: true
  });

  await app.register(helmet, {
    contentSecurityPolicy: false
  });
  await app.register(cors, {
    origin: corsOrigins(),
    credentials: true
  });
  await app.register(formbody);
  await app.register(multipart);
  await app.register(websocket);

  // API-only service — the React dashboard is a separate deployable (see web/).
  // Root route is a lightweight banner so hitting the API host isn't a bare 404.
  app.get("/", async () => ({ service: "voiceagentos-api", status: "ok" }));

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(agentRoutes);
  await app.register(twilioRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Request validation failed",
        issues: error.issues
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message
      });
    }

    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Request failed";
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR",
      message: statusCode >= 500 ? "Unexpected server error" : message
    });
  });

  return app;
}
