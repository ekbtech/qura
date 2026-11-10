import "server-only";
import { createOpaqueToken, hashSensitiveValue, hashToken } from "@/lib/qura-security";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type VoterInput = { registrationNumber: string; email: string };

export function validateVoters(value: unknown): { voters?: VoterInput[]; message?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5000) {
    return { message: "Provide between 1 and 5000 eligible voters." };
  }
  const voters: VoterInput[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { message: `Invalid voter on row ${index + 1}.` };
    }
    const voter = item as Record<string, unknown>;
    if (typeof voter.registrationNumber !== "string" || typeof voter.email !== "string") {
      return { message: `Enter a registration number and email on row ${index + 1}.` };
    }
    const registrationNumber = voter.registrationNumber.trim();
    const email = voter.email.trim().toLowerCase();
    if (registrationNumber.length < 2 || registrationNumber.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return { message: `Invalid registration number or email on row ${index + 1}.` };
    }
    const registrationHash = hashSensitiveValue(registrationNumber);
    if (seen.has(registrationHash)) return { message: `Duplicate registration number on row ${index + 1}.` };
    seen.add(registrationHash);
    voters.push({ registrationNumber, email });
  }
  return { voters };
}

export async function insertEligibleVoters(
  supabase: ReturnType<typeof createAdminSupabase>,
  electionId: string,
  voters: VoterInput[],
): Promise<{ eligibility?: { id: string }[]; message?: string; status?: number }> {
  const { data: eligibility, error } = await supabase.from("voter_eligibility")
    .insert(voters.map((voter) => ({
      election_id: electionId,
      voter_ref_hash: hashSensitiveValue(voter.registrationNumber),
      email: voter.email,
    })))
    .select("id");
  if (error) {
    console.error("Voter eligibility import failed:", error.message);
    return {
      message: "Could not add eligible voters. Check for registration numbers already added to this election.",
      status: 409,
    };
  }

  const { error: invitationError } = await supabase.from("invitation_tokens").insert(eligibility.map((entry) => ({
    eligibility_id: entry.id,
    election_id: electionId,
    token_hash: hashToken(createOpaqueToken()),
  })));
  if (invitationError) {
    const { error: rollbackError } = await supabase.from("voter_eligibility").delete().eq("election_id", electionId)
      .in("id", eligibility.map((entry) => entry.id));
    if (rollbackError) console.error("Voter eligibility rollback failed:", rollbackError.message);
    console.error("Invitation generation failed:", invitationError.message);
    return { message: "Could not generate invitation links.", status: 503 };
  }

  return { eligibility };
}
