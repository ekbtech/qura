import "server-only";
import type { AdminIdentity } from "@/lib/admin-session";
import { getAdminIdentity, sameOriginRequest } from "@/lib/admin-session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

export async function authorizeAdminMutation(request: Request): Promise<AdminIdentity | null> {
  if (!sameOriginRequest(request)) return null;
  return getAdminIdentity();
}

export async function writeAuditLog(
  adminId: string,
  action: string,
  eventType: "poll" | "election" | null = null,
  eventId: string | null = null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("audit_logs").insert({
    admin_id: adminId,
    action,
    event_type: eventType,
    event_id: eventId,
    details,
  });
  if (error) throw new Error(`Could not record administrator action: ${error.message}`);
}

export function isEventType(value: unknown): value is "poll" | "election" {
  return value === "poll" || value === "election";
}

export async function eventExists(
  supabase: ReturnType<typeof createAdminSupabase>,
  eventType: "poll" | "election",
  eventId: string,
): Promise<boolean> {
  const table = eventType === "poll" ? "polls" : "elections";
  const { data, error } = await supabase.from(table).select("id").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`Could not check event: ${error.message}`);
  return data !== null;
}

export type AdminDatabase = ReturnType<typeof createAdminSupabase>;
export type EventRecord = Database["public"]["Tables"]["polls"]["Row"] |
  Database["public"]["Tables"]["elections"]["Row"];
