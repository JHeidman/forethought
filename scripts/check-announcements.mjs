import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? "";

const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.from("announcements").select("*").order("created_at");
if (error) { console.error(error); process.exit(1); }

for (const a of data) {
  console.log(`\n=== ${a.title} (${a.version}) [${a.is_active ? "active" : "hidden"}] ===`);
  console.log("Summary:", a.summary);
  console.log("Detail:", a.detail);
}
