import { NextResponse } from "next/server";
import { authorizeAdminMutation } from "@/lib/admin-api";
import { getAdminIdentity } from "@/lib/admin-session";
import { normalizePlatformSettings, type PlatformSettings } from "@/lib/platform-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const admin = await getAdminIdentity();
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "qura")
    .maybeSingle();
  if (error) {
    console.error("Platform settings lookup failed:", error.message);
    return NextResponse.json({ message: "Could not load platform settings." }, { status: 503 });
  }
  return NextResponse.json({ settings: normalizePlatformSettings(data?.setting_value) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide valid platform settings." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide valid platform settings." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const settings = normalizePlatformSettings(body);
  if (typeof body.schoolName !== "string" || body.schoolName.trim().length < 2 || body.schoolName.trim().length > 120 ||
      typeof body.contactEmail !== "string" || body.contactEmail.length > 254 ||
      (body.contactEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) ||
      typeof body.timeZone !== "string" || !isTimeZone(body.timeZone) ||
      (body.language !== "en" && body.language !== "sw") ||
      (body.theme !== "light" && body.theme !== "dark" && body.theme !== "system") ||
      typeof body.emailVerificationEnabled !== "boolean" ||
      !Number.isInteger(body.sessionTimeoutHours) || (body.sessionTimeoutHours as number) < 1 || (body.sessionTimeoutHours as number) > 24 ||
      !Number.isInteger(body.defaultEventDurationHours) || (body.defaultEventDurationHours as number) < 1 || (body.defaultEventDurationHours as number) > 720 ||
      typeof body.defaultResultsPublic !== "boolean" ||
      typeof body.defaultPollSessionProtection !== "boolean" ||
      !Number.isInteger(body.defaultPollRateLimit) || (body.defaultPollRateLimit as number) < 1 || (body.defaultPollRateLimit as number) > 120) {
    return NextResponse.json({ message: "Check the school profile and settings values." }, { status: 400 });
  }

  const validatedSettings: PlatformSettings = {
    ...settings,
    schoolName: settings.schoolName.trim(),
    contactEmail: settings.contactEmail.trim().toLowerCase(),
  };
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("platform_settings").upsert({
    setting_key: "qura",
    setting_value: validatedSettings,
    updated_by: admin.id,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Platform settings save failed:", error.message);
    return NextResponse.json({ message: "Could not save platform settings." }, { status: 503 });
  }
  const { error: auditError } = await supabase.from("audit_logs").insert({
    admin_id: admin.id,
    action: "platform.settings.updated",
    details: {
      emailVerificationEnabled: validatedSettings.emailVerificationEnabled,
      language: validatedSettings.language,
      theme: validatedSettings.theme,
    },
  });
  if (auditError) console.error("Platform settings audit log failed:", auditError.message);
  return NextResponse.json({
    success: true,
    settings: validatedSettings,
    ...(auditError ? { warning: "Settings were saved, but the audit log could not be recorded." } : {}),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
