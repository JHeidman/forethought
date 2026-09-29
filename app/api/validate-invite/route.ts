import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { findValidCode, type InviteCode } from "@/lib/invites";

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
    const result = findValidCode(codes, String(code));

    if (!result.valid) {
      return NextResponse.json({
        valid: false,
        reason: result.reason === "expired" ? "This invite code has expired" : "Invalid code",
      });
    }

    return NextResponse.json({ valid: true, source: result.match.source ?? null });
  } catch (err) {
    console.error("Invite validation error:", err);
    return NextResponse.json({ valid: false, reason: "Something went wrong" });
  }
}
