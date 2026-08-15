import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// ─── Connection pool settings ────────────────────────────────────
// Neon (Postgres serverless) can cold-start in 1-3s when idle.
// If a connection attempt takes longer than 10s, it's almost certainly
// a network issue or the database is down — abort and let the API
// route return an error instead of hanging forever.
//
// Pool size: 10 (down from 20) — Neon's free tier supports 10
// concurrent connections. More connections = more cold-starts + more
// memory on the Neon side.
//
// Idle timeout: 10s (down from 30s) — connections that haven't been
// used in 10s are returned to Neon. This prevents connection leaks
// when API routes are called frequently.
//
// Connection timeout: 10s (up from 5s) — gives Neon enough time to
// cold-start, but not so long that the user waits forever.
//
// IMPORTANT: Prisma 7+ removed $use() middleware. To add a statement
// timeout, we append &statement_timeout=15000 to the connection string
// so Postgres itself enforces it (no client-side middleware needed).
const dbUrl = connectionString.includes("statement_timeout")
  ? connectionString
  : (connectionString.includes("?")
      ? connectionString + "&statement_timeout=15000&connect_timeout=10"
      : connectionString + "?statement_timeout=15000&connect_timeout=10");

const adapter = new PrismaPg({
  connectionString: dbUrl,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
});

const db = new PrismaClient({
  adapter,
  // Log warnings + errors so we can identify slow queries in the
  // server logs. Prisma logs the query + duration for slow queries.
  log: [
    { emit: "stdout", level: "warn" },
    { emit: "stdout", level: "error" },
  ],
});

export { db };
