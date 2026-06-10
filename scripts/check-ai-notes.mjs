import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? "";

const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.from("profiles").select("id, name, ai_notes");
if (error) { console.error("Error:", error); process.exit(1); }

for (const row of data) {
  console.log(`\n--- ${row.name ?? row.id} ---`);
  console.log("ai_notes:", row.ai_notes ?? "(null)");
}
