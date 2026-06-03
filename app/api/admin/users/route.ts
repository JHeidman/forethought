import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";

const ADMIN_EMAIL = "jh.berkut@gmail.com";

// Cost estimates (per message, rough average)
const COST_PER_MESSAGE_USD = 0.015; // ~$0.015 per exchange (input + output tokens)
const ELEVENLABS_COST_PER_MESSAGE_USD = 0.003; // ~$0.003 per TTS response

function getEnvVar(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const content = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  } catch {}
  return "";
}

export async function GET(req: NextRequest) {
  try {
    // Verify admin
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet) => { try { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {} },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use service role for admin queries
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch all users
    const { data: authUsers } = await admin.auth.admin.listUsers();
    const users = authUsers?.users ?? [];

    // Fetch all profiles
    const { data: profiles } = await admin.from("profiles").select("id, name, handicap, home_course, persona, is_admin");

    // Fetch message counts and last message date per user
    const { data: messageCounts } = await admin
      .from("messages")
      .select("user_id, role, created_at")
      .order("created_at", { ascending: false });

    // Fetch practice plan counts per user
    const { data: plans } = await admin
      .from("practice_plans")
      .select("user_id");

    // Build stats per user
    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

    const messagesByUser: Record<string, { count: number; lastDate: string }> = {};
    for (const msg of messageCounts ?? []) {
      if (!messagesByUser[msg.user_id]) {
        messagesByUser[msg.user_id] = { count: 0, lastDate: msg.created_at };
      }
      messagesByUser[msg.user_id].count++;
    }

    const plansByUser: Record<string, number> = {};
    for (const plan of plans ?? []) {
      plansByUser[plan.user_id] = (plansByUser[plan.user_id] ?? 0) + 1;
    }

    const stats = users.map(u => {
      const profile = profileMap[u.id] ?? {};
      const msgs = messagesByUser[u.id] ?? { count: 0, lastDate: null };
      const exchangeCount = Math.floor(msgs.count / 2); // pairs of user+assistant
      const estimatedCost = ((exchangeCount * COST_PER_MESSAGE_USD) + (exchangeCount * ELEVENLABS_COST_PER_MESSAGE_USD)).toFixed(2);

      return {
        id: u.id,
        email: u.email,
        name: profile.name ?? null,
        persona: profile.persona ?? "frankie",
        handicap: profile.handicap ?? null,
        is_admin: profile.is_admin ?? false,
        signedUpAt: u.created_at,
        messageCount: msgs.count,
        lastActive: msgs.lastDate,
        planCount: plansByUser[u.id] ?? 0,
        estimatedCostUsd: estimatedCost,
      };
    });

    // Sort by message count descending
    stats.sort((a, b) => b.messageCount - a.messageCount);

    const totalCost = stats.reduce((sum, u) => sum + parseFloat(u.estimatedCostUsd), 0).toFixed(2);

    return NextResponse.json({ users: stats, totalCostUsd: totalCost });
  } catch (err) {
    console.error("Admin users error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
