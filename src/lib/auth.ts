// ─── Authentication ─────────────────────────────────────────────────────────
// Sessions: opaque bearer token in an httpOnly cookie; only its SHA-256 hash
// is stored, so a DB leak does not expose live sessions.
// Password hashing lives in authCore.ts (no Next imports, script-safe).

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

export { hashPassword, verifyPassword, provisionNewUser } from "./authCore";

const SESSION_COOKIE = "nexus_session";
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
}

/** Resolve the current session user, or null. Use in route handlers and server components. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return { id: session.user.id, username: session.user.username, name: session.user.name };
}

/** Like getSessionUser but throws AuthError (mapped to 401 by handleError). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  return user;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/** Registration policy: open by default; set NEXUS_REGISTRATION=closed to lock down. */
export function registrationOpen(): boolean {
  return process.env.NEXUS_REGISTRATION !== "closed";
}
