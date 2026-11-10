import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createElectionVerificationCookie, createRateLimitKey, hashSensitiveValue, hashToken, createOpaqueToken } from "@/lib/qura-security";
import { requestAddress, sameOriginRequest } from "@/lib/admin-session";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };
const INVALID_CODE_MESSAGE = "The registration number or verification code is invalid, expired, or already used.";

export async function POST(request: Request, context: Context) {
  if (!sameOriginRequest(request)) return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  const { id: electionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(electionId)) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400 });

  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400 });
  const body = parsed as Record<string, unknown>;
  if (typeof body.registrationNumber !== "string" || body.registrationNumber.trim().length < 2 ||
      body.registrationNumber.length > 100 || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: rateAllowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
    p_bucket: createRateLimitKey(`election-code-verify:${electionId}`, requestAddress(request)),
    p_limit: 10,
  });
  if (rateError) {
    console.error("Election email-code verification rate limit failed:", rateError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!rateAllowed) return NextResponse.json({ message: "Too many verification attempts. Wait a minute before trying again." }, { status: 429 });

  const { data: election, error: electionError } = await supabase.from("elections")
    .select("status,opens_at,closes_at").eq("id", electionId).maybeSingle();
  if (electionError) {
    console.error("Election code verification lookup failed:", electionError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!election || election.status !== "open" || Date.now() < Date.parse(election.opens_at) || Date.now() >= Date.parse(election.closes_at)) {
    return NextResponse.json({ message: "This election is not currently accepting votes." }, { status: 409 });
  }

  const { data: eligibility, error: eligibilityError } = await supabase.from("voter_eligibility")
    .select("id,is_active").eq("election_id", electionId)
    .eq("voter_ref_hash", hashSensitiveValue(body.registrationNumber)).maybeSingle();
  if (eligibilityError) {
    console.error("Election voter verification lookup failed:", eligibilityError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!eligibility?.is_active) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });

  const { data: challenge, error: challengeError } = await supabase.from("election_email_codes")
    .select("id,code_hash,attempts,expires_at").eq("election_id", electionId)
    .eq("eligibility_id", eligibility.id).is("consumed_at", null)
    .gt("expires_at", new Date().toISOString()).lt("attempts", 5)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (challengeError) {
    console.error("Election email-code lookup failed:", challengeError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!challenge) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });

  const expected = Buffer.from(challenge.code_hash, "hex");
  const supplied = Buffer.from(hashSensitiveValue(`${eligibility.id}:${body.code}`), "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    const attempts = challenge.attempts + 1;
    const { error: attemptError } = await supabase.from("election_email_codes")
      .update({ attempts, ...(attempts >= 5 ? { consumed_at: new Date().toISOString() } : {}) })
      .eq("id", challenge.id).eq("attempts", challenge.attempts).is("consumed_at", null);
    if (attemptError) {
      console.error("Election email-code attempt update failed:", attemptError.message);
      return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
    }
    return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: consumedChallenge, error: consumeError } = await supabase.from("election_email_codes")
    .update({ consumed_at: now }).eq("id", challenge.id).eq("attempts", challenge.attempts)
    .is("consumed_at", null).select("id").maybeSingle();
  if (consumeError) {
    console.error("Election email-code consumption failed:", consumeError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!consumedChallenge) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });

  const { data: invitation, error: invitationError } = await supabase.from("invitation_tokens")
    .select("id").eq("election_id", electionId).eq("eligibility_id", eligibility.id)
    .is("revoked_at", null).is("used_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle();
  if (invitationError) {
    console.error("Election invitation lookup failed:", invitationError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!invitation) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });

  const token = createOpaqueToken();
  const { data: updatedInvitation, error: updateError } = await supabase.from("invitation_tokens")
    .update({ token_hash: hashToken(token) }).eq("id", invitation.id)
    .is("revoked_at", null).is("used_at", null).select("id").maybeSingle();
  if (updateError) {
    console.error("Election invitation activation failed:", updateError.message);
    return NextResponse.json({ message: "Verification is temporarily unavailable." }, { status: 503 });
  }
  if (!updatedInvitation) return NextResponse.json({ message: INVALID_CODE_MESSAGE }, { status: 403 });

  return NextResponse.json(
    { token },
    { headers: { "Set-Cookie": createElectionVerificationCookie(token), "Cache-Control": "no-store" } },
  );
}
