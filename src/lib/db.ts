import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({
  connectionString,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

const db = new PrismaClient({
  adapter,
});

export { db };
