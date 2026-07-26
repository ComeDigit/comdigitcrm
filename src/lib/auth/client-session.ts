import "server-only";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { clientSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * A session that resolves to a suspended or archived workspace is treated
 * as invalid — this is what makes "Suspend client" / "Delete client" in the
 * admin clients page actually cut off portal access, rather than just
 * hiding the workspace from the admin's own roster while the client stays
 * logged in indefinitely on their existing session.
 */
async function workspaceBlocksAccess(workspaceId: string): Promise<boolean> {
  const db = getDb();
  const workspace = await db.query.workspaces.findFirst({
    where: (w, { eq: eqOp }) => eqOp(w.id, workspaceId),
    columns: { status: true, archivedAt: true },
  });
  return !workspace || workspace.status === "suspended" || workspace.archivedAt !== null;
}

/**
 * Client portal auth — a second, separate login system from the internal
 * agency dashboard (which has none, by design). A client_user is tied to
 * exactly one workspace; a session resolves to that workspace and ONLY
 * that workspace, looked up server-side on every request — never trusted
 * from a client-editable cookie value or query param the way the internal
 * dashboard's "ws" switcher cookie is. This is what makes it safe for a
 * client to be logged in without being able to browse into another
 * client's data by tampering with a cookie.
 *
 * Passwords: scrypt with a random salt per password, format
 * "<salt hex>:<hash hex>" — no external dependency, timing-safe compare.
 * Sessions: same hashed-opaque-token pattern as share_links — the raw
 * token lives only in the httpOnly cookie, only its SHA-256 hash is ever
 * persisted, so a database leak alone can't forge a working session.
 */

const COOKIE_NAME = "client_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ClientSession {
  clientUserId: string;
  workspaceId: string;
  username: string;
}

/** Creates a session row and sets the httpOnly cookie. Caller redirects after. */
export async function createClientSession(clientUserId: string): Promise<void> {
  const db = getDb();
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(clientSessions).values({
    clientUserId,
    tokenHash: hashToken(raw),
    expiresAt,
  });

  const store = await cookies();
  store.set(COOKIE_NAME, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/client",
    expires: expiresAt,
  });
}

/**
 * Resolves the current client session, if any. This is the ONLY source of
 * truth for which workspace a /client/* page renders — never read
 * workspaceId from anywhere else on that route tree.
 */
export async function getClientSession(): Promise<ClientSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const db = getDb();
  const session = await db.query.clientSessions.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.tokenHash, hashToken(raw)),
  });
  if (!session || session.expiresAt < new Date()) return null;

  const user = await db.query.clientUsers.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, session.clientUserId),
  });
  if (!user || user.status !== "active") return null;
  if (await workspaceBlocksAccess(user.workspaceId)) return null;

  return {
    clientUserId: user.id,
    workspaceId: user.workspaceId,
    username: user.username,
  };
}

/**
 * Every /client/* page (other than the login page itself) starts with this
 * instead of calling getClientSession() directly — keeps the "no session →
 * bounce to login" check identical across all seven route files rather than
 * repeating the null-check + redirect in each one.
 */
export async function requireClientSession(): Promise<ClientSession> {
  const session = await getClientSession();
  if (!session) redirect("/client/login");
  return session;
}

/** Clears the session both server-side (DB row) and client-side (cookie). */
export async function destroyClientSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw) {
    const db = getDb();
    await db.delete(clientSessions).where(eq(clientSessions.tokenHash, hashToken(raw))).catch(() => {});
  }
  store.delete(COOKIE_NAME);
}
