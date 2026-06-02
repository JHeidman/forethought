// Usage: node scripts/db.js [table] [--user email]
// Examples:
//   node scripts/db.js profiles
//   node scripts/db.js messages
//   node scripts/db.js messages --user jeff@example.com

const fs = require("fs");
const path = require("path");

// Load .env.local
const env = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
env.split("\n").forEach((line) => {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
});

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function main() {
  const args = process.argv.slice(2);
  const table = args[0] || "profiles";
  const userIdx = args.indexOf("--user");
  const userEmail = userIdx !== -1 ? args[userIdx + 1] : null;

  let userId = null;

  if (userEmail) {
    const { data: users } = await supabase.auth.admin.listUsers();
    const match = users?.users?.find((u) => u.email === userEmail);
    if (!match) {
      console.log(`No user found with email: ${userEmail}`);
      return;
    }
    userId = match.id;
    console.log(`User: ${match.email} (${match.id})\n`);
  }

  let query = supabase.from(table).select("*").order("created_at", { ascending: true });
  if (userId) {
    query = query.eq(table === "profiles" ? "id" : "user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error:", error.message);
    return;
  }

  console.log(`=== ${table} (${data.length} rows) ===\n`);
  data.forEach((row, i) => {
    console.log(`[${i + 1}]`, JSON.stringify(row, null, 2));
  });
}

main();
