import { NextResponse } from "next/server";
import { authorizeAdminMutation, isEventType, writeAuditLog } from "@/lib/admin-api";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };
type EventStatus = "draft" | "open" | "closed" | "cancelled";

function isEventStatus(value: unknown): value is EventStatus {
  return value === "draft" || value === "open" || value === "closed" || value === "cancelled";
}

export async function PATCH(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide event changes and try again." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide event changes and try again." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (!isEventType(body.type)) return NextResponse.json({ message: "Select a valid event type." }, { status: 400 });
  const supabase = createAdminSupabase();
  const table = body.type === "poll" ? "polls" : "elections";
  const { data: current, error: currentError } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (currentError) return NextResponse.json({ message: "Could not load event." }, { status: 503 });
  if (!current) return NextResponse.json({ message: "Event not found." }, { status: 404 });

  const updates: {
    updated_at: string;
    status?: EventStatus;
    results_public?: boolean;
    title?: string;
    description?: string;
    opens_at?: string;
    closes_at?: string;
  } = { updated_at: new Date().toISOString() };
  const pollUpdates: {
    session_duplicate_protection?: boolean;
    rate_limit_per_minute?: number;
    bot_protection?: boolean;
  } = {};
  if ("status" in body) {
    if (!isEventStatus(body.status)) {
      return NextResponse.json({ message: "Invalid event status." }, { status: 400 });
    }
    const allowedTransitions: Record<string, string[]> = {
      draft: ["open", "cancelled"],
      open: ["closed", "cancelled"],
      closed: [],
      cancelled: [],
    };
    if (body.status !== current.status && !allowedTransitions[current.status].includes(String(body.status))) {
      return NextResponse.json({ message: "This event cannot be moved to that status." }, { status: 409 });
    }
    if (body.status === "open" && current.status !== "open") {
      if (body.type === "election") {
        const { data: positions, error: positionError } = await supabase.from("election_positions")
          .select("id,min_selections").eq("election_id", id);
        const { count: eligibleCount, error: eligibilityError } = await supabase.from("voter_eligibility")
          .select("id", { count: "exact", head: true }).eq("election_id", id).eq("is_active", true);
        const { count: invitationCount, error: invitationError } = await supabase.from("invitation_tokens")
          .select("id", { count: "exact", head: true }).eq("election_id", id).is("revoked_at", null);
        if (positionError || eligibilityError || invitationError) {
          return NextResponse.json({ message: "Could not verify election readiness." }, { status: 503 });
        }
        if (!positions.length || !eligibleCount || !invitationCount) {
          return NextResponse.json({ message: "Add election positions and import eligible voters to generate invitations before opening." }, { status: 409 });
        }
        const { data: candidates, error: candidateError } = await supabase.from("candidates")
          .select("position_id").in("position_id", positions.map((position) => position.id));
        if (candidateError) {
          return NextResponse.json({ message: "Could not verify election contestants." }, { status: 503 });
        }
        const candidateCounts = new Map<string, number>();
        for (const candidate of candidates) {
          candidateCounts.set(candidate.position_id, (candidateCounts.get(candidate.position_id) ?? 0) + 1);
        }
        if (positions.some((position) => (candidateCounts.get(position.id) ?? 0) < Math.max(1, position.min_selections))) {
          return NextResponse.json({ message: "Add contestants to every position before opening." }, { status: 409 });
        }
        if (candidates.length < 2) {
          return NextResponse.json({ message: "Add at least two contestants before opening the election." }, { status: 409 });
        }
      } else {
        const { data: questions, error: questionError } = await supabase.from("poll_questions")
          .select("id").eq("poll_id", id);
        if (questionError || !questions.length) {
          return NextResponse.json({ message: "Add a question and answer options before opening the poll." }, { status: 409 });
        }
        for (const question of questions) {
          const { count, error: optionError } = await supabase.from("poll_options")
            .select("id", { count: "exact", head: true }).eq("question_id", question.id);
          if (optionError || (count ?? 0) < 2) {
            return NextResponse.json({ message: "Add at least two answer options to each question before opening." }, { status: 409 });
          }
        }
        const { data: link, error: linkError } = await supabase.from("voting_links")
          .select("id").eq("poll_id", id).eq("is_active", true).is("revoked_at", null).maybeSingle();
        if (linkError || !link) {
          return NextResponse.json({ message: "Generate a public voting link before opening this poll." }, { status: 409 });
        }
      }
    }
    if (body.status === "closed" && current.status === "draft") {
      return NextResponse.json({ message: "A draft event cannot be closed; cancel it instead." }, { status: 409 });
    }
    updates.status = body.status;
  }
  if ("resultsPublic" in body) {
    if (typeof body.resultsPublic !== "boolean") {
      return NextResponse.json({ message: "Invalid results setting." }, { status: 400 });
    }
    if (current.status === "open" && body.resultsPublic) {
      return NextResponse.json({ message: "Results cannot be published while voting is open." }, { status: 409 });
    }
    updates.results_public = body.resultsPublic;
  }
  if ("title" in body) {
    if (current.status !== "draft") {
      return NextResponse.json({ message: "Event details cannot be changed after voting begins." }, { status: 409 });
    }
    if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160) {
      return NextResponse.json({ message: "Enter a valid event title." }, { status: 400 });
    }
    updates.title = body.title.trim();
  }
  if ("description" in body) {
    if (current.status !== "draft") {
      return NextResponse.json({ message: "Event details cannot be changed after voting begins." }, { status: 409 });
    }
    if (typeof body.description !== "string" || body.description.length > 2000) {
      return NextResponse.json({ message: "Enter a valid description." }, { status: 400 });
    }
    updates.description = body.description.trim();
  }
  if ("opensAt" in body || "closesAt" in body) {
    const opensAt = "opensAt" in body ? body.opensAt : current.opens_at;
    const closesAt = "closesAt" in body ? body.closesAt : current.closes_at;
    if (typeof opensAt !== "string" || typeof closesAt !== "string" ||
        !Number.isFinite(Date.parse(opensAt)) || !Number.isFinite(Date.parse(closesAt)) ||
        Date.parse(closesAt) <= Date.parse(opensAt) || current.status === "open") {
      return NextResponse.json({ message: "Only draft events can change valid voting dates." }, { status: 400 });
    }
    updates.opens_at = new Date(opensAt).toISOString();
    updates.closes_at = new Date(closesAt).toISOString();
  }
  if ("sessionDuplicateProtection" in body || "rateLimitPerMinute" in body || "botProtection" in body) {
    if (body.type !== "poll" || current.status !== "draft") {
      return NextResponse.json({ message: "Poll protection settings can only be changed on draft polls." }, { status: 409 });
    }
    if ("sessionDuplicateProtection" in body) {
      if (typeof body.sessionDuplicateProtection !== "boolean") return NextResponse.json({ message: "Invalid session protection setting." }, { status: 400 });
      pollUpdates.session_duplicate_protection = body.sessionDuplicateProtection;
    }
    if ("botProtection" in body) {
      if (typeof body.botProtection !== "boolean") return NextResponse.json({ message: "Invalid bot protection setting." }, { status: 400 });
      pollUpdates.bot_protection = body.botProtection;
    }
    if ("rateLimitPerMinute" in body) {
      if (typeof body.rateLimitPerMinute !== "number" || body.rateLimitPerMinute < 1 || body.rateLimitPerMinute > 120) {
        return NextResponse.json({ message: "Rate limit must be between 1 and 120 votes per minute." }, { status: 400 });
      }
      pollUpdates.rate_limit_per_minute = Math.floor(body.rateLimitPerMinute);
    }
  }

  const persistedUpdates = body.type === "poll" ? { ...updates, ...pollUpdates } : updates;
  const { error } = body.type === "poll"
    ? await supabase.from("polls").update(persistedUpdates).eq("id", id)
    : await supabase.from("elections").update(updates).eq("id", id);
  if (error) {
    console.error("Event update failed:", error.message);
    return NextResponse.json({ message: "Could not update event." }, { status: 503 });
  }
  await writeAuditLog(admin.id, "event.updated", body.type, id, persistedUpdates);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  const type = new URL(request.url).searchParams.get("type");
  if (!isEventType(type)) return NextResponse.json({ message: "Select a valid event type." }, { status: 400 });
  const supabase = createAdminSupabase();
  const table = type === "poll" ? "polls" : "elections";
  const { data: event, error: lookupError } = await supabase.from(table).select("status").eq("id", id).maybeSingle();
  if (lookupError) return NextResponse.json({ message: "Could not load event." }, { status: 503 });
  if (!event) return NextResponse.json({ message: "Event not found." }, { status: 404 });
  if (event.status !== "draft") {
    return NextResponse.json({ message: "Only draft events can be removed. Close or cancel other events." }, { status: 409 });
  }
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error("Draft event deletion failed:", error.message);
    return NextResponse.json({ message: "Could not remove draft event." }, { status: 503 });
  }
  await writeAuditLog(admin.id, "event.deleted", type, id);
  return NextResponse.json({ success: true });
}
