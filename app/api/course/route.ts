import { NextRequest, NextResponse } from "next/server";
import { searchCourses } from "@/lib/golf-course-api";

export async function GET(req: NextRequest) {
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
