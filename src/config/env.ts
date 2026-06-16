import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24, "JWT_SECRET must be at least 24 characters"),
  JWT_EXPIRES_IN: z.string().default("30d"),
  CORS_ORIGIN: z.string().default("http://localhost:4000"),
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().default("meta-llama/llama-4-scout-17b-16e-instruct"),
  GROQ_FALLBACK_MODELS: z.string().default("llama-3.3-70b-versatile,llama-3.1-8b-instant"),
  SARVAM_API_KEY: z.string().optional().default(""),
  TWILIO_ACCOUNT_SID: z.string().optional().default(""),
  TWILIO_AUTH_TOKEN: z.string().optional().default(""),
  TWILIO_PHONE_NUMBER: z.string().optional().default("")
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const groqFallbackModels = env.GROQ_FALLBACK_MODELS.split(",")
  .map((model) => model.trim())
  .filter(Boolean);

export function corsOrigins(): string[] | boolean {
  if (env.CORS_ORIGIN === "*") return true;
  return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
}
