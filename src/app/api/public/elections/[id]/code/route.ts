import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createElectionVerificationCookie, createOpaqueToken, createRateLimitKey, hashSensitiveValue, hashToken } from "@/lib/qura-security";
import { requestAddress, sameOriginRequest } from "@/lib/admin-session";
import { getPlatformSettings } from "@/lib/platform-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };
const GENERIC_RESPONSE = "If your registration number is eligible, a code has been sent to its registered email address. If it does not arrive, contact the election administrator.";

async function sendVerificationCode(email: string, electionTitle: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_TEST_MODE === "true"
    ? "onboarding@resend.dev"
    : process.env.QURA_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Email delivery is not configured. Set RESEND_API_KEY and QURA_EMAIL_FROM.");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [email],
    subject: `Your ${electionTitle} verification code`,
    text: `Your QURA verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
  });
  if (error) throw new Error(`Resend email delivery failed: ${error.message}`);
}

export async function POST(request: Request, context: Context) {
  if (!sameOriginRequest(request)) return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  const { id: electionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(electionId)) return NextResponse.json({ message: "Election not found." }, { status: 404 });

  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ message: "Enter your registration number." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Enter your registration number." }, { status: 400 });
  }
  const registrationNumber = (parsed as Record<string, unknown>).registrationNumber;
  if (typeof registrationNumber !== "string" || registrationNumber.trim().length < 2 || registrationNumber.length > 100) {
    return NextResponse.json({ message: "Enter a valid registration number." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  let emailVerificationEnabled: boolean;
  try {
    emailVerificationEnabled = (await getPlatformSettings()).emailVerificationEnabled;
  } catch (error) {
    console.error("Platform settings lookup failed for voter access:", error);
    return NextResponse.json({ message: "Voter access is temporarily unavailable." }, { status: 503 });
  }
  const address = requestAddress(request);
  const { data: rateAllowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
    p_bucket: createRateLimitKey(`election-code:${electionId}`, address),
    p_limit: 5,
  });
  if (rateError) {
    console.error("Election email-code rate limit failed:", rateError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  if (!rateAllowed) return NextResponse.json({ message: "Too many code requests. Wait a minute before trying again." }, { status: 429 });
  if (emailVerificationEnabled && (!process.env.RESEND_API_KEY?.trim() ||
      (process.env.RESEND_TEST_MODE !== "true" && !process.env.QURA_EMAIL_FROM?.trim()))) {
    console.error("Election email verification is not configured.");
    return NextResponse.json({ message: "Election email verification is not configured. Contact the administrator." }, { status: 503 });
  }

  const { data: election, error: electionError } = await supabase.from("elections")
    .select("title,status,opens_at,closes_at").eq("id", electionId).maybeSingle();
  if (electionError) {
    console.error("Election code request lookup failed:", electionError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  if (!election || election.status !== "open" || Date.now() < Date.parse(election.opens_at) || Date.now() >= Date.parse(election.closes_at)) {
    return NextResponse.json({ message: "This election is not currently accepting verification requests." }, { status: 409 });
  }

  const voterRefHash = hashSensitiveValue(registrationNumber);
  const { data: eligibility, error: eligibilityError } = await supabase.from("voter_eligibility")
    .select("id,email,is_active").eq("election_id", electionId).eq("voter_ref_hash", voterRefHash).maybeSingle();
  if (eligibilityError) {
    console.error("Election eligibility lookup failed:", eligibilityError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  if (!eligibility?.is_active || (emailVerificationEnabled && !eligibility.email)) {
    return NextResponse.json(
      { message: GENERIC_RESPONSE, ...(emailVerificationEnabled ? { verificationRequired: true } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const voterLimit = createRateLimitKey(`election-code-voter:${electionId}`, eligibility.id);
  const { data: voterRateAllowed, error: voterRateError } = await supabase.rpc("consume_public_rate_limit", {
    p_bucket: voterLimit,
    p_limit: 3,
  });
  if (voterRateError) {
    console.error("Per-voter email-code rate limit failed:", voterRateError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  if (!voterRateAllowed) return NextResponse.json({ message: "Too many code requests. Wait a minute before trying again." }, { status: 429 });

  const { data: invitation, error: invitationError } = await supabase.from("invitation_tokens")
    .select("id,used_at,revoked_at,expires_at").eq("election_id", electionId).eq("eligibility_id", eligibility.id).maybeSingle();
  if (invitationError) {
    console.error("Election invitation lookup failed:", invitationError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  if (!invitation || invitation.used_at || invitation.revoked_at ||
      (invitation.expires_at && Date.parse(invitation.expires_at) <= Date.now())) {
    return NextResponse.json({ message: GENERIC_RESPONSE }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!emailVerificationEnabled) {
    const token = createOpaqueToken();
    const { data: activatedInvitation, error: activationError } = await supabase.from("invitation_tokens")
      .update({ token_hash: hashToken(token) }).eq("id", invitation.id)
      .is("revoked_at", null).is("used_at", null).select("id").maybeSingle();
    if (activationError) {
      console.error("Election invitation activation failed:", activationError.message);
      return NextResponse.json({ message: "Voter access is temporarily unavailable." }, { status: 503 });
    }
    if (!activatedInvitation) {
      return NextResponse.json({ message: GENERIC_RESPONSE }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      { token },
      { headers: { "Set-Cookie": createElectionVerificationCookie(token), "Cache-Control": "no-store" } },
    );
  }

  if (!eligibility.email) {
    return NextResponse.json({ message: GENERIC_RESPONSE }, { headers: { "Cache-Control": "no-store" } });
  }

  const code = String(randomInt(100000, 1000000));
  const { error: invalidateError } = await supabase.from("election_email_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("eligibility_id", eligibility.id).is("consumed_at", null);
  if (invalidateError) {
    console.error("Previous email-code invalidation failed:", invalidateError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }
  const { data: challenge, error: challengeError } = await supabase.from("election_email_codes").insert({
    election_id: electionId,
    eligibility_id: eligibility.id,
    code_hash: hashSensitiveValue(`${eligibility.id}:${code}`),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (challengeError) {
    console.error("Email-code challenge creation failed:", challengeError.message);
    return NextResponse.json({ message: "Code delivery is temporarily unavailable." }, { status: 503 });
  }

  try {
    await sendVerificationCode(eligibility.email, election.title, code);
  } catch (error) {
    await supabase.from("election_email_codes").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id);
    console.error("Election verification email delivery failed:", error);
    return NextResponse.json({ message: GENERIC_RESPONSE }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { message: GENERIC_RESPONSE, verificationRequired: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
