import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getPublicBallot } from "@/lib/public-ballot";
import { hashToken } from "@/lib/qura-security";

const COOKIE_NAME = "qura_public_session";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ message: "Voting link is required." }, { status: 400 });
  const ballot = await getPublicBallot(token);
  if (!ballot || ballot.eventType !== "poll") return NextResponse.json({ message: "Voting link not found." }, { status: 404 });
  const store = await cookies();
  let sessionToken = store.get(COOKIE_NAME)?.value;
  if (!sessionToken || !/^[A-Za-z0-9_-]{32,64}$/.test(sessionToken)) sessionToken = randomBytes(32).toString("base64url");
  let alreadyVoted = false;
  if (ballot.sessionDuplicateProtection) {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from("voter_participation").select("id")
      .eq("event_type", "poll").eq("event_id", ballot.eventId).eq("participant_hash", hashToken(sessionToken)).maybeSingle();
    if (error) {
      console.error("Public poll session check failed:", error.message);
      return NextResponse.json({ message: "Could not check the voting session." }, { status: 503 });
    }
    alreadyVoted = data !== null;
  }
  return NextResponse.json(
    { ready: true, alreadyVoted },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`, "Cache-Control": "no-store" } },
  );
}
