// Core auth logic: password hashing/verification and DB-backed session
// lifecycle. Routes (auth.route.ts) and the auth middleware
// (auth.middleware.ts) both call into this; neither touches Prisma or
// argon2 directly.
//
// Password hashing: argon2id, via the `argon2` package (native bindings,
// prebuilt for Alpine/x86-64 - confirmed against the library's own README
// this doesn't need a build toolchain in apps/api/Dockerfile's node:alpine
// base). Verified against OWASP's Password Storage Cheat Sheet (2026-09,
// via context7) before choosing this over bcrypt: OWASP recommends
// Argon2id as the primary choice and now describes bcrypt as acceptable
// only "in legacy systems where Argon2 and scrypt are not available" - so
// for a project starting real password storage from scratch today, Argon2id
// is the current recommendation, not bcrypt. The `argon2` package's own
// defaults (m=65536 KiB, t=3, p=4) already exceed OWASP's stated Argon2id
// minimum (19 MiB, t=2, p=1), so they're used as-is rather than overridden.
//
// Session storage: a DB-backed Session table (see prisma/schema.prisma),
// not a signed JWT - see the PR description for the full comparison. In
// short: this app's whole reason for existing is per-user state that must
// be revocable server-side (subscription status changes via webhook,
// logout must actually end a session immediately) - a JWT would need
// either short expiries with refresh-token machinery, or a revocation
// list, to get the same guarantee, both more moving parts than a project
// this size needs. A plain DB lookup per request is a negligible cost next
// to this app's existing per-request Prisma queries (the subscriptions
// gate and recent-searches logging already do one each).
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { prisma } from '../../shared/prisma';
import type { User } from '@prisma/client';

const ARGON2_TYPE = argon2.argon2id;

// A syntactically valid argon2id hash of a fixed, unrelated placeholder
// string - never a real user's password. Used only as the comparison
// target when no matching user was found, so that argon2.verify's
// (deliberately slow) running time is spent either way. Without this, a
// login attempt for a nonexistent email would return near-instantly (no
// hash to check against) while one for a real email takes however long
// argon2 verification takes - a timing side-channel that would let an
// attacker enumerate registered emails even though the response body
// itself is identical either way (see login() below).
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$LYUP5uueOQGKJkdZ3YAozw$s9t9/dY6OQgKGVGADeWfVepsfzXBacn0i7Xv2t9FgKU';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: ARGON2_TYPE });
}

async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // Malformed/foreign hash format - treat as "does not match" rather than
    // letting the error propagate, same posture as a wrong password.
    return false;
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Subset of User safe to hand to the frontend / put in a response body -
// never includes passwordHash or the Stripe ids.
export interface PublicUser {
  id: number;
  email: string;
  subscriptionStatus: string;
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, subscriptionStatus: user.subscriptionStatus };
}

export interface LoginResult {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

// Verifies email + password and, on success, creates a new Session row.
// Returns null on ANY failure - unknown email, wrong password, whatever -
// deliberately without distinguishing which, so the route layer physically
// cannot leak that distinction even by accident. Standard no-enumeration
// practice: "invalid email or password" is the only thing a caller can
// ever learn from this.
export async function login(email: string, password: string, sessionDurationMs: number): Promise<LoginResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Always call verifyPassword, even when no user was found - see
  // DUMMY_HASH above for why.
  const isValid = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);

  if (!user || !isValid) {
    return null;
  }

  const token = crypto.randomBytes(32).toString('hex'); // 256 bits of entropy, well above OWASP's 64-bit minimum
  const expiresAt = new Date(Date.now() + sessionDurationMs);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId: user.id, expiresAt },
  });

  return { user: toPublicUser(user), token, expiresAt };
}

// Deletes the session row for a given raw token, if one exists. Silently a
// no-op for an already-invalid/expired/unknown token - logout always
// "succeeds" from the caller's perspective, there's nothing more to do.
export async function endSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// Resolves a raw session token to the user it belongs to, or null if the
// token is missing, doesn't match any session, or the session has expired.
// Used both by requireAuth (hard-fails to 401 on null) and by modules that
// only need an optional "who's asking, if anyone" (the Subscriptions gate,
// Recent Searches logging) - so this itself never throws or 401s, it just
// answers the question.
export async function getUserByToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  return user ? toPublicUser(user) : null;
}
