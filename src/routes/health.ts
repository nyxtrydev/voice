import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/healthz", async () => {
    const result = await pool.query("SELECT 1 AS ok");
    return {
      ok: result.rows[0]?.ok === 1,
      service: "voiceagentos",
      at: new Date().toISOString()
    };
  });
}
