import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createRateLimitKey, hashSensitiveValue, hashToken } from "@/lib/qura-security";
import { getPublicBallot } from "@/lib/public-ballot";
import { requestAddress, sameOriginRequest } from "@/lib/admin-session";

const SESSION_COOKIE = "qura_public_session";

async function verifyTurnstile(token: unknown, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || typeof token !== "string" || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Turnstile verification returned HTTP ${response.status}`);
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ message: "Request could not be verified." }, { status: 403 });
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Your ballot could not be read." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Your ballot could not be read." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.token !== "string" || body.token.length > 64) {
    return NextResponse.json({ message: "This voting link is invalid." }, { status: 400 });
  }

  let ballot;
  try {
    ballot = await getPublicBallot(body.token);
  } catch (error) {
    console.error("Public ballot lookup failed:", error);
    return NextResponse.json({ message: "Voting is temporarily unavailable." }, { status: 503 });
  }
  if (!ballot) return NextResponse.json({ message: "This voting link is invalid or inactive." }, { status: 404 });
  const now = Date.now();
  if (ballot.status !== "open" || now < Date.parse(ballot.opensAt) || now >= Date.parse(ballot.closesAt)) {
    return NextResponse.json({ message: "Voting is not currently open." }, { status: 409 });
  }
  if (typeof body.honeypot === "string" && body.honeypot.trim()) {
    return NextResponse.json({ message: "Your ballot could not be accepted." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const address = requestAddress(request);
  const { data: rateAllowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
    p_bucket: createRateLimitKey(`vote:${ballot.eventType}:${ballot.eventId}`, address),
    p_limit: ballot.rateLimitPerMinute,
  });
  if (rateError) {
    console.error("Public voting rate limit failed:", rateError.message);
    return NextResponse.json({ message: "Voting is temporarily unavailable." }, { status: 503 });
  }
  if (!rateAllowed) return NextResponse.json({ message: "Too many attempts. Please wait a minute and try again." }, { status: 429 });

  if (ballot.botProtection) {
    try {
      const verified = await verifyTurnstile(body.captchaToken, address);
      if (!verified) return NextResponse.json({ message: "Complete the anti-bot check before voting." }, { status: 400 });
    } catch (error) {
      console.error("Bot-protection verification failed:", error);
      return NextResponse.json({ message: "Bot protection is temporarily unavailable." }, { status: 503 });
    }
  }

  if (ballot.eventType === "poll") {
    if (!Array.isArray(body.answers) || body.answers.length > ballot.questions.length ||
        body.answers.some((answer) => !answer || typeof answer !== "object" || Array.isArray(answer) ||
          typeof (answer as Record<string, unknown>).questionId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test((answer as Record<string, string>).questionId) ||
          !Array.isArray((answer as Record<string, unknown>).optionIds) ||
          ((answer as Record<string, unknown>).optionIds as unknown[]).some((optionId) =>
            typeof optionId !== "string" || !/^[0-9a-f-]{36}$/i.test(optionId)))) {
      return NextResponse.json({ message: "Check your selections and try again." }, { status: 400 });
    }
    const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (ballot.sessionDuplicateProtection && !cookieToken) {
      return NextResponse.json({ message: "Refresh this page to start a voting session." }, { status: 400 });
    }
    const { error } = await supabase.rpc("submit_poll_ballot", {
      p_link_hash: hashToken(body.token),
      p_session_hash: cookieToken ? hashToken(cookieToken) : hashSensitiveValue(`${address}:${crypto.randomUUID()}`),
      p_answers: body.answers as Record<string, unknown>[],
      p_enforce_session: ballot.sessionDuplicateProtection,
    });
    if (error) {
      if (error.message === "ALREADY_VOTED") return NextResponse.json({ message: "This browser session has already voted in this poll." }, { status: 409 });
      if (error.message === "POLL_CLOSED") return NextResponse.json({ message: "This poll is closed." }, { status: 409 });
      if (error.message === "INVALID_LINK") return NextResponse.json({ message: "This voting link is invalid." }, { status: 404 });
      if (error.message === "INVALID_BALLOT") return NextResponse.json({ message: "Check your selections and try again." }, { status: 400 });
      console.error("Poll ballot submission failed:", error.message);
      return NextResponse.json({ message: "Your ballot could not be submitted." }, { status: 503 });
    }
  } else {
    if (!Array.isArray(body.candidateIds) || body.candidateIds.length > 100 ||
        body.candidateIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
      return NextResponse.json({ message: "Check your candidate selections and try again." }, { status: 400 });
    }
    const { error } = await supabase.rpc("submit_election_ballot", {
      p_invitation_hash: hashToken(body.token),
      p_candidate_ids: body.candidateIds as string[],
    });
    if (error) {
      if (error.message === "ALREADY_VOTED") return NextResponse.json({ message: "This invitation has already been used to vote." }, { status: 409 });
      if (error.message === "ELECTION_CLOSED") return NextResponse.json({ message: "This election is closed." }, { status: 409 });
      if (error.message === "INVALID_INVITATION" || error.message === "NOT_ELIGIBLE") return NextResponse.json({ message: "This invitation is invalid or no longer eligible." }, { status: 404 });
      if (error.message === "INVALID_BALLOT") return NextResponse.json({ message: "Check the required selections for each position." }, { status: 400 });
      console.error("Election ballot submission failed:", error.message);
      return NextResponse.json({ message: "Your ballot could not be submitted." }, { status: 503 });
    }
  }

  return NextResponse.json({ success: true });
}
