import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";

// Windows/Turbopack workaround: read .env.local directly since process.env
// may have a stale empty value that blocks normal .env.local loading
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

function isProfileComplete(profile: Record<string, string | null>) {
  return !!(profile.name && profile.handicap && profile.home_course);
}

function buildSystemPrompt(profile: {
  name?: string | null;
  handicap?: string | null;
  home_course?: string | null;
  player_notes?: string | null;
}, isFirstMessage = false) {
  if (!isProfileComplete(profile as Record<string, string | null>)) {
    const known = [];
    const needed = [];
    if (profile.name) known.push(`name: ${profile.name}`); else needed.push("name");
    if (profile.handicap) known.push(`handicap: ${profile.handicap}`); else needed.push("handicap or skill level");
    if (profile.home_course) known.push(`home course: ${profile.home_course}`); else needed.push("home course");

    return `You are Frankie, a golf caddy and instructor in the middle of a setup conversation.

${known.length > 0 ? `You already know: ${known.join(", ")}.` : ""}
You still need to find out: ${needed.join(", ")}.

${isFirstMessage ? "Start by introducing yourself in one sentence, then ask for their name." : `Ask for the next missing piece of information: ${needed[0]}. Do not introduce yourself — that already happened.`}

Keep it casual and warm. One question at a time. No lists.`;
  }

  return `You are Frankie, a personal golf caddy and instructor for ${profile.name}.

Here is what you know about their game:
- Handicap/Skill level: ${profile.handicap}
- Home course: ${profile.home_course}
- Notes about their game: ${profile.player_notes || "none yet"}

You are knowledgeable, confident, and just a little bit sarcastic — but always warm and genuinely invested in helping your player improve. Think of yourself as the friend who happens to know everything about golf and isn't afraid to tell it like it is. You're not mean, you're just honest. You've seen this player make the same mistake before and you'll absolutely mention it.

Your job covers three things:
1. On-course caddy: club selection, course management, shot strategy
2. Shot diagnosis: when the player describes a problem, identify the likely cause and give a clear, simple fix — no technical jargon unless asked
3. Practice planning: help the player build and manage a practice plan based on their weaknesses

RULES:
- Keep responses concise. The player is often standing on a fairway with one hand free.
- Lead with the actionable recommendation, then explain why if needed.
- Speak like a person, not a manual. No bullet-pointed lectures unless specifically helpful.
- Your sarcasm should always land as affectionate, never discouraging.
- Calibrate language to a casual golfer — avoid tour-pro terminology unless they use it first.
- Reference past conversation and what you know about their game whenever relevant.
- When the player asks you to remember something, acknowledge it and update your understanding of their game.`;
}

// Silently extract profile fields from conversation history using a fast model call
async function extractProfile(
  anthropic: Anthropic,
  conversationText: string,
  existing: Record<string, string | null>
): Promise<{ name?: string; handicap?: string; home_course?: string }> {
  try {
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: `Extract golf player profile information from this conversation. Return ONLY a JSON object with these fields (omit any field you're not confident about):
- name: player's name (first name or full name)
- handicap: handicap index or skill description (e.g. "39", "beginner", "casual")
- home_course: name of their home course or where they usually play

Return only valid JSON, nothing else. Example: {"name": "Jeff", "handicap": "39", "home_course": "Genesee Valley Golf Club"}`,
      messages: [{ role: "user", content: `Conversation:\n${conversationText}\n\nAlready known: ${JSON.stringify(existing)}` }],
    });

    const raw = result.content[0].type === "text" ? result.content[0].text.trim() : "{}";
    // Strip markdown code fences if present
    const text = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(text);
  } catch (err) {
    console.error("Profile extraction error:", err);
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const { message, isGreeting } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet) => {
            try {
              toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [profileResult, historyResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("messages")
        .select("role, content")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    let profile = profileResult.data ?? {};
    const history = (historyResult.data ?? []).reverse();

    // Save user message (skip for synthetic greeting trigger)
    if (!isGreeting) {
      await supabase.from("messages").insert({
        user_id: user.id,
        role: "user",
        content: message,
      });
    }

    const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });

    // During onboarding, try to extract profile fields from conversation + new message
    if (!isProfileComplete(profile as Record<string, string | null>) && !isGreeting) {
      const conversationText = [
        ...history.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`),
        `user: ${message}`,
      ].join("\n");

      const extracted = await extractProfile(anthropic, conversationText, {
        name: profile.name ?? null,
        handicap: profile.handicap ?? null,
        home_course: profile.home_course ?? null,
      });

      const updated = {
        name: extracted.name || profile.name || null,
        handicap: extracted.handicap || profile.handicap || null,
        home_course: extracted.home_course || profile.home_course || null,
      };

      if (updated.name || updated.handicap || updated.home_course) {
        const { error: upsertError } = await supabase.from("profiles").upsert({
          id: user.id,
          ...updated,
          player_notes: profile.player_notes,
          updated_at: new Date().toISOString(),
        });
        if (upsertError) console.error("Profile upsert error:", upsertError);
        profile = { ...profile, ...updated };
      }
    }

    // Build messages for Frankie
    const apiMessages: { role: "user" | "assistant"; content: string }[] = [
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      ...(isGreeting ? [] : [{ role: "user" as const, content: message }]),
    ];

    // For greeting, send a minimal prompt to get Frankie's intro
    if (isGreeting) {
      apiMessages.push({ role: "user", content: "hello" });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: buildSystemPrompt(profile, isGreeting),
      messages: apiMessages,
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";

    // Save Frankie's reply
    await supabase.from("messages").insert({
      user_id: user.id,
      role: "assistant",
      content: reply,
    });

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
