import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";

function getEnvVar(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const content = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  } catch {}
  return "";
}

export type ClubSpecs = {
  loft?: number;
  lie_angle?: number;
  shaft_flex_options?: string[];
  shaft_material?: string;
  adjustable?: boolean;
  notes?: string;
  unknown?: boolean;
};

export async function POST(req: NextRequest) {
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

    const { brand, model, clubType } = await req.json();
    if (!brand || !model) {
      return NextResponse.json({ error: "brand and model required" }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });

    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system: `You are a golf equipment specification database. Return ONLY a JSON object with standard specs for the given club. Only include fields you are confident about — do not guess.

Fields to return:
- loft: number (degrees — use the most common/standard loft for this model and club type)
- lie_angle: number (degrees — standard lie for this model, e.g. 58.5 for most drivers)
- shaft_flex_options: array of strings (e.g. ["Ladies", "Senior", "Regular", "Stiff", "X-Stiff"])
- shaft_material: "Steel" or "Graphite"
- adjustable: boolean (does this club have an adjustable hosel/weights?)
- notes: string (brief useful note, e.g. "Available in 9°, 10.5°, 12° loft. Adjustable up to ±2°." or "Standard iron lie is 62° for 7-iron, varies by iron number.")

If you don't recognize this specific club model, return: {"unknown": true}
If you know the brand but not this specific model, return: {"unknown": true}

Return only valid JSON. No markdown, no explanation.`,
      messages: [{
        role: "user",
        content: `Brand: ${brand}\nModel: ${model}\nClub type: ${clubType || "unknown"}`,
      }],
    });

    const raw = result.content[0].type === "text" ? result.content[0].text.trim() : "{}";
    const text = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const specs: ClubSpecs = JSON.parse(text);

    return NextResponse.json(specs);
  } catch (err) {
    console.error("Club lookup error:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
