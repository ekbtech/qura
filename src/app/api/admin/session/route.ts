import { NextResponse } from "next/server";
import { getAdminIdentity, sameOriginRequest } from "@/lib/admin-session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { adminCookieName, clearAdminCookie, hashToken } from "@/lib/qura-security";
import { cookies } from "next/headers";

export async function GET() {
  const admin = await getAdminIdentity();
  return NextResponse.json({ admin });
}

export async function DELETE(request: Request) {
  if (!sameOriginRequest(request)) {
    return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  }
  const token = (await cookies()).get(adminCookieName())?.value;
  if (token) {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from("admin_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashToken(token))
      .is("revoked_at", null);
    if (error) {
      console.error("Administrator logout failed:", error.message);
      return NextResponse.json({ message: "Could not end the session." }, { status: 503 });
    }
  }
  return NextResponse.json({ success: true }, { headers: { "Set-Cookie": clearAdminCookie() } });
}
