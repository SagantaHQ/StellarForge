import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma client — creates a real connection when a PostgreSQL DATABASE_URL
 * is available, or a no-op proxy when the DB is unreachable (local dev
 * without Postgres installed).
 *
 * The no-op proxy throws a friendly error on any method call, so API routes
 * that depend on the DB return a clear 503 instead of crashing the process.
 * IDE features that don't need the DB (file editing, building, templates)
 * continue to work normally.
 */

function createDB(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL
  const isPostgresUrl = dbUrl?.startsWith('postgresql://') || dbUrl?.startsWith('postgres://')

  if (!dbUrl || !isPostgresUrl) {
    // No valid Postgres URL — return an unavailable proxy that throws
    // friendly errors on any method call. This lets the IDE run locally
    // without a Postgres database (file editing, building, templates work;
    // auth/projects/comments are disabled).
    if (typeof window === 'undefined') {
      console.warn(
        '⚠️  DATABASE_URL is not a PostgreSQL connection string. ' +
        'Server-side DB features (auth, projects, comments) are disabled. ' +
        'Set DATABASE_URL=postgresql://... to enable them.'
      )
    }
    const errMessage =
      'Database is not available. Set DATABASE_URL to a PostgreSQL connection string ' +
      'to enable server-side features.'
    return new Proxy({} as PrismaClient, {
      get: (_target, prop) => {
        if (
          prop === '$connect' ||
          prop === '$disconnect' ||
          prop === '$on' ||
          prop === '$transaction' ||
          prop === '$extends'
        ) {
          return async () => ({})
        }
        // Model access (db.user, db.project, etc.) — return a throwing proxy
        return new Proxy(
          {},
          {
            get: () => () => {
              throw new Error(errMessage)
            },
          }
        )
      },
    }) as PrismaClient
  }

  // Real Postgres URL — create a real PrismaClient
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const db = globalForPrisma.prisma ?? createDB()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
