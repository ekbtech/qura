import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { message: "Invitation-code verification is no longer supported. Use the shared election link to receive an email code." },
    { status: 410 },
  );
}
