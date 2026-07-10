import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Server-only Drizzle client over the Supabase pooled connection.
 * Lazily created so demo mode (no DATABASE_URL) never opens a socket.
 * IMPORTANT: this client uses the direct database role and BYPASSES RLS —
 * every query through it MUST be tenant-scoped via the helpers in
 * src/lib/auth (enforced by lint rule + code review).
 */

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The app is in demo mode — database access is unavailable.",
    );
  }
  // Supabase pooler (transaction mode): disable prepared statements.
  const client = postgres(env.DATABASE_URL, { prepare: false, max: 10 });
  return drizzle(client, { schema });
}

export function getDb() {
  _db ??= createDb();
  return _db;
}
