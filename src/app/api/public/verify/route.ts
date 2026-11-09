import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createElectionVerificationCookie, createRateLimitKey, hashSensitiveValue, hashToken } from "@/lib/qura-security";
import { requestAddress, sameOriginRequest } from "@/lib/admin-session";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Enter the voting code from your invitation." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Enter the voting code from your invitation." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(body.token) ||
      typeof body.code !== "string" || body.code.trim().length < 2 || body.code.length > 100) {
    return NextResponse.json({ message: "Enter a valid voting code." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: rateAllowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
    p_bucket: createRateLimitKey("eligibility-verify", requestAddress(request)),
    p_limit: 5,
  });
  if (rateError) {
    console.error("Eligibility verification rate limit failed:", rateError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!rateAllowed) {
    return NextResponse.json({ message: "Too many verification attempts. Please wait a minute and try again." }, { status: 429 });
  }

  const { data: invitation, error: invitationError } = await supabase.from("invitation_tokens")
    .select("id, election_id, eligibility_id, expires_at, revoked_at, used_at")
    .eq("token_hash", hashToken(body.token)).maybeSingle();
  if (invitationError) {
    console.error("Invitation verification lookup failed:", invitationError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!invitation || invitation.revoked_at || invitation.used_at ||
      (invitation.expires_at && Date.parse(invitation.expires_at) <= Date.now())) {
    return NextResponse.json({ message: "This voting link or code is invalid or has already been used." }, { status: 403 });
  }

  const [{ data: eligibility, error: eligibilityError }, { data: election, error: electionError }] = await Promise.all([
    supabase.from("voter_eligibility").select("id, voter_ref_hash, is_active")
      .eq("id", invitation.eligibility_id).eq("election_id", invitation.election_id).maybeSingle(),
    supabase.from("elections").select("status, opens_at, closes_at")
      .eq("id", invitation.election_id).maybeSingle(),
  ]);
  if (eligibilityError || electionError) {
    console.error("Eligibility verification query failed:", eligibilityError?.message, electionError?.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!eligibility?.is_active || !election ||
      election.status !== "open" || Date.now() < Date.parse(election.opens_at) || Date.now() >= Date.parse(election.closes_at) ||
      eligibility.voter_ref_hash !== hashSensitiveValue(body.code)) {
    return NextResponse.json({ message: "That voting code could not be verified for this link." }, { status: 403 });
  }

  return NextResponse.json(
    { verified: true },
    { headers: { "Set-Cookie": createElectionVerificationCookie(body.token), "Cache-Control": "no-store" } },
  );
}
