import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createOpaqueToken, hashSensitiveValue, hashToken } from "@/lib/qura-security";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 2_000_000) {
    return NextResponse.json({ message: "Choose an eligibility CSV smaller than 2 MB." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: election } = await supabase.from("elections").select("status").eq("id", electionId).maybeSingle();
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Eligibility can only be imported before voting begins." }, { status: 409 });
  }

  const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || lines.length > 5001 || lines[0].trim().toLowerCase() !== "voter_id,email") {
    return NextResponse.json({ message: "CSV must have a voter_id,email header and contain 1–5000 voters." }, { status: 400 });
  }

  const entries: { voter_ref_hash: string; email: string; voter_code: string }[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const fields = line.split(",");
    if (fields.length !== 2) return NextResponse.json({ message: `CSV row ${index + 2} must contain voter_id,email without quoted commas.` }, { status: 400 });
    const voterId = fields[0].trim();
    const email = fields[1].trim().toLowerCase();
    if (voterId.length < 2 || voterId.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ message: `Invalid voter ID or email on CSV row ${index + 2}.` }, { status: 400 });
    }
    const voterRefHash = hashSensitiveValue(voterId);
    if (seen.has(voterRefHash)) return NextResponse.json({ message: `Duplicate voter ID on CSV row ${index + 2}.` }, { status: 400 });
    seen.add(voterRefHash);
    entries.push({ voter_ref_hash: voterRefHash, email, voter_code: voterId });
  }

  const { data: eligibility, error } = await supabase.from("voter_eligibility")
    .insert(entries.map((entry) => ({
      election_id: electionId,
      voter_ref_hash: entry.voter_ref_hash,
      email: entry.email,
    })))
    .select("id, email, voter_ref_hash");
  if (error) {
    console.error("Voter eligibility import failed:", error.message);
    return NextResponse.json({ message: "Eligibility import failed. Check for duplicate voters already imported." }, { status: 409 });
  }

  const voterRecords = new Map(entries.map((entry) => [entry.voter_ref_hash, entry]));
  const invitations: { entry: (typeof eligibility)[number]; token: string; email: string; voterCode: string }[] = [];
  for (const entry of eligibility) {
    const voterRecord = voterRecords.get(entry.voter_ref_hash);
    if (!voterRecord) {
      await supabase.from("voter_eligibility").delete().eq("election_id", electionId)
        .in("id", eligibility.map((item) => item.id));
      return NextResponse.json({ message: "Could not match invitation codes to eligible voters." }, { status: 503 });
    }
    invitations.push({
      entry,
      token: createOpaqueToken(),
      email: voterRecord.email,
      voterCode: voterRecord.voter_code,
    });
  }
  const { error: invitationError } = await supabase.from("invitation_tokens").insert(invitations.map(({ entry, token }) => ({
    eligibility_id: entry.id,
    election_id: electionId,
    token_hash: hashToken(token),
  })));
  if (invitationError) {
    await supabase.from("voter_eligibility").delete().eq("election_id", electionId)
      .in("id", eligibility.map((entry) => entry.id));
    console.error("Invitation generation failed:", invitationError.message);
    return NextResponse.json({ message: "Could not generate invitation links." }, { status: 503 });
  }

  await writeAuditLog(admin.id, "election.eligibility.imported", "election", electionId, { count: eligibility.length });
  const baseUrl = new URL(request.url).origin;
  const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [
    "email,voter_code,voting_link",
    ...invitations.map(({ token, email, voterCode }) =>
      `${csvCell(email)},${csvCell(voterCode)},${csvCell(`${baseUrl}/vote/${token}`)}`),
  ].join("\r\n");
  return new Response(csv, {
    status: 201,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="election-invitations-${electionId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
