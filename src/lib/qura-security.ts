import "server-only";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/supabase/config";

const SESSION_SECRET = "qura_admin_session";
const SESSION_HOURS = 8;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
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

export function createAdminCookie(token: string): string {
  const maxAge = SESSION_HOURS * 60 * 60;
  return `${SESSION_SECRET}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearAdminCookie(): string {
  return `${SESSION_SECRET}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function adminCookieName(): string {
  return SESSION_SECRET;
}

export function adminSessionExpiry(): string {
  return new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
}

export function createRateLimitKey(scope: string, clientAddress: string): string {
  const secret = hashSecret();
  return createHmac("sha256", secret)
    .update(`${scope}:${clientAddress}`)
    .digest("hex");
}
