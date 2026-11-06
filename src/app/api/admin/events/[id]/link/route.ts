import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createOpaqueToken, hashToken } from "@/lib/qura-security";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id: pollId } = await context.params;
  const supabase = createAdminSupabase();
  const { data: poll, error } = await supabase.from("polls").select("status").eq("id", pollId).maybeSingle();
  if (error) return NextResponse.json({ message: "Could not load poll." }, { status: 503 });
  if (!poll) return NextResponse.json({ message: "Poll not found." }, { status: 404 });
  if (poll.status === "closed" || poll.status === "cancelled") {
    return NextResponse.json({ message: "Closed or cancelled polls cannot receive new links." }, { status: 409 });
  }

  const token = createOpaqueToken();
  const { error: revokeError } = await supabase.from("voting_links")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("poll_id", pollId).eq("is_active", true);
  if (revokeError) return NextResponse.json({ message: "Could not replace the previous voting link." }, { status: 503 });
  const { error: insertError } = await supabase.from("voting_links").insert({
    poll_id: pollId,
    token_hash: hashToken(token),
    created_by: admin.id,
  });
  if (insertError) {
    console.error("Voting link creation failed:", insertError.message);
    return NextResponse.json({ message: "Could not create a voting link." }, { status: 503 });
  }

  await writeAuditLog(admin.id, "poll.link.generated", "poll", pollId);
  return NextResponse.json({ url: new URL(`/vote/${token}`, request.url).toString() }, { status: 201 });
}
