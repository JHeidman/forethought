import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function buildSupabase() {
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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { club_name } = body;

    if (!club_name) {
      return NextResponse.json({ error: "club_name required" }, { status: 400 });
    }

    const supabase = await buildSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("clubs")
      .delete()
      .eq("user_id", user.id)
      .eq("club_name", club_name);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Clubs DELETE error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { club_name } = body;

    if (!club_name) {
      return NextResponse.json({ error: "club_name required" }, { status: 400 });
    }

    const supabase = await buildSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Build update payload — only include fields that were sent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Distance fields
    if (body.expected_distance !== undefined) {
      update.expected_distance = body.expected_distance;
      update.distance_source = "user_input";
      update.default_basis = "Set by you";
    }
    if (body.carry_distance !== undefined) update.carry_distance = body.carry_distance || null;

    // Equipment identity
    if (body.brand !== undefined) update.brand = body.brand || null;
    if (body.club_model !== undefined) update.club_model = body.club_model || null;

    // Specs
    if (body.loft !== undefined) update.loft = body.loft || null;
    if (body.lie_angle !== undefined) update.lie_angle = body.lie_angle || null;
    if (body.shaft_flex !== undefined) update.shaft_flex = body.shaft_flex || null;
    if (body.shaft_material !== undefined) update.shaft_material = body.shaft_material || null;
    if (body.specs_source !== undefined) update.specs_source = body.specs_source || null;

    // Feel / coaching data
    if (body.confidence !== undefined) update.confidence = body.confidence || null;
    if (body.typical_shape !== undefined) update.typical_shape = body.typical_shape || null;
    if (body.notes !== undefined) update.notes = body.notes || null;

    // In-bag status
    if (body.in_bag !== undefined) update.in_bag = body.in_bag;

    const { error } = await supabase
      .from("clubs")
      .update(update)
      .eq("user_id", user.id)
      .eq("club_name", club_name);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Clubs PATCH error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
