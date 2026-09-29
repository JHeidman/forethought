import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteCode, type InviteCode } from "@/lib/invites";

const ADMIN_EMAIL = "jh.berkut@gmail.com";
const INVITE_VALID_DAYS = 30;

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user && user.email === ADMIN_EMAIL;
}

export async function GET() {
  try {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await createAdminClient()
      .from("invite_requests")
      .select("id, email, handicap_range, wants, source, status, invite_code, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    return NextResponse.json({ requests: data ?? [] });
  } catch (err) {
    console.error("Admin invite requests error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, action } = await req.json();
    if (!id || (action !== "approve" && action !== "decline")) {
      return NextResponse.json({ error: "id and a valid action are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: request, error: requestErr } = await admin
      .from("invite_requests")
      .select("id, email, source, status, invite_code")
      .eq("id", id)
      .single();
    if (requestErr || !request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    if (action === "decline") {
      const { error } = await admin.from("invite_requests").update({ status: "declined" }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true, status: "declined" });
    }

    const { data: settingsRow } = await admin.from("settings").select("value").eq("key", "invite_codes").single();
    const codes: InviteCode[] = settingsRow?.value ? JSON.parse(settingsRow.value) : [];

    if (request.status === "approved" && request.invite_code) {
      const existing = codes.find(c => c.code === request.invite_code);
      return NextResponse.json({ ok: true, status: "approved", code: request.invite_code, expiresAt: existing?.expiresAt ?? null, codes });
    }

    let code = generateInviteCode();
    while (codes.some(c => c.code === code)) code = generateInviteCode();
    const expiresAt = new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const updatedCodes = [...codes, { code, expiresAt, source: request.source, email: request.email }];

    const { error: codesErr } = await admin
      .from("settings")
      .upsert({ key: "invite_codes", value: JSON.stringify(updatedCodes), updated_at: new Date().toISOString() });
    if (codesErr) throw codesErr;

    const { error: updateErr } = await admin
      .from("invite_requests")
      .update({ status: "approved", invite_code: code })
      .eq("id", id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, status: "approved", code, expiresAt, codes: updatedCodes });
  } catch (err) {
    console.error("Admin invite request action error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
