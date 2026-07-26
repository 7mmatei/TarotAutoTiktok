import { z } from "zod";

const envBoolean = z.preprocess((value)=>typeof value==="string"?value.trim().toLowerCase()==="true":value,z.boolean());

export const configSchema = z.object({
  DATABASE_URL: z.string().default("postgres://tarot:tarot@localhost:5432/tarot"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PERSISTENCE: z.enum(["memory", "postgres"]).default("memory"),
  QUEUE_PROVIDER: z.enum(["memory", "redis"]).default("memory"),
  PLAYBACK_LEASE_TTL_MS: z.coerce.number().int().positive().default(15_000),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().min(5_000).max(120_000).default(15_000),
  FREE_LIKES_THRESHOLD: z.coerce.number().int().positive().max(1_000_000).default(2_000),
  QUESTION_LOOKBACK_SECONDS: z.coerce.number().int().positive().max(3_600).default(300),
  AWAITING_QUESTION_SECONDS: z.coerce.number().int().positive().max(3_600).default(120),
  PLAYBACK_WATCHDOG_GRACE_MS: z.coerce.number().int().positive().default(30_000),
  ADMIN_TOKEN: z.string().default("change-me"),
  ACCOUNT_KEY: z.string().default("demo-account"),
  DEFAULT_LOCALE: z.string().default("es-MX"),
  EVENT_SOURCE: z.enum(["simulator", "tikfinity"]).default("simulator"),
  TIKFINITY_WS_URL: z.string().default("ws://localhost:21213"),
  LIVE_SESSION_ID: z.preprocess((value)=>value===""?undefined:value,z.string().uuid().optional()),
  LLM_PROVIDER: z.enum(["deterministic", "mock", "gemini"]).default("gemini"),
  GEMINI_API_KEY: z.preprocess((value)=>value===""?undefined:value,z.string().optional()),
  GEMINI_MODEL: z.literal("gemini-3.5-flash-lite").default("gemini-3.5-flash-lite"),
  GEMINI_DAILY_REQUEST_BUDGET: z.coerce.number().int().min(1).max(500).default(450),
  GEMINI_INTERACTION_DAILY_BUDGET: z.coerce.number().int().min(0).max(500).default(60),
  GEMINI_INTERACTION_EVERY_N_COMMENTS: z.coerce.number().int().min(1).max(100).default(5),
  TTS_PROVIDER: z.enum(["azure", "local"]).default("local"),
  TTS_API_KEY: z.string().optional(),
  TTS_REGION: z.string().default("eastus"),
  TTS_VOICE: z.string().default("es-MX-DaliaNeural"),
  CTA_TTS_ENABLED: envBoolean.default(true),
  CTA_TTS_INITIAL_DELAY_SECONDS: z.coerce.number().int().min(1).max(3_600).default(20),
  CTA_TTS_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(60),
  CTA_TTS_MIN_GAP_SECONDS: z.coerce.number().int().min(60).max(3_600).default(180),
  CTA_TTS_MAX_PER_SESSION: z.coerce.number().int().min(0).max(20).default(3),
  CTA_TTS_TEXT: z.string().min(10).max(500).default("Mora está leyendo el chat en vivo. Escribe una pregunta breve para participar."),
  CTA_TTS_TEXTS: z.preprocess((value)=>value===""?undefined:value,z.string().min(10).optional()),
  INTERACTION_TTS_ENABLED: envBoolean.default(true),
  INTERACTION_TTS_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(8),
  INTERACTION_TTS_GIFT_AWAITING_TEXT: z.string().min(10).max(500).default("{name}, gracias por apoyar el LIVE. Los regalos son opcionales. Si quieres participar, escribe una pregunta para una lectura de entretenimiento de {cards}."),
  AUDIO_DIR: z.string().default("./data/audio"),
  HMAC_SECRET: z.string().default("local-development-secret"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info")
});

export type AppConfig = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}
