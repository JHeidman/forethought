import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getCourseDetail, formatScorecardForPrompt } from "@/lib/golf-course-api";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const courseId = Number(searchParams.get("courseId"));
    const tee = searchParams.get("tee") ?? "White";

    if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });

    // Get player gender for correct tee set
    const { data: profile } = await supabase.from("profiles").select("gender").eq("id", user.id).single();
    const gender = (profile?.gender === "female" ? "female" : "male") as "male" | "female";

    const course = await getCourseDetail(courseId);
    if (!course) return NextResponse.json({ scorecardContext: null });

    const scorecardContext = formatScorecardForPrompt(course, tee, gender);
    return NextResponse.json({ scorecardContext });
  } catch (err) {
    console.error("Course detail error:", err);
    return NextResponse.json({ error: "Failed to load course" }, { status: 500 });
  }
}
