import { NextRequest, NextResponse } from "next/server";
import { searchCourses } from "@/lib/golf-course-api";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ courses: [] });

  try {
    const courses = await searchCourses(q);
    return NextResponse.json({ courses });
  } catch (err) {
    console.error("Course search error:", err);
    return NextResponse.json({ courses: [] });
  }
}
