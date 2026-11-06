import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getPublicBallot } from "@/lib/public-ballot";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  const event = await getPublicBallot(token);
  if (!event) return NextResponse.json({ message: "Voting link not found." }, { status: 404 });
  if (!event.resultsPublic || event.status === "open" || event.status === "draft") {
    return NextResponse.json({ message: "Results have not been published." }, { status: 403 });
  }
  const supabase = createAdminSupabase();
  const { data: ballots, error: ballotError } = await supabase.from("ballots")
    .select("id").eq("event_type", event.eventType).eq("event_id", event.eventId);
  if (ballotError) return NextResponse.json({ message: "Results are temporarily unavailable." }, { status: 503 });
  const ids = ballots.map((ballot) => ballot.id);
  const { data: selections, error } = ids.length
    ? await supabase.from("ballot_selections").select("poll_option_id, candidate_id").in("ballot_id", ids)
    : { data: [], error: null };
  if (error) return NextResponse.json({ message: "Results are temporarily unavailable." }, { status: 503 });

  const results = event.eventType === "poll"
    ? event.questions.flatMap((question) => question.options.map((option) => ({
      category: question.prompt,
      label: option.label,
      count: selections.filter((selection) => selection.poll_option_id === option.id).length,
    })))
    : event.positions.flatMap((position) => position.candidates.map((candidate) => ({
      category: position.title,
      label: candidate.name,
      count: selections.filter((selection) => selection.candidate_id === candidate.id).length,
    })));

  return NextResponse.json({ title: event.title, ballots: ids.length, results });
}
