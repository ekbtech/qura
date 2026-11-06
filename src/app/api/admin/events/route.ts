import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { getAdminIdentity } from "@/lib/admin-session";
import { createAdminSupabase } from "@/lib/supabase/admin";

function validDateRange(opensAt: unknown, closesAt: unknown): opensAt is string {
  return typeof opensAt === "string" && typeof closesAt === "string" &&
    Number.isFinite(Date.parse(opensAt)) && Number.isFinite(Date.parse(closesAt)) &&
    Date.parse(closesAt) > Date.parse(opensAt);
}

export async function GET() {
  const admin = await getAdminIdentity();
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });

  const supabase = createAdminSupabase();
  const [polls, elections, audit] = await Promise.all([
    supabase.from("polls").select("*").order("created_at", { ascending: false }),
    supabase.from("elections").select("*").order("created_at", { ascending: false }),
    supabase.from("audit_logs").select("id, action, event_type, event_id, details, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  if (polls.error || elections.error || audit.error) {
    console.error("Administrator dashboard query failed:", polls.error?.message, elections.error?.message, audit.error?.message);
    return NextResponse.json({ message: "Could not load the management dashboard." }, { status: 503 });
  }

  const pollIds = polls.data.map((poll) => poll.id);
  const electionIds = elections.data.map((election) => election.id);
  const [questions, links, positions, eligibility, ballots, participation] = await Promise.all([
    pollIds.length ? supabase.from("poll_questions").select("*").in("poll_id", pollIds).order("position") : Promise.resolve({ data: [], error: null }),
    pollIds.length ? supabase.from("voting_links").select("id, poll_id, is_active, created_at").in("poll_id", pollIds) : Promise.resolve({ data: [], error: null }),
    electionIds.length ? supabase.from("election_positions").select("*").in("election_id", electionIds).order("position") : Promise.resolve({ data: [], error: null }),
    electionIds.length ? supabase.from("voter_eligibility").select("election_id, is_active").in("election_id", electionIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("ballots").select("event_type, event_id"),
    supabase.from("voter_participation").select("event_type, event_id"),
  ]);
  if (questions.error || links.error || positions.error || eligibility.error || ballots.error || participation.error) {
    console.error("Dashboard detail query failed:", questions.error?.message, links.error?.message, positions.error?.message, eligibility.error?.message, ballots.error?.message, participation.error?.message);
    return NextResponse.json({ message: "Could not load event details." }, { status: 503 });
  }

  const questionIds = questions.data.map((question) => question.id);
  const positionIds = positions.data.map((position) => position.id);
  const [options, candidates] = await Promise.all([
    questionIds.length ? supabase.from("poll_options").select("*").in("question_id", questionIds).order("position") : Promise.resolve({ data: [], error: null }),
    positionIds.length ? supabase.from("candidates").select("id, position_id, name, grade, statement, media_file_id").in("position_id", positionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (options.error || candidates.error) {
    console.error("Dashboard ballot data query failed:", options.error?.message, candidates.error?.message);
    return NextResponse.json({ message: "Could not load event ballot details." }, { status: 503 });
  }
  const mediaIds = candidates.data.flatMap((candidate) => candidate.media_file_id ? [candidate.media_file_id] : []);
  const media = mediaIds.length
    ? await supabase.from("media_files").select("id, storage_key").in("id", mediaIds)
    : { data: [], error: null };
  if (media.error) {
    console.error("Contestant photo query failed:", media.error.message);
    return NextResponse.json({ message: "Could not load contestant photographs." }, { status: 503 });
  }
  const { data: publicUrlData } = supabase.storage.from("qura-contestants").getPublicUrl("");

  return NextResponse.json({
    polls: polls.data.map((poll) => ({
      ...poll,
      questions: questions.data.filter((question) => question.poll_id === poll.id).map((question) => ({
        ...question,
        options: options.data.filter((option) => option.question_id === question.id),
      })),
      linkActive: links.data.some((link) => link.poll_id === poll.id && link.is_active),
      ballotCount: ballots.data.filter((ballot) => ballot.event_type === "poll" && ballot.event_id === poll.id).length,
    })),
    elections: elections.data.map((election) => ({
      ...election,
      eligibleCount: eligibility.data.filter((item) => item.election_id === election.id && item.is_active).length,
      participationCount: participation.data.filter((item) => item.event_type === "election" && item.event_id === election.id).length,
      ballotCount: ballots.data.filter((ballot) => ballot.event_type === "election" && ballot.event_id === election.id).length,
      positions: positions.data.filter((position) => position.election_id === election.id).map((position) => ({
        ...position,
        candidates: candidates.data.filter((candidate) => candidate.position_id === position.id).map((candidate) => ({
          ...candidate,
          photoUrl: candidate.media_file_id
            ? `${publicUrlData.publicUrl}${media.data.find((item) => item.id === candidate.media_file_id)?.storage_key ?? ""}`
            : null,
        })),
      })),
    })),
    audit: audit.data,
  });
}

export async function POST(request: Request) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide event details and try again." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide event details and try again." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  const type = body.type;
  if ((type !== "poll" && type !== "election") ||
      typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160 ||
      typeof body.description !== "string" || body.description.length > 2000 ||
      !validDateRange(body.opensAt, body.closesAt)) {
    return NextResponse.json({ message: "Check the event title, description, and opening and closing times." }, { status: 400 });
  }
  if (type === "poll" && (typeof body.prompt !== "string" || body.prompt.trim().length < 2 ||
      !Array.isArray(body.options) || body.options.length < 2 ||
      body.options.length > 20 || body.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 120))) {
    return NextResponse.json({ message: "A poll needs a question and at least two answer options." }, { status: 400 });
  }
  if (type === "poll" && body.maxSelections !== undefined &&
      (!Number.isInteger(body.maxSelections) || (body.maxSelections as number) < 1 || (body.maxSelections as number) > (body.options as string[]).length)) {
    return NextResponse.json({ message: "Maximum selections must be between 1 and the number of answer options." }, { status: 400 });
  }
  if (type === "election" && (!Array.isArray(body.positions) || body.positions.length === 0 ||
      body.positions.length > 20 || body.positions.some((position) => typeof position !== "string" || !position.trim() || position.length > 120))) {
    return NextResponse.json({ message: "An election needs at least one position." }, { status: 400 });
  }
  if (type === "election" && body.maxSelectionsPerPosition !== undefined &&
      (!Number.isInteger(body.maxSelectionsPerPosition) || (body.maxSelectionsPerPosition as number) < 1 || (body.maxSelectionsPerPosition as number) > 10)) {
    return NextResponse.json({ message: "Maximum selections per position must be between 1 and 10." }, { status: 400 });
  }

  const supabase = createAdminSupabase();
  if (type === "poll") {
    const { data: poll, error } = await supabase.from("polls").insert({
      title: body.title.trim(),
      description: body.description.trim(),
      opens_at: new Date(body.opensAt as string).toISOString(),
      closes_at: new Date(body.closesAt as string).toISOString(),
      status: "draft",
      results_public: false,
      secret_ballots: body.secretBallots !== false,
      session_duplicate_protection: body.sessionDuplicateProtection !== false,
      rate_limit_per_minute: typeof body.rateLimitPerMinute === "number" ? Math.max(1, Math.min(120, Math.floor(body.rateLimitPerMinute))) : 10,
      bot_protection: body.botProtection === true,
      created_by: admin.id,
    }).select("id").single();
    if (error) return NextResponse.json({ message: `Could not create poll: ${error.message}` }, { status: 503 });
    const { data: question, error: questionError } = await supabase.from("poll_questions").insert({
      poll_id: poll.id,
      prompt: (body.prompt as string).trim(),
      min_selections: 1,
      max_selections: typeof body.maxSelections === "number" ? body.maxSelections : 1,
      position: 0,
    }).select("id").single();
    if (questionError) {
      await supabase.from("polls").delete().eq("id", poll.id);
      return NextResponse.json({ message: `Could not create poll question: ${questionError.message}` }, { status: 503 });
    }
    const { error: optionsError } = await supabase.from("poll_options").insert((body.options as string[]).map((label, position) => ({
      question_id: question.id,
      label: label.trim(),
      position,
    })));
    if (optionsError) {
      await supabase.from("polls").delete().eq("id", poll.id);
      return NextResponse.json({ message: `Could not create poll options: ${optionsError.message}` }, { status: 503 });
    }
    await writeAuditLog(admin.id, "poll.created", "poll", poll.id);
    return NextResponse.json({ id: poll.id }, { status: 201 });
  }

  const { data: election, error } = await supabase.from("elections").insert({
    title: body.title.trim(),
    description: body.description.trim(),
    opens_at: new Date(body.opensAt as string).toISOString(),
    closes_at: new Date(body.closesAt as string).toISOString(),
    status: "draft",
    results_public: false,
    secret_ballots: body.secretBallots !== false,
    created_by: admin.id,
  }).select("id").single();
  if (error) return NextResponse.json({ message: `Could not create election: ${error.message}` }, { status: 503 });
  const { error: positionsError } = await supabase.from("election_positions").insert((body.positions as string[]).map((title, position) => ({
    election_id: election.id,
    title: title.trim(),
    min_selections: 1,
    max_selections: typeof body.maxSelectionsPerPosition === "number" ? body.maxSelectionsPerPosition : 1,
    position,
  })));
  if (positionsError) {
    await supabase.from("elections").delete().eq("id", election.id);
    return NextResponse.json({ message: `Could not create election positions: ${positionsError.message}` }, { status: 503 });
  }
  await writeAuditLog(admin.id, "election.created", "election", election.id);
  return NextResponse.json({ id: election.id }, { status: 201 });
}
