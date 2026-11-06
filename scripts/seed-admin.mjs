import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const email = process.env.QURA_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.QURA_ADMIN_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password || password.length < 14 || password.length > 256 ||
    !supabaseUrl || !serviceRoleKey) {
  console.error("Set QURA_ADMIN_EMAIL, QURA_ADMIN_PASSWORD (14+ characters), NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.");
  process.exitCode = 1;
} else {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { count, error: countError } = await supabase.from("admins")
    .select("id", { count: "exact", head: true }).eq("is_active", true);
  if (countError) throw new Error(`Could not check the administrator table: ${countError.message}`);
  if (count > 0) throw new Error("An active administrator already exists. This protected seed process only creates the initial administrator.");

  const salt = randomBytes(32).toString("hex");
  const passwordHash = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  }).toString("hex");
  const { error } = await supabase.from("admins").insert({
    email,
    password_salt: salt,
    password_hash: passwordHash,
    is_active: true,
  });
  if (error) throw new Error(`Could not create the initial administrator: ${error.message}`);
  console.log("Initial QURA administrator created. Clear QURA_ADMIN_PASSWORD from the process environment.");
}
