// Golf Course API (golfcourseapi.com) integration

const BASE_URL = "https://api.golfcourseapi.com/v1";

function getApiKey(): string {
  if (process.env.GOLF_COURSE_API_KEY) return process.env.GOLF_COURSE_API_KEY;
  try {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = content.match(/^GOLF_COURSE_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  return "";
}

export type HoleData = {
  par: number;
  yardage: number;
  handicap: number;
};

export type TeeData = {
  tee_name: string;
  course_rating: number;
  slope_rating: number;
  total_yards: number;
  par_total: number;
  holes: HoleData[];
};

export type CourseResult = {
  id: number;
  club_name: string;
  course_name: string;
  location: {
    address: string;
    city: string;
    state: string;
    country: string;
    latitude: number;
    longitude: number;
  };
};

export type CourseDetail = CourseResult & {
  tees: {
    male: TeeData[];
    female: TeeData[];
  };
};

export async function searchCourses(query: string): Promise<CourseResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const res = await fetch(
    `${BASE_URL}/search?search_query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Key ${apiKey}` } }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return data.courses ?? [];
}

export async function getCourseDetail(courseId: number): Promise<CourseDetail | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const res = await fetch(
    `${BASE_URL}/courses/${courseId}`,
    { headers: { Authorization: `Key ${apiKey}` } }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data.course ?? null;
}

// Find the closest course to a GPS position
export async function findNearestCourse(
  lat: number,
  lon: number,
  courseName?: string
): Promise<CourseResult | null> {
  // If we have a course name, search by that first
  if (courseName) {
    const results = await searchCourses(courseName);
    if (results.length > 0) return results[0];
  }

  // Otherwise search by "golf course near lat/lon" — API doesn't support geo search
  // so we just return null and let the user name their course
  return null;
}

// Format scorecard for injection into system prompt
export function formatScorecardForPrompt(
  course: CourseDetail,
  teeName: string,
  gender: "male" | "female" = "male"
): string {
  const teeSet = course.tees[gender] ?? course.tees.male;
  const tee = teeSet.find(t => t.tee_name.toLowerCase() === teeName.toLowerCase())
    ?? teeSet[0]; // default to first available tee

  if (!tee || !tee.holes?.length) return "";

  const holeSummaries = tee.holes.map((h, i) =>
    `Hole ${i + 1}: Par ${h.par}, ${h.yardage} yards (handicap ${h.handicap})`
  ).join("\n");

  return `COURSE IN PLAY: ${course.club_name} — ${course.course_name} Course
Tees: ${tee.tee_name} (${tee.total_yards} yards total, par ${tee.par_total}, rating ${tee.course_rating}/${tee.slope_rating})

Hole-by-hole:
${holeSummaries}

Use this scorecard when the player asks about specific holes or wants course management advice.
When they tell you their yardage or hole number, use this data plus their club distances to give precise recommendations.`;
}
