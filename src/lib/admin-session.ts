import "server-only";
import { cookies } from "next/headers";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { adminCookieName, hashToken } from "@/lib/qura-security";

export type AdminIdentity = { id: string; email: string };

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(adminCookieName())?.value;
  if (!token) return null;

  const supabase = createAdminSupabase();
  const { data: session, error: sessionError } = await supabase
    .from("admin_sessions")
    .select("admin_id")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError) throw new Error(`Could not check administrator session: ${sessionError.message}`);
  if (!session) return null;

  const { data: admin, error: adminError } = await supabase
    .from("admins")
    .select("id, email")
    .eq("id", session.admin_id)
    .eq("is_active", true)
    .maybeSingle();
  if (adminError) throw new Error(`Could not check administrator access: ${adminError.message}`);
  return admin;
}

export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function requestAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
