import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  adminSessionExpiry,
  createAdminCookie,
  createOpaqueToken,
  createRateLimitKey,
  hashToken,
  verifyPassword,
} from "@/lib/qura-security";
import { requestAddress, sameOriginRequest } from "@/lib/admin-session";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Enter your administrator email and password." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Enter your administrator email and password." }, { status: 400 });
  }
  const body = parsed as { email?: unknown; password?: unknown };
  if (typeof body.email !== "string" || typeof body.password !== "string" ||
      body.email.length > 254 || body.password.length > 256) {
    return NextResponse.json({ message: "Enter your administrator email and password." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: allowed, error: rateError } = await supabase.rpc("consume_admin_login_limit", {
    p_bucket: createRateLimitKey("admin-login", requestAddress(request)),
  });
  if (rateError) {
    console.error("Administrator login rate limit failed:", rateError.message);
    return NextResponse.json({ message: "Administrator sign-in is temporarily unavailable." }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ message: "Too many sign-in attempts. Please wait 15 minutes." }, { status: 429 });
  }

  const { data: admin, error } = await supabase
    .from("admins")
    .select("id, email, password_salt, password_hash")
    .eq("email", body.email.trim().toLowerCase())
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Administrator lookup failed:", error.message);
    return NextResponse.json({ message: "Administrator sign-in is temporarily unavailable." }, { status: 503 });
  }
  const passwordValid = verifyPassword(
    body.password,
    admin?.password_salt ?? "0".repeat(64),
    admin?.password_hash ?? "0".repeat(128),
  );
  if (!admin || !passwordValid) {
    return NextResponse.json({ message: "Email or password is incorrect." }, { status: 401 });
  }

  const token = createOpaqueToken();
  const { error: sessionError } = await supabase.from("admin_sessions").insert({
    admin_id: admin.id,
    token_hash: hashToken(token),
    expires_at: adminSessionExpiry(),
  });
  if (sessionError) {
    console.error("Administrator session creation failed:", sessionError.message);
    return NextResponse.json({ message: "Could not start an administrator session." }, { status: 503 });
  }

  return NextResponse.json(
    { admin: { id: admin.id, email: admin.email } },
    { headers: { "Set-Cookie": createAdminCookie(token) } },
  );
}
