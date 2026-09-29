import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HANDICAP_RANGES, WANTS, isValidEmail, normalizeSource } from "@/lib/invites";

const MAX_REQUESTS_PER_HOUR = 40;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Hidden field real visitors never see; bots fill it in
    if (body.website) return NextResponse.json({ ok: true });

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
    }
    const handicapRange = HANDICAP_RANGES.includes(body.handicapRange) ? body.handicapRange : null;
    const wants = WANTS.includes(body.wants) ? body.wants : null;
    const source = normalizeSource(body.source);

    const admin = createAdminClient();

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("invite_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", hourAgo);
    if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
      return NextResponse.json({ error: "We're getting a lot of requests right now. Try again in a bit." }, { status: 429 });
    }

    const { data: existing } = await admin
      .from("invite_requests")
      .select("id")
      .eq("email", email)
      .limit(1);
    if (existing && existing.length > 0) return NextResponse.json({ ok: true });

    const { error } = await admin.from("invite_requests").insert({
      email,
      handicap_range: handicapRange,
      wants,
      source,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Invite request error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again?" }, { status: 500 });
  }
}
