import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function PATCH(req: NextRequest) {
  try {
    const { club_name, expected_distance } = await req.json();
    if (!club_name || expected_distance === undefined) {
      return NextResponse.json({ error: "club_name and expected_distance required" }, { status: 400 });
    }

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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("clubs")
      .update({
        expected_distance,
        distance_source: "user_input",
        default_basis: "Set by you",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("club_name", club_name);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Clubs PATCH error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
