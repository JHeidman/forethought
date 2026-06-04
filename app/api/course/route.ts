import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { searchCourses, getCourseDetail, formatScorecardForPrompt } from "@/lib/golf-course-api";

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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    const courseId = searchParams.get("id");
    const tee = searchParams.get("tee") ?? "White";
    const gender = (searchParams.get("gender") ?? "male") as "male" | "female";

    if (courseId) {
      // Get full course detail with scorecard
      const course = await getCourseDetail(parseInt(courseId));
      if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      const scorecard = formatScorecardForPrompt(course, tee, gender);
      return NextResponse.json({ course, scorecard });
    }

    if (query) {
      const courses = await searchCourses(query);
      return NextResponse.json({ courses });
    }

    return NextResponse.json({ error: "Provide q or id parameter" }, { status: 400 });
  } catch (err) {
    console.error("Course API error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
