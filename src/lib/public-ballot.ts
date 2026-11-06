import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/qura-security";

export type PublicBallot = {
  eventType: "poll" | "election";
  eventId: string;
  title: string;
  description: string;
  status: string;
  opensAt: string;
  closesAt: string;
  resultsPublic: boolean;
  botProtection: boolean;
  sessionDuplicateProtection: boolean;
  rateLimitPerMinute: number;
  isOpen: boolean;
  hasOpened: boolean;
  invitationUsed: boolean;
  questions: { id: string; prompt: string; minSelections: number; maxSelections: number; options: { id: string; label: string }[] }[];
  positions: { id: string; title: string; minSelections: number; maxSelections: number; candidates: { id: string; name: string; grade: string; statement: string; photoUrl: string | null }[] }[];
  invitation: boolean;
};

export async function getPublicBallot(token: string): Promise<PublicBallot | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const supabase = createAdminSupabase();
  const tokenHash = hashToken(token);
  const { data: link, error: linkError } = await supabase.from("voting_links")
    .select("id, poll_id").eq("token_hash", tokenHash).eq("is_active", true).is("revoked_at", null).maybeSingle();
  if (linkError) throw new Error(`Could not check public voting link: ${linkError.message}`);

  if (link) {
    const { data: poll, error } = await supabase.from("polls").select("*").eq("id", link.poll_id).maybeSingle();
    if (error) throw new Error(`Could not load poll: ${error.message}`);
    if (!poll) return null;
    const { data: questions, error: questionError } = await supabase.from("poll_questions")
      .select("id, prompt, min_selections, max_selections").eq("poll_id", poll.id).order("position");
    if (questionError) throw new Error(`Could not load poll questions: ${questionError.message}`);
    const questionIds = questions.map((question) => question.id);
    const { data: options, error: optionError } = questionIds.length
      ? await supabase.from("poll_options").select("id, question_id, label").in("question_id", questionIds).order("position")
      : { data: [], error: null };
    if (optionError) throw new Error(`Could not load poll options: ${optionError.message}`);
    return {
      eventType: "poll",
      eventId: poll.id,
      title: poll.title,
      description: poll.description,
      status: poll.status,
      opensAt: poll.opens_at,
      closesAt: poll.closes_at,
      resultsPublic: poll.results_public,
      botProtection: poll.bot_protection,
      sessionDuplicateProtection: poll.session_duplicate_protection,
      rateLimitPerMinute: poll.rate_limit_per_minute,
      isOpen: poll.status === "open" && Date.now() >= Date.parse(poll.opens_at) && Date.now() < Date.parse(poll.closes_at),
      hasOpened: Date.now() >= Date.parse(poll.opens_at),
      invitationUsed: false,
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        minSelections: question.min_selections,
        maxSelections: question.max_selections,
        options: options.filter((option) => option.question_id === question.id).map((option) => ({ id: option.id, label: option.label })),
      })),
      positions: [],
      invitation: false,
    };
  }

  const { data: invitation, error: invitationError } = await supabase.from("invitation_tokens")
    .select("id, election_id, eligibility_id, expires_at, revoked_at, used_at")
    .eq("token_hash", tokenHash).is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle();
  if (invitationError) throw new Error(`Could not check election invitation: ${invitationError.message}`);
  if (!invitation) return null;
  const { data: eligible, error: eligibilityError } = await supabase.from("voter_eligibility")
    .select("id, is_active").eq("id", invitation.eligibility_id).maybeSingle();
  if (eligibilityError) throw new Error(`Could not check voter eligibility: ${eligibilityError.message}`);
  if (!eligible?.is_active) return null;
  const { data: election, error: electionError } = await supabase.from("elections")
    .select("*").eq("id", invitation.election_id).maybeSingle();
  if (electionError) throw new Error(`Could not load election: ${electionError.message}`);
  if (!election) return null;
  const { data: positions, error: positionError } = await supabase.from("election_positions")
    .select("id, title, min_selections, max_selections").eq("election_id", election.id).order("position");
  if (positionError) throw new Error(`Could not load election positions: ${positionError.message}`);
  const positionIds = positions.map((position) => position.id);
  const { data: candidates, error: candidateError } = positionIds.length
    ? await supabase.from("candidates").select("id, position_id, name, grade, statement, media_file_id").in("position_id", positionIds)
    : { data: [], error: null };
  if (candidateError) throw new Error(`Could not load election candidates: ${candidateError.message}`);
  const mediaIds = candidates.flatMap((candidate) => candidate.media_file_id ? [candidate.media_file_id] : []);
  const { data: media, error: mediaError } = mediaIds.length
    ? await supabase.from("media_files").select("id, storage_key").in("id", mediaIds)
    : { data: [], error: null };
  if (mediaError) throw new Error(`Could not load contestant photos: ${mediaError.message}`);
  const publicUrl = supabase.storage.from("qura-contestants").getPublicUrl("").data.publicUrl;

  return {
    eventType: "election",
    eventId: election.id,
    title: election.title,
    description: election.description,
    status: election.status,
    opensAt: election.opens_at,
    closesAt: election.closes_at,
    resultsPublic: election.results_public,
    botProtection: false,
    sessionDuplicateProtection: true,
    rateLimitPerMinute: 30,
    isOpen: election.status === "open" && Date.now() >= Date.parse(election.opens_at) && Date.now() < Date.parse(election.closes_at),
    hasOpened: Date.now() >= Date.parse(election.opens_at),
    invitationUsed: invitation.used_at !== null,
    questions: [],
    positions: positions.map((position) => ({
      id: position.id,
      title: position.title,
      minSelections: position.min_selections,
      maxSelections: position.max_selections,
      candidates: candidates.filter((candidate) => candidate.position_id === position.id).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        grade: candidate.grade,
        statement: candidate.statement,
        photoUrl: candidate.media_file_id
          ? `${publicUrl}${media.find((item) => item.id === candidate.media_file_id)?.storage_key ?? ""}`
          : null,
      })),
    })),
    invitation: true,
  };
}
