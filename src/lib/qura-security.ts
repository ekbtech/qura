import "server-only";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/supabase/config";

const SESSION_SECRET = "qura_admin_session";
const SESSION_HOURS = 8;
export const ELECTION_VERIFICATION_COOKIE = "qura_election_verified";
const ELECTION_VERIFICATION_SECONDS = 15 * 60;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createElectionVerificationCookie(invitationToken: string): string {
  const expiresAt = Date.now() + ELECTION_VERIFICATION_SECONDS * 1000;
  const payload = Buffer.from(`${hashToken(invitationToken)}:${expiresAt}`).toString("base64url");
  const signature = createHmac("sha256", hashSecret()).update(payload).digest("base64url");
  return `${ELECTION_VERIFICATION_COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ELECTION_VERIFICATION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function isElectionInvitationVerified(invitationToken: string, value: string | undefined): boolean {
  if (!value) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  const expected = createHmac("sha256", hashSecret()).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf(":");
  if (separator < 0 || decoded.slice(0, separator) !== hashToken(invitationToken)) return false;
  const expiresAt = Number(decoded.slice(separator + 1));
  return Number.isSafeInteger(expiresAt) && expiresAt > Date.now();
}

function hashSecret(): string {
  const secret = requireEnv("QURA_HASH_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("QURA_HASH_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

export function hashSensitiveValue(value: string): string {
  const secret = hashSecret();
  return createHmac("sha256", secret).update(value.trim().toLowerCase(), "utf8").digest("hex");
}

export function createPasswordHash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(createPasswordHash(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createAdminCookie(token: string, maxAge = SESSION_HOURS * 60 * 60): string {
  return `${SESSION_SECRET}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearAdminCookie(): string {
  return `${SESSION_SECRET}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function adminCookieName(): string {
  return SESSION_SECRET;
}

export function adminSessionExpiry(hours = SESSION_HOURS): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function createRateLimitKey(scope: string, clientAddress: string): string {
  const secret = hashSecret();
  return createHmac("sha256", secret)
    .update(`${scope}:${clientAddress}`)
    .digest("hex");
}
