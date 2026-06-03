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

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ valid: false });

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

    if (!data?.value) return NextResponse.json({ valid: false });

    const codes: string[] = JSON.parse(data.value);
    const valid = codes.map(c => c.toUpperCase()).includes(code.toUpperCase());

    return NextResponse.json({ valid });
  } catch (err) {
    console.error("Invite validation error:", err);
    return NextResponse.json({ valid: false });
  }
}
