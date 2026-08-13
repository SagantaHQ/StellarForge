/**
 * Soroban.Build — typed config module.
 *
 * Single source of truth for environment configuration.
 * Validates at boot and fails fast with a clear, named error
 * for each missing/invalid variable. No scattered process.env reads.
 */

import { z } from "zod";

const ConfigSchema = z.object({
  // Database
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("postgres"), {
      message: "DATABASE_URL must be a postgres:// URL",
    }),
  DIRECT_DATABASE_URL: z
    .string()
    .url()
    .optional()
    .refine(
      (u) => !u || u.startsWith("postgres"),
      { message: "DIRECT_DATABASE_URL must be a postgres:// URL" }
    ),

  // App
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),

  // WebSocket collab server
  WS_PORT: z.coerce.number().int().positive().default(3001),
  WS_CORS_ORIGIN: z.string().default("*"),

  // Git workflow (§1)
  GIT_REMOTE_URL: z
    .string()
    .url()
    .default("https://github.com/SagantaHQ/soroban.build"),
  GIT_PUSH_TOKEN: z.string().optional(),
  GIT_AUTHOR_NAME: z.string().default("ra-sun-god"),
  GIT_AUTHOR_EMAIL: z.string().default("ra-sun-god@users.noreply.github.com"),

  // Stellar RPC endpoints (§3)
  STELLAR_RPC_MAINNET: z
    .string()
    .url()
    .default("https://soroban-mainnet.stellar.org"),
  STELLAR_RPC_TESTNET: z
    .string()
    .url()
    .default("https://soroban-testnet.stellar.org"),
  STELLAR_RPC_FUTURENET: z
    .string()
    .url()
    .default("https://rpc.futurenet.stellar.org"),
  STELLAR_RPC_LOCAL: z
    .string()
    .url()
    .default("http://localhost:8000"),

  // Stellar Horizon
  STELLAR_HORIZON_TESTNET: z
    .string()
    .url()
    .default("https://horizon-testnet.stellar.org"),
  STELLAR_HORIZON_MAINNET: z
    .string()
    .url()
    .default("https://horizon.stellar.org"),

  // Toolchain (§7)
  RUST_TOOLCHAIN: z.string().default("stable"),
  SOROBAN_SDK_VERSION: z.string().default("27.0.5"),

  // Terminal sandbox (§15.4)
  TERMINAL_EGRESS_ALLOWLIST: z
    .string()
    .default("crates.io,static.crates.io,rpc.stellar.org,horizon.stellar.org,github.com"),
  TERMINAL_CPU_LIMIT: z.string().default("1.0"),
  TERMINAL_MEMORY_LIMIT_MB: z.coerce.number().int().positive().default(1024),
  TERMINAL_DISK_QUOTA_MB: z.coerce.number().int().positive().default(512),
  TERMINAL_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // AI providers — only used server-side for CORS-blocked passthrough (§9.10)
  AI_PROXY_ENABLED: z.coerce.boolean().default(true),
  AI_PROXY_LOG_REQUESTS: z.coerce.boolean().default(false),

  // Observability
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SENTRY_DSN: z.string().url().optional(),

  // Knowledge base (§9.4) — cloned at install
  KNOWLEDGE_DIR: z.string().default("./knowledge"),

  // Session
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 chars")
    .default("dev-only-insecure-secret-change-me-please-32-chars"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

/**
 * Read + validate environment. Throws on first invalid/missing variable
 * with a clear, named error.
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.join(".") || "(root)";
      return `  - ${path}: ${i.message}`;
    });
    const msg =
      "Soroban.Build failed to start — invalid environment configuration:\n" +
      issues.join("\n") +
      "\n\nCheck .env against .env.example and try again.";
    throw new Error(msg);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

/**
 * Get the active config (must call loadConfig() first).
 * Returns null if not yet loaded — callers should fall back to loadConfig().
 */
export function config(): AppConfig {
  return cachedConfig ?? loadConfig();
}
