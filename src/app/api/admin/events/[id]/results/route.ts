import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isEventType, writeAuditLog } from "@/lib/admin-api";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const admin = await getAdminIdentity();
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  const type = new URL(request.url).searchParams.get("type");
  if (!isEventType(type)) return NextResponse.json({ message: "Select a valid event type." }, { status: 400 });

  const supabase = createAdminSupabase();
  const table = type === "poll" ? "polls" : "elections";
  const { data: event, error: eventError } = await supabase.from(table)
    .select("id, title, status, results_public").eq("id", id).maybeSingle();
  if (eventError) return NextResponse.json({ message: "Could not load event results." }, { status: 503 });
  if (!event) return NextResponse.json({ message: "Event not found." }, { status: 404 });

  const { data: ballots, error: ballotError } = await supabase.from("ballots")
    .select("id").eq("event_type", type).eq("event_id", id);
  if (ballotError) return NextResponse.json({ message: "Could not count ballots." }, { status: 503 });
  const ballotIds = ballots.map((ballot) => ballot.id);
  const { data: participation, error: participationError } = await supabase.from("voter_participation")
    .select("id").eq("event_type", type).eq("event_id", id);
  if (participationError) return NextResponse.json({ message: "Could not count participants." }, { status: 503 });

  let rows: { category: string; label: string; count: number }[] = [];
  if (type === "poll") {
    const { data: questions, error } = await supabase.from("poll_questions").select("id, prompt").eq("poll_id", id).order("position");
    if (error) return NextResponse.json({ message: "Could not load poll questions." }, { status: 503 });
    const { data: options, error: optionsError } = questions.length
      ? await supabase.from("poll_options").select("id, question_id, label").in("question_id", questions.map((question) => question.id)).order("position")
      : { data: [], error: null };
    if (optionsError) return NextResponse.json({ message: "Could not load poll options." }, { status: 503 });
    const { data: selections, error: selectionError } = ballotIds.length
      ? await supabase.from("ballot_selections").select("poll_question_id, poll_option_id").in("ballot_id", ballotIds)
      : { data: [], error: null };
    if (selectionError) return NextResponse.json({ message: "Could not count poll choices." }, { status: 503 });
    rows = questions.flatMap((question) => options.filter((option) => option.question_id === question.id).map((option) => ({
      category: question.prompt,
      label: option.label,
      count: selections.filter((selection) => selection.poll_option_id === option.id).length,
    })));
  } else {
    const { data: positions, error } = await supabase.from("election_positions")
      .select("id, title").eq("election_id", id).order("position");
    if (error) return NextResponse.json({ message: "Could not load election positions." }, { status: 503 });
    const { data: candidates, error: candidatesError } = positions.length
      ? await supabase.from("candidates").select("id, position_id, name").in("position_id", positions.map((position) => position.id))
      : { data: [], error: null };
    if (candidatesError) return NextResponse.json({ message: "Could not load election candidates." }, { status: 503 });
    const { data: selections, error: selectionError } = ballotIds.length
      ? await supabase.from("ballot_selections").select("candidate_id").in("ballot_id", ballotIds)
      : { data: [], error: null };
    if (selectionError) return NextResponse.json({ message: "Could not count votes." }, { status: 503 });
    rows = positions.flatMap((position) => candidates.filter((candidate) => candidate.position_id === position.id).map((candidate) => ({
      category: position.title,
      label: candidate.name,
      count: selections.filter((selection) => selection.candidate_id === candidate.id).length,
    })));
  }

  const responseData = {
    event: { id: event.id, title: event.title, status: event.status, resultsPublic: event.results_public },
    ballots: ballotIds.length,
    participation: participation.length,
    results: rows,
  };
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const reportType = "results-csv";
    const { error: reportError } = await supabase.from("reports").insert({
      admin_id: admin.id,
      event_type: type,
      event_id: id,
      report_type: reportType,
    });
    if (reportError) return NextResponse.json({ message: "Could not record report export." }, { status: 503 });
    await writeAuditLog(admin.id, "report.exported", type, id, { reportType });
    const fields = [
      ["Event", event.title],
      ["Submitted ballots", String(ballotIds.length)],
      ["Recorded participation", String(participation.length)],
      ...rows.map((row) => [`${row.category}: ${row.label}`, String(row.count)]),
    ];
    const csv = fields.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="qura-results-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(responseData, { headers: { "Cache-Control": "no-store" } });
}
