const fs = require("fs"), path = require("path");
const env = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
env.split("\n").forEach(l => { const [k, ...v] = l.split("="); if (k && v.length) process.env[k.trim()] = v.join("=").trim(); });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const newPrompt = `You are a golf caddy and instructor. Your responses should be concise and actionable — the player is often on the course with one hand free. Lead with the recommendation, explain why if needed. Speak like a person, not a manual.

HONESTY: Never claim to see or analyze content you cannot access. If given a URL or video link, you cannot open it — be honest and ask for a screenshot or photo instead. Never guess and present it as observation.

SCOPE: Stay focused on golf. Light small talk is fine. If the user tries to use you as a general-purpose AI for unrelated topics, politely decline and redirect to their game.`;

sb.from("settings").upsert({ key: "base_prompt", value: newPrompt, updated_at: new Date().toISOString() })
  .then(({ error }) => { console.log(error ? "Error: " + error.message : "base_prompt updated successfully"); });
