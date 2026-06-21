import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";

const ADMIN_EMAIL = "jh.berkut@gmail.com";

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

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: feedbackRows, error } = await admin
      .from("feedback")
      .select("id, user_id, type, description, user_message, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    // Attach profile names
    const userIds = [...new Set((feedbackRows ?? []).map((f: { user_id: string }) => f.user_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);

    const nameMap = Object.fromEntries((profiles ?? []).map((p: { id: string; name: string | null }) => [p.id, p.name ?? "Unknown"]));

    const rows = (feedbackRows ?? []).map((f: { id: string; user_id: string; type: string; description: string; user_message: string; created_at: string }) => ({
      ...f,
      userName: nameMap[f.user_id] ?? "Unknown",
    }));

    return NextResponse.json({ feedback: rows });
  } catch (err) {
    console.error("Admin feedback error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
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

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await admin.from("feedback").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Admin feedback delete error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
