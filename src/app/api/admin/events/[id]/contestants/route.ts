import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide contestant details." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide contestant details." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.positionId !== "string" || typeof body.name !== "string" ||
      body.name.trim().length < 2 || body.name.length > 120 ||
      typeof body.grade !== "string" || body.grade.length > 80 ||
      typeof body.statement !== "string" || body.statement.length > 2000 ||
      (body.mediaFileId !== null && body.mediaFileId !== undefined && typeof body.mediaFileId !== "string")) {
    return NextResponse.json({ message: "Check the contestant’s name, position, grade, and statement." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  const { data: election, error: electionError } = await supabase.from("elections").select("status").eq("id", electionId).maybeSingle();
  if (electionError) return NextResponse.json({ message: "Could not load election." }, { status: 503 });
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Contestants can only be changed before voting begins." }, { status: 409 });
  }
  const { data: position, error: positionError } = await supabase.from("election_positions")
    .select("id").eq("id", body.positionId).eq("election_id", electionId).maybeSingle();
  if (positionError) return NextResponse.json({ message: "Could not check election position." }, { status: 503 });
  if (!position) return NextResponse.json({ message: "Select a position in this election." }, { status: 400 });
  const { data: candidate, error } = await supabase.from("candidates").insert({
    position_id: position.id,
    name: body.name.trim(),
    grade: body.grade.trim(),
    statement: body.statement.trim(),
    media_file_id: typeof body.mediaFileId === "string" ? body.mediaFileId : null,
  }).select("id").single();
  if (error) {
    console.error("Contestant creation failed:", error.message);
    return NextResponse.json({ message: "Could not add contestant." }, { status: 503 });
  }
  await writeAuditLog(admin.id, "candidate.created", "election", electionId, { candidateId: candidate.id });
  return NextResponse.json({ id: candidate.id }, { status: 201 });
}

export async function PATCH(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide contestant changes." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide contestant changes." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.candidateId !== "string") return NextResponse.json({ message: "Select a contestant." }, { status: 400 });
  const supabase = createAdminSupabase();
  const { data: election } = await supabase.from("elections").select("status").eq("id", electionId).maybeSingle();
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Contestants can only be changed before voting begins." }, { status: 409 });
  }
  const { data: existing, error: existingError } = await supabase.from("candidates")
    .select("id, position_id").eq("id", body.candidateId).maybeSingle();
  if (existingError) return NextResponse.json({ message: "Could not load contestant." }, { status: 503 });
  if (!existing) return NextResponse.json({ message: "Contestant not found." }, { status: 404 });
  const { data: existingPosition, error: existingPositionError } = await supabase.from("election_positions")
    .select("election_id").eq("id", existing.position_id).maybeSingle();
  if (existingPositionError) return NextResponse.json({ message: "Could not check contestant position." }, { status: 503 });
  if (existingPosition?.election_id !== electionId) {
    return NextResponse.json({ message: "Contestant does not belong to this election." }, { status: 400 });
  }
  const updates: {
    name?: string;
    grade?: string;
    statement?: string;
    position_id?: string;
    media_file_id?: string | null;
  } = {};
  if (typeof body.name === "string" && body.name.trim().length >= 2 && body.name.length <= 120) updates.name = body.name.trim();
  if (typeof body.grade === "string" && body.grade.length <= 80) updates.grade = body.grade.trim();
  if (typeof body.statement === "string" && body.statement.length <= 2000) updates.statement = body.statement.trim();
  if (typeof body.positionId === "string") {
    const { data: position } = await supabase.from("election_positions").select("id")
      .eq("id", body.positionId).eq("election_id", electionId).maybeSingle();
    if (!position) return NextResponse.json({ message: "Select a position in this election." }, { status: 400 });
    updates.position_id = position.id;
  }
  if (typeof body.mediaFileId === "string" || body.mediaFileId === null) updates.media_file_id = body.mediaFileId;
  if (!Object.keys(updates).length) return NextResponse.json({ message: "No valid contestant changes provided." }, { status: 400 });
  const { error } = await supabase.from("candidates").update(updates).eq("id", existing.id);
  if (error) return NextResponse.json({ message: "Could not update contestant." }, { status: 503 });
  await writeAuditLog(admin.id, "candidate.updated", "election", electionId, { candidateId: existing.id });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: electionId } = await context.params;
  const candidateId = new URL(request.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ message: "Select a contestant." }, { status: 400 });
  const supabase = createAdminSupabase();
  const { data: election } = await supabase.from("elections").select("status").eq("id", electionId).maybeSingle();
  if (!election || election.status !== "draft") {
    return NextResponse.json({ message: "Contestants can only be removed before voting begins." }, { status: 409 });
  }
  const { data: candidate } = await supabase.from("candidates").select("id, position_id").eq("id", candidateId).maybeSingle();
  if (!candidate) return NextResponse.json({ message: "Contestant not found." }, { status: 404 });
  const { data: position } = await supabase.from("election_positions").select("election_id").eq("id", candidate.position_id).maybeSingle();
  if (position?.election_id !== electionId) return NextResponse.json({ message: "Contestant does not belong to this election." }, { status: 400 });
  const { error } = await supabase.from("candidates").delete().eq("id", candidate.id);
  if (error) return NextResponse.json({ message: "Contestant could not be removed." }, { status: 409 });
  await writeAuditLog(admin.id, "candidate.deleted", "election", electionId, { candidateId });
  return NextResponse.json({ success: true });
}
