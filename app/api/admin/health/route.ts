import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = ["jh.berkut@gmail.com"];

function getEnvVar(name: string): string {
  return process.env[name] ?? "";
}

async function checkElevenLabs(): Promise<{ ok: boolean; detail: string }> {
  const key = getEnvVar("ELEVENLABS_API_KEY");
  if (!key) return { ok: false, detail: "API key not configured" };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    const used = data.character_count ?? 0;
    const limit = data.character_limit ?? 0;
    const remaining = limit - used;
    const pct = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
    const ok = remaining > 1000;
    return { ok, detail: `${remaining.toLocaleString()} / ${limit.toLocaleString()} chars remaining (${pct}%)` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkGroq(): Promise<{ ok: boolean; detail: string }> {
  const key = getEnvVar("GROQ_API_KEY");
  if (!key) return { ok: false, detail: "API key not configured" };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: "Key valid" };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkAnthropic(): Promise<{ ok: boolean; detail: string }> {
  const key = getEnvVar("ANTHROPIC_API_KEY");
  if (!key) return { ok: false, detail: "API key not configured" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, detail: "Key valid" };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

async function checkTavily(): Promise<{ ok: boolean; detail: string }> {
  const key = getEnvVar("TAVILY_API_KEY");
  if (!key) return { ok: false, detail: "API key not configured" };
  // Tavily has no cheap status endpoint — just validate the key format
  const valid = key.startsWith("tvly-");
  return { ok: valid, detail: valid ? "Key configured" : "Key format unexpected" };
}

export async function GET(req: NextRequest) {
  // Auth check
  const supabase = createClient(
    getEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    getEnvVar("SUPABASE_SERVICE_ROLE_KEY")
  );
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [elevenlabs, groq, anthropic, tavily] = await Promise.all([
    checkElevenLabs(),
    checkGroq(),
    checkAnthropic(),
    checkTavily(),
  ]);

  return NextResponse.json({
    services: {
      elevenlabs: { name: "ElevenLabs (TTS)", ...elevenlabs },
      groq: { name: "Groq (Whisper)", ...groq },
      anthropic: { name: "Anthropic (Claude)", ...anthropic },
      tavily: { name: "Tavily (Web Search)", ...tavily },
    },
    checkedAt: new Date().toISOString(),
  });
}
