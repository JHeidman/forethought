import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const get = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? "";

const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Delete the four hip pivot "plans" that are actually swing notes
const { data, error } = await supabase
  .from("practice_plans")
  .delete()
  .ilike("title", "%Hip Pivot%")
  .select("title");

if (error) { console.error(error); process.exit(1); }
console.log(`Deleted ${data.length} entries:`);
data.forEach(p => console.log(" -", p.title));

// Also delete the one with "Swing Breakthrough" in the title
const { data: data2, error: error2 } = await supabase
  .from("practice_plans")
  .delete()
  .ilike("title", "%Breakthrough%")
  .select("title");

if (error2) { console.error(error2); process.exit(1); }
if (data2.length) {
  console.log(`\nAlso deleted ${data2.length}:`);
  data2.forEach(p => console.log(" -", p.title));
}

console.log("\nDone. Remaining plans:");
const { data: remaining } = await supabase.from("practice_plans").select("title").order("created_at");
remaining.forEach(p => console.log(" •", p.title));
