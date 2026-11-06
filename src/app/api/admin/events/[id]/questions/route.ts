import { NextResponse } from "next/server";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const { id } = await context.params;
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ message: "Provide poll question details." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ message: "Provide poll question details." }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.questionId !== "string" || typeof body.prompt !== "string" ||
      body.prompt.trim().length < 2 || body.prompt.length > 500 ||
      !Array.isArray(body.options) || body.options.length < 2 || body.options.length > 20 ||
      body.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 120) ||
      typeof body.maxSelections !== "number" || !Number.isInteger(body.maxSelections) ||
      body.maxSelections < 1 || body.maxSelections > body.options.length) {
    return NextResponse.json({ message: "Check the question, at least two options, and the maximum selections." }, { status: 400 });
  }
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("replace_poll_question", {
    p_poll_id: id,
    p_question_id: body.questionId,
    p_prompt: body.prompt.trim(),
    p_max_selections: body.maxSelections,
    p_options: (body.options as string[]).map((option) => option.trim()),
  });
  if (error) {
    if (error.message === "POLL_NOT_DRAFT") return NextResponse.json({ message: "Poll questions can only be changed before voting begins." }, { status: 409 });
    if (error.message === "INVALID_QUESTION") return NextResponse.json({ message: "Check the question and answer options." }, { status: 400 });
    console.error("Poll question update failed:", error.message);
    return NextResponse.json({ message: "Could not update the poll question." }, { status: 503 });
  }
  await writeAuditLog(admin.id, "poll.question.updated", "poll", id);
  return NextResponse.json({ success: true });
}
