import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

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

type InviteCode = {
  code: string;
  expiresAt?: string | null; // ISO date string, null = never expires
};

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ valid: false, reason: "No code provided" });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "invite_codes")
      .single();

    if (!data?.value) return NextResponse.json({ valid: false, reason: "No codes configured" });

    const codes: InviteCode[] = JSON.parse(data.value);
    const now = new Date();

    const match = codes.find(c => c.code.toUpperCase() === code.toUpperCase());

    if (!match) return NextResponse.json({ valid: false, reason: "Invalid code" });

    if (match.expiresAt && new Date(match.expiresAt) < now) {
      return NextResponse.json({ valid: false, reason: "This invite code has expired" });
    }

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("Invite validation error:", err);
    return NextResponse.json({ valid: false, reason: "Something went wrong" });
  }
}
