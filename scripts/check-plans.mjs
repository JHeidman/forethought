import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? "";

const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase
  .from("practice_plans")
  .select("id, title, content, created_at, user_id")
  .order("created_at", { ascending: false });

if (error) { console.error(error); process.exit(1); }

console.log(`Total plans: ${data.length}\n`);
for (const p of data) {
  console.log(`[${p.created_at?.slice(0,10)}] "${p.title}"`);
  console.log(`  Content preview: ${p.content.slice(0, 120).replace(/\n/g, " ")}...`);
  console.log();
}
