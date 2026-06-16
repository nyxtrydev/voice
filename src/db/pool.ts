import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === "production" ? 20 : 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

export async function closePool() {
  await pool.end();
}
