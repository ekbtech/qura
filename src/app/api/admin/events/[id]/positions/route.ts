import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

async function ensureDraftElection(electionId: string) {
  const supabase = createAdminSupabase();
  const { data: election, error } = await supabase.from("elections").select("status")
    .eq("id", electionId).maybeSingle();
  if (error) return { supabase, status: null, error: "Could not load election." };
  if (!election) return { supabase, status: null, error: "Election not found." };
  if (election.status !== "draft") return { supabase, status: election.status, error: "Positions can only be changed before voting begins." };
  return { supabase, status: election.status, error: null };
}

export async function POST(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  const { supabase, error: electionError } = await ensureDraftElection(id);
  if (electionError) return NextResponse.json({ message: electionError }, { status: electionError === "Election not found." ? 404 : 409 });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ message: "Provide a position title." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ message: "Provide a position title." }, { status: 400 });
  const body = parsed as Record<string, unknown>;
  if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.length > 120) {
    return NextResponse.json({ message: "Enter a valid position title." }, { status: 400 });
  }
  const minSelections = body.minSelections === undefined ? 1 : body.minSelections;
  const maxSelections = body.maxSelections === undefined ? 1 : body.maxSelections;
  if (typeof minSelections !== "number" || !Number.isInteger(minSelections) || minSelections < 0 || minSelections > 10 ||
      typeof maxSelections !== "number" || !Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > 10 ||
      minSelections > maxSelections) {
    return NextResponse.json({ message: "Set valid selection rules; minimum selections cannot exceed the maximum." }, { status: 400 });
  }
  const { data: lastPosition, error: listError } = await supabase.from("election_positions").select("position")
    .eq("election_id", id).order("position", { ascending: false }).limit(1).maybeSingle();
  if (listError) return NextResponse.json({ message: "Could not load election positions." }, { status: 503 });
  const { data, error } = await supabase.from("election_positions").insert({
    election_id: id,
    title: body.title.trim(),
    min_selections: minSelections,
    max_selections: maxSelections,
    position: (lastPosition?.position ?? -1) + 1,
  }).select("id").single();
  if (error) return NextResponse.json({ message: "Could not add election position." }, { status: 503 });
  await writeAuditLog(admin.id, "election.position.created", "election", id, { positionId: data.id });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function PATCH(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  const { supabase, error: electionError } = await ensureDraftElection(id);
  if (electionError) return NextResponse.json({ message: electionError }, { status: electionError === "Election not found." ? 404 : 409 });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ message: "Provide position details." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ message: "Provide position details." }, { status: 400 });
  const body = parsed as Record<string, unknown>;
  if (typeof body.positionId !== "string") return NextResponse.json({ message: "Select an election position." }, { status: 400 });
  const { data: position, error: lookupError } = await supabase.from("election_positions")
    .select("id").eq("id", body.positionId).eq("election_id", id).maybeSingle();
  if (lookupError) return NextResponse.json({ message: "Could not load election position." }, { status: 503 });
  if (!position) return NextResponse.json({ message: "Position not found." }, { status: 404 });
  const updates: { title?: string; min_selections?: number; max_selections?: number } = {};
  if (typeof body.title === "string" && body.title.trim().length >= 2 && body.title.length <= 120) updates.title = body.title.trim();
  if (typeof body.minSelections === "number" && Number.isInteger(body.minSelections) && body.minSelections >= 0 && body.minSelections <= 10) updates.min_selections = body.minSelections;
  if (typeof body.maxSelections === "number" && Number.isInteger(body.maxSelections) && body.maxSelections >= 1 && body.maxSelections <= 10) updates.max_selections = body.maxSelections;
  if (!Object.keys(updates).length) return NextResponse.json({ message: "Provide valid position changes." }, { status: 400 });
  const { data: current, error: currentError } = await supabase.from("election_positions").select("min_selections,max_selections")
    .eq("id", position.id).single();
  if (currentError || !current) return NextResponse.json({ message: "Could not load election position settings." }, { status: 503 });
  const min = updates.min_selections ?? current.min_selections;
  const max = updates.max_selections ?? current.max_selections;
  if (min > max) return NextResponse.json({ message: "Minimum selections cannot exceed maximum selections." }, { status: 400 });
  const { error } = await supabase.from("election_positions").update(updates).eq("id", position.id);
  if (error) return NextResponse.json({ message: "Could not update election position." }, { status: 503 });
  await writeAuditLog(admin.id, "election.position.updated", "election", id, { positionId: position.id });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  const { supabase, error: electionError } = await ensureDraftElection(id);
  if (electionError) return NextResponse.json({ message: electionError }, { status: electionError === "Election not found." ? 404 : 409 });
  const positionId = new URL(request.url).searchParams.get("positionId");
  if (!positionId) return NextResponse.json({ message: "Select an election position." }, { status: 400 });
  const { data: position } = await supabase.from("election_positions").select("id")
    .eq("id", positionId).eq("election_id", id).maybeSingle();
  if (!position) return NextResponse.json({ message: "Position not found." }, { status: 404 });
  const { error } = await supabase.from("election_positions").delete().eq("id", position.id);
  if (error) return NextResponse.json({ message: "Could not remove election position. Remove its contestants first." }, { status: 409 });
  await writeAuditLog(admin.id, "election.position.deleted", "election", id, { positionId });
  return NextResponse.json({ success: true });
}
