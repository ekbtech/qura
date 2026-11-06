import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeAdminMutation, writeAuditLog } from "@/lib/admin-api";
import { createAdminSupabase } from "@/lib/supabase/admin";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const admin = await authorizeAdminMutation(request);
  if (!admin) return NextResponse.json({ message: "Administrator sign-in required." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 3_000_000 || !allowedTypes.has(file.type)) {
    return NextResponse.json({ message: "Choose a JPG, PNG, or WebP image smaller than 3 MB." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const signatureValid =
    (file.type === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (file.type === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (file.type === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!signatureValid) return NextResponse.json({ message: "The image file could not be verified." }, { status: 400 });

  const supabase = createAdminSupabase();
  const storageKey = `${randomUUID()}.${file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp"}`;
  const { error: uploadError } = await supabase.storage.from("qura-contestants").upload(storageKey, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("Contestant image upload failed:", uploadError.message);
    return NextResponse.json({ message: "Could not upload contestant photograph." }, { status: 503 });
  }
  const { data, error } = await supabase.from("media_files").insert({
    storage_key: storageKey,
    original_name: file.name.slice(0, 180),
    content_type: file.type,
    size_bytes: file.size,
    uploaded_by: admin.id,
  }).select("id").single();
  if (error) {
    await supabase.storage.from("qura-contestants").remove([storageKey]);
    console.error("Contestant image metadata failed:", error.message);
    return NextResponse.json({ message: "Could not save contestant photograph." }, { status: 503 });
  }
  await writeAuditLog(admin.id, "candidate.photo.uploaded", null, null, { mediaFileId: data.id });
  return NextResponse.json({ mediaFileId: data.id }, { status: 201 });
}
