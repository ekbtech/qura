import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { insertEligibleVoters, validateVoters } from "@/lib/voter-eligibility";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

function validSyncKey(request: Request): boolean {
  const expectedKey = process.env.QURA_STUDENT_SYNC_KEY;
  if (!expectedKey || Buffer.byteLength(expectedKey, "utf8") < 32) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const suppliedKey = match?.[1] ?? "";
  const expectedHash = createHash("sha256").update(expectedKey, "utf8").digest();
  const suppliedHash = createHash("sha256").update(suppliedKey, "utf8").digest();
  return timingSafeEqual(expectedHash, suppliedHash) && Boolean(match);
}

export async function POST(request: Request, context: Context) {
  if (!process.env.QURA_STUDENT_SYNC_KEY ||
      Buffer.byteLength(process.env.QURA_STUDENT_SYNC_KEY, "utf8") < 32) {
    console.error("Student sync is unavailable: QURA_STUDENT_SYNC_KEY must contain at least 32 bytes.");
    return NextResponse.json({ message: "Student sync is not configured." }, { status: 503 });
  }
  if (!validSyncKey(request)) {
    return NextResponse.json({ message: "Valid bearer token required." }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ message: "Send voters as a JSON request." }, { status: 415 });
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ message: "Could not read the voter data." }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf8") > 2_000_000) {
    return NextResponse.json({ message: "Voter data must be smaller than 2 MB." }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ message: "Provide valid JSON voter data." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide a registration number and email." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const validated = validateVoters(Array.isArray(body.voters) ? body.voters : [{
    registrationNumber: body.registrationNumber,
    email: body.email,
  }]);
  if (!validated.voters) {
    return NextResponse.json({ message: validated.message }, { status: 400 });
  }

  const { id: electionId } = await context.params;
  const supabase = createAdminSupabase();
  const { data: election, error: electionError } = await supabase.from("elections")
    .select("status")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    console.error("Student sync election lookup failed:", electionError.message);
    return NextResponse.json({ message: "Could not load election." }, { status: 503 });
  }
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Voters can only be synced to an existing draft election." }, { status: 409 });
  }

  const result = await insertEligibleVoters(supabase, electionId, validated.voters);
  if (!result.eligibility) {
    return NextResponse.json({ message: result.message }, { status: result.status ?? 503 });
  }

  const count = result.eligibility.length;
  const { error: auditError } = await supabase.from("audit_logs").insert({
    admin_id: null,
    action: "election.eligibility.synced",
    event_type: "election",
    event_id: electionId,
    details: { count },
  });
  const response: { success: true; imported: number; warning?: string } = {
    success: true,
    imported: count,
  };
  if (auditError) {
    console.error("Student sync audit log failed:", auditError.message);
    response.warning = "Voters were imported, but the audit log could not be recorded.";
  }
  return NextResponse.json(response, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
