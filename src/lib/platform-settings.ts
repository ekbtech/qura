import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { DEFAULT_PLATFORM_SETTINGS } from "@/lib/platform-settings.types";
import type { PlatformSettings } from "@/lib/platform-settings.types";

export { DEFAULT_PLATFORM_SETTINGS };
export type { PlatformSettings };

export function normalizePlatformSettings(value: Record<string, unknown> | null | undefined): PlatformSettings {
  const settings = { ...DEFAULT_PLATFORM_SETTINGS };
  if (!value) return settings;
  if (typeof value.schoolName === "string") settings.schoolName = value.schoolName;
  if (typeof value.contactEmail === "string") settings.contactEmail = value.contactEmail;
  if (typeof value.timeZone === "string") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
      settings.timeZone = value.timeZone;
    } catch {
      settings.timeZone = DEFAULT_PLATFORM_SETTINGS.timeZone;
    }
  }
  if (value.language === "en" || value.language === "sw") settings.language = value.language;
  if (value.theme === "light" || value.theme === "dark" || value.theme === "system") settings.theme = value.theme;
  if (typeof value.emailVerificationEnabled === "boolean") settings.emailVerificationEnabled = value.emailVerificationEnabled;
  if (typeof value.sessionTimeoutHours === "number" && Number.isInteger(value.sessionTimeoutHours) &&
      value.sessionTimeoutHours >= 1 && value.sessionTimeoutHours <= 24) {
    settings.sessionTimeoutHours = value.sessionTimeoutHours;
  }
  if (typeof value.defaultEventDurationHours === "number" && Number.isInteger(value.defaultEventDurationHours) &&
      value.defaultEventDurationHours >= 1 && value.defaultEventDurationHours <= 720) {
    settings.defaultEventDurationHours = value.defaultEventDurationHours;
  }
  if (typeof value.defaultResultsPublic === "boolean") settings.defaultResultsPublic = value.defaultResultsPublic;
  if (typeof value.defaultPollSessionProtection === "boolean") settings.defaultPollSessionProtection = value.defaultPollSessionProtection;
  if (typeof value.defaultPollRateLimit === "number" && Number.isInteger(value.defaultPollRateLimit) &&
      value.defaultPollRateLimit >= 1 && value.defaultPollRateLimit <= 120) {
    settings.defaultPollRateLimit = value.defaultPollRateLimit;
  }
  return settings;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from("platform_settings")
    .select("setting_value")
    .eq("setting_key", "qura")
    .maybeSingle();
  if (error) throw new Error(`Could not load platform settings: ${error.message}`);
  return normalizePlatformSettings(data?.setting_value);
}
