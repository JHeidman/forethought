import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function makeSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );
}

export type Announcement = {
  id: string;
  version: string;
  title: string;
  summary: string;
  detail: string;
  is_active: boolean;
  created_at: string;
};

/**
 * GET /api/announcements
 * Returns announcements the current user hasn't seen yet.
 * Also accepts ?all=true to return all active announcements (for profile page).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const all = new URL(req.url).searchParams.get("all") === "true";

    // Fetch all active announcements
    const { data: announcements, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[announcements] fetch error:", error);
      throw error;
    }
    console.log(`[announcements] found ${announcements?.length ?? 0} active announcements for user ${user.id}`);
    if (!announcements?.length) return NextResponse.json({ announcements: [] });

    if (all) {
      return NextResponse.json({ announcements });
    }

    // Fetch which ones this user has already read
    const { data: reads, error: readsError } = await supabase
      .from("user_announcement_reads")
      .select("announcement_id")
      .eq("user_id", user.id);

    if (readsError) console.error("[announcements] reads error:", readsError);
    console.log(`[announcements] user has read ${reads?.length ?? 0} announcements`);

    const readIds = new Set((reads ?? []).map((r: { announcement_id: string }) => r.announcement_id));
    const unread = announcements.filter((a: Announcement) => !readIds.has(a.id));

    return NextResponse.json({ announcements: unread });
  } catch (err) {
    console.error("GET /api/announcements error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * POST /api/announcements/mark-read
 * Body: { ids: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await makeSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { ids } = await req.json() as { ids: string[] };
    if (!ids?.length) return NextResponse.json({ ok: true });

    const rows = ids.map((id: string) => ({ user_id: user.id, announcement_id: id }));
    await supabase.from("user_announcement_reads").upsert(rows, { onConflict: "user_id,announcement_id" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/announcements error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
