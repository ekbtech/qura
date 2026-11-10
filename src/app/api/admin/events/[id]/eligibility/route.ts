import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { getAdminIdentity } from "@/lib/admin-session";
import { insertEligibleVoters, validateVoters, type VoterInput } from "@/lib/voter-eligibility";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const admin = await getAdminIdentity();
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(electionId)) {
    return NextResponse.json({ message: "Election not found." }, { status: 404 });
  }
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = 50;
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    return NextResponse.json({ message: "Invalid voter page." }, { status: 400 });
  }
  const supabase = createAdminSupabase();
  const { data: election, error: electionError } = await supabase.from("elections")
    .select("id,title")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    console.error("Voter list election lookup failed:", electionError.message);
    return NextResponse.json({ message: "Could not load voters." }, { status: 503 });
  }
  if (!election) return NextResponse.json({ message: "Election not found." }, { status: 404 });

  const { data: voters, count, error } = await supabase.from("voter_eligibility")
    .select("id,email,is_active,created_at", { count: "exact" })
    .eq("election_id", electionId)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) {
    console.error("Eligible voter list query failed:", error.message);
    return NextResponse.json({ message: "Could not load voters." }, { status: 503 });
  }
  return NextResponse.json({
    election,
    voters,
    total: count ?? 0,
    page,
    pageSize,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  const supabase = createAdminSupabase();
  const { data: election, error: electionError } = await supabase.from("elections").select("status").eq("id", electionId).maybeSingle();
  if (electionError) {
    console.error("Eligibility election lookup failed:", electionError.message);
    return NextResponse.json({ message: "Could not load election." }, { status: 503 });
  }
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Eligibility can only be imported before voting begins." }, { status: 409 });
  }

  let voters: VoterInput[];
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ message: "Choose an eligibility CSV smaller than 2 MB." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 2_000_000) {
      return NextResponse.json({ message: "Choose an eligibility CSV smaller than 2 MB." }, { status: 400 });
    }
    const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2 || lines.length > 5001 || lines[0].trim().toLowerCase() !== "voter_id,email") {
      return NextResponse.json({ message: "CSV must have a voter_id,email header and contain 1–5000 voters." }, { status: 400 });
    }
    const parsedVoters: VoterInput[] = [];
    for (const [index, line] of lines.slice(1).entries()) {
      const fields = line.split(",");
      if (fields.length !== 2) return NextResponse.json({ message: `CSV row ${index + 2} must contain voter_id,email without quoted commas.` }, { status: 400 });
      parsedVoters.push({ registrationNumber: fields[0], email: fields[1] });
    }
    const validated = validateVoters(parsedVoters);
    if (!validated.voters) return NextResponse.json({ message: validated.message }, { status: 400 });
    voters = validated.voters;
  } else {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json({ message: "Provide a registration number and email." }, { status: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ message: "Provide a registration number and email." }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;
    const validated = validateVoters(Array.isArray(body.voters) ? body.voters : [{
      registrationNumber: body.registrationNumber,
      email: body.email,
    }]);
    if (!validated.voters) return NextResponse.json({ message: validated.message }, { status: 400 });
    voters = validated.voters;
  }

  const result = await insertEligibleVoters(supabase, electionId, voters);
  if (!result.eligibility) {
    return NextResponse.json({ message: result.message }, { status: result.status ?? 503 });
  }

  const action = request.headers.get("content-type")?.includes("multipart/form-data")
      ? "election.eligibility.imported"
      : "election.eligibility.added";
  await writeAuditLog(admin.id, action, "election", electionId, { count: result.eligibility.length });
  return NextResponse.json({ success: true, imported: result.eligibility.length, added: result.eligibility.length }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
