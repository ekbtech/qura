import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeAdminMutation } from "@/lib/admin-api";
import { createPasswordHash, verifyPassword } from "@/lib/qura-security";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function PUT(request: Request) {
  const adminIdentity = await authorizeAdminMutation(request);
  if (!adminIdentity) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Enter your current and new passwords." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Enter your current and new passwords." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.currentPassword !== "string" || body.currentPassword.length > 256 ||
      typeof body.newPassword !== "string" || body.newPassword.length < 6 || body.newPassword.length > 256) {
    return NextResponse.json({ message: "Enter your current password and a new password of at least 6 characters." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: admin, error: lookupError } = await supabase.from("admins")
    .select("id,password_salt,password_hash")
    .eq("id", adminIdentity.id)
    .eq("is_active", true)
    .maybeSingle();
  if (lookupError) {
    console.error("Administrator password lookup failed:", lookupError.message);
    return NextResponse.json({ message: "Could not verify the current password." }, { status: 503 });
  }
  if (!admin || !verifyPassword(body.currentPassword, admin.password_salt, admin.password_hash)) {
    return NextResponse.json({ message: "Current password is incorrect." }, { status: 403 });
  }

  const passwordSalt = randomBytes(32).toString("hex");
  const passwordHash = createPasswordHash(body.newPassword, passwordSalt);
  const { error: updateError } = await supabase.from("admins")
    .update({ password_salt: passwordSalt, password_hash: passwordHash })
    .eq("id", admin.id);
  if (updateError) {
    console.error("Administrator password update failed:", updateError.message);
    return NextResponse.json({ message: "Could not update the administrator password." }, { status: 503 });
  }
  const { error: revokeError } = await supabase.from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("admin_id", admin.id)
    .is("revoked_at", null);
  if (revokeError) {
    console.error("Administrator session revocation after password change failed:", revokeError.message);
    return NextResponse.json({ message: "Password changed, but existing sessions could not all be ended. Sign out and review active sessions." }, { status: 503 });
  }
  const { error: auditError } = await supabase.from("audit_logs").insert({
    admin_id: admin.id,
    action: "admin.password.changed",
  });
  if (auditError) console.error("Administrator password audit log failed:", auditError.message);
  return NextResponse.json({
    success: true,
    ...(auditError ? { warning: "Password changed, but the audit log could not be recorded." } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}
