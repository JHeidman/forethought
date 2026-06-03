import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { getPersona } from "@/lib/personas";
import { seedClubs, type Gender, type AgeGroup } from "@/lib/club-defaults";

// Windows/Turbopack workaround
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

const SPEECH_THRESHOLD = 300;

// How long since a date, in human-readable form
function timeSince(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  return `${Math.floor(days / 30)} months ago`;
}

// Relationship stage based on message count
function getRelationshipStage(messageCount: number): "brand_new" | "early" | "established" {
  if (messageCount === 0) return "brand_new";
  if (messageCount < 30) return "early";
  return "established";
}

function buildOnboardingPrompt(profile: {
  name?: string | null;
  handicap?: string | null;
  home_course?: string | null;
}, isFirstMessage: boolean): string {
  const known: string[] = [];
  const needed: string[] = [];
  if (profile.name) known.push(`name: ${profile.name}`); else needed.push("name");
  if (profile.handicap) known.push(`handicap: ${profile.handicap}`); else needed.push("handicap or skill level");
  if (profile.home_course) known.push(`home course: ${profile.home_course}`); else needed.push("home course");

  return `You are a golf caddy and instructor meeting a new player for the first time.

${known.length > 0 ? `You already know: ${known.join(", ")}.` : ""}
You still need to find out: ${needed.join(", ")}.

${isFirstMessage
    ? "Introduce yourself in one warm sentence, then ask for their name. Be genuinely curious — you want to know who you're working with."
    : `Continue the conversation naturally and ask for the next missing piece: ${needed[0]}. Don't re-introduce yourself.`}

Keep it casual and warm. One question at a time. No lists.`;
}

function buildSystemPrompt(
  basePrompt: string,
  persona: ReturnType<typeof getPersona>,
  profile: {
    name?: string | null;
    handicap?: string | null;
    home_course?: string | null;
    player_notes?: string | null;
    frankie_prefs?: string | null;
    gender?: string | null;
    age_bracket?: string | null;
  },
  context: {
    isGreeting: boolean;
    messageCount: number;
    lastActiveAt: string | null;
    recentTopics: string;
    clubs: Array<{ club_name: string; expected_distance: number; distance_source: string }>;
    missingProfileFields: string[];
  }
): string {
  const stage = getRelationshipStage(context.messageCount);
  const firstName = profile.name?.split(" ")[0] ?? "there";

  // Build relationship context block
  let relationshipContext = "";

  if (context.isGreeting) {
    if (stage === "brand_new") {
      // Should not reach here — brand new users go through onboarding
      relationshipContext = `This is your first time speaking with ${firstName}.`;
    } else {
      const since = context.lastActiveAt ? timeSince(context.lastActiveAt) : "a while";
      relationshipContext = `OPENING MESSAGE CONTEXT:
You're reconnecting with ${firstName} after ${since}. This is your opening message of this session.
${context.recentTopics ? `Last time you were discussing: ${context.recentTopics}` : ""}

Write a natural, warm opening — like a caddy who's genuinely happy to see their player back. Reference the time gap and what you were working on if relevant. Ask one good question to re-engage them. Keep it to 2-3 sentences max. Don't say "Welcome back" as your literal first words — find a more natural way in.`;
    }
  }

  // Proactive use case suggestions for early relationships
  let proactiveContext = "";
  if (stage === "early" && !context.isGreeting) {
    proactiveContext = `
EARLY RELATIONSHIP — BE PROACTIVE:
${firstName} is new to working with you. You have ${context.messageCount} messages together so far. Be an active coach, not just a reactive one:
- If the conversation reaches a natural pause, suggest something you could help with. Examples:
  • "By the way — if you ever want to know which club to hit from a specific yardage, just ask me."
  • "I can help you build a practice plan whenever you're ready. Just say the word."
  • "Next time you're on the course, you can describe any shot that goes wrong and I'll help diagnose what happened."
- Pick ONE suggestion that fits the moment naturally. Don't list features like a brochure.
- Ask questions to learn more about their game — what they struggle with, what they enjoy, their goals.`;
  }

  // Build club distances section
  const clubSection = context.clubs.length > 0
    ? `\nPlayer's club distances:\n${context.clubs.map(c =>
        `- ${c.club_name}: ${c.expected_distance} yards${c.distance_source === "demographic_default" ? " (estimated)" : " (confirmed)"}`
      ).join("\n")}\nUse these distances when making club recommendations. If a distance seems off based on what the player tells you, update your recommendation accordingly.`
    : "";

  // Progressive profiling — what we still need to learn
  const profilingContext = context.missingProfileFields.length > 0 ? `
PROGRESSIVE PROFILING — FILL IN NATURALLY:
You still don't know: ${context.missingProfileFields.join(", ")}.
Collect these through conversation when they come up naturally — not as a form or a list of questions.
${context.missingProfileFields.includes("gender") || context.missingProfileFields.includes("age") ?
`For gender and age: bring these up the first time you give a club distance recommendation. Something like "By the way — distances vary a lot by age and whether you're a man or woman. Mind if I ask?" One question at a time.` : ""}
${context.missingProfileFields.includes("clubs") ?
`For clubs: when you first suggest a specific club, mention that you've estimated their distances but would love to know what they actually carry and how far they hit each one.` : ""}
Never ask for information you already have. Never ask multiple questions at once.` : "";

  return `${persona.personality}

${basePrompt}

Player profile:
- Name: ${profile.name}
- Handicap/Skill level: ${profile.handicap}
- Home course: ${profile.home_course}
- Gender: ${profile.gender || "not yet known"}
- Age group: ${profile.age_bracket || "not yet known"}
- Notes about their game: ${profile.player_notes || "none yet"}
${profile.frankie_prefs ? `\nPersonal preferences from this player: ${profile.frankie_prefs}` : ""}
${clubSection}
${relationshipContext ? `\n${relationshipContext}` : ""}
${proactiveContext}
${profilingContext}

RULES:
- Keep responses concise. The player is often on the course with one hand free.
- Lead with the actionable recommendation, then explain why if needed.
- Speak like a person, not a manual.
- Reference past conversations and what you know about their game whenever relevant.

HONESTY — CRITICAL:
- You can ONLY see and analyze content directly provided as text or images in this conversation.
- If a user shares a URL or video link, you CANNOT watch it, open it, or see its contents. Be honest about this. Say something like "I can't actually open that link — if you grab a screenshot or photo from the video, I can genuinely analyze that."
- Never pretend to have watched, seen, or analyzed something you haven't.
- If you don't know something, say so. Never fill gaps with plausible-sounding guesses presented as fact.

SCOPE — STAY ON GOLF:
- You are a golf caddy and instructor. That's your whole job.
- Light small talk and rapport-building is fine — a real caddy chats with their player.
- If a user tries to use you as a general-purpose AI, politely decline and redirect. "Ha — I'm flattered, but my expertise starts and ends at the first tee. What's going on with your game?"
- One off-topic exchange is fine. If they keep pushing, stay firm but warm.`;
}

// Generate a short speech summary for long responses
async function generateSpeech(anthropic: Anthropic, fullReply: string): Promise<string> {
  try {
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      system: "You summarize golf caddy responses into 1-2 short spoken sentences for text-to-speech. Be conversational, natural, and lead with the key point. No lists, no markdown.",
      messages: [{ role: "user", content: `Summarize this for speech (1-2 sentences max):\n\n${fullReply}` }],
    });
    return result.content[0].type === "text" ? result.content[0].text.trim() : fullReply;
  } catch {
    return fullReply;
  }
}

// Extract profile fields from conversation (including gender and age)
async function extractProfile(
  anthropic: Anthropic,
  conversationText: string,
  existing: Record<string, string | null>
): Promise<{ name?: string; handicap?: string; home_course?: string; gender?: string; age_bracket?: string }> {
  try {
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 250,
      system: `Extract golf player profile information from this conversation. Return ONLY a JSON object with these fields (omit any field you're not confident about):
- name: player's name
- handicap: handicap index or skill description
- home_course: name of their home course or where they usually play
- gender: "male", "female", or "other" — only if clearly stated
- age_bracket: "under_30", "30s", "40s", "50s", or "60_plus" — only if age or age range is mentioned
Return only valid JSON. Example: {"name": "Jeff", "handicap": "39", "home_course": "Genesee Valley", "gender": "male", "age_bracket": "50s"}`,
      messages: [{ role: "user", content: `Conversation:\n${conversationText}\n\nAlready known: ${JSON.stringify(existing)}` }],
    });
    const raw = result.content[0].type === "text" ? result.content[0].text.trim() : "{}";
    const text = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(text);
  } catch (err) {
    console.error("Profile extraction error:", err);
    return {};
  }
}

// Summarize recent conversation topics for returning user context
async function summarizeRecentTopics(
  anthropic: Anthropic,
  recentMessages: { role: string; content: string }[]
): Promise<string> {
  if (recentMessages.length === 0) return "";
  try {
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 80,
      system: "Summarize what was being discussed in this golf coaching conversation in one short phrase (e.g. 'weight transfer and iron contact', 'course management on par 3s', 'building a practice plan'). Be specific. Return only the phrase, no punctuation.",
      messages: [{
        role: "user",
        content: recentMessages.slice(-10).map(m => `${m.role}: ${m.content}`).join("\n")
      }],
    });
    return result.content[0].type === "text" ? result.content[0].text.trim() : "";
  } catch {
    return "";
  }
}

// Save plan tool definition
const savePlanTool: Anthropic.Tool = {
  name: "save_plan",
  description: "Save a practice plan for the player. Call this when you've created a structured practice plan and the player wants to save it for later reference.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Short descriptive title for the plan (e.g. 'Range Session - Weight Transfer')" },
      content: { type: "string", description: "The full practice plan content" },
    },
    required: ["title", "content"],
  },
};

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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch profile, history, settings, message count, and clubs in parallel
    const [profileResult, historyResult, settingsResult, countResult, clubsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("messages").select("role, content, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("settings").select("value").eq("key", "base_prompt").single(),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("clubs").select("club_name, expected_distance, distance_source").eq("user_id", user.id).order("sort_order"),
    ]);

    let profile = profileResult.data ?? {};
    const historyRaw = (historyResult.data ?? []).reverse();
    const history = historyRaw.map(m => ({ role: m.role, content: m.content }));
    const messageCount = countResult.count ?? 0;
    const lastActiveAt = historyRaw.length > 0 ? historyRaw[historyRaw.length - 1].created_at : null;
    const basePrompt = settingsResult.data?.value ?? "You are a knowledgeable golf caddy and instructor. Be concise and actionable.";
    const persona = getPersona(profile.persona);
    let clubs = clubsResult.data ?? [];

    // Save user message (skip for greeting)
    if (!isGreeting) {
      await supabase.from("messages").insert({ user_id: user.id, role: "user", content: message });
    }

    const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });

    // Extract profile fields from conversation (always, not just during onboarding)
    if (!isGreeting) {
      const conversationText = [
        ...history.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`),
        `user: ${message}`,
      ].join("\n");

      const extracted = await extractProfile(anthropic, conversationText, {
        name: profile.name ?? null,
        handicap: profile.handicap ?? null,
        home_course: profile.home_course ?? null,
        gender: profile.gender ?? null,
        age_bracket: profile.age_bracket ?? null,
      });

      const updated: Record<string, string | null> = {
        name: extracted.name || profile.name || null,
        handicap: extracted.handicap || profile.handicap || null,
        home_course: extracted.home_course || profile.home_course || null,
        gender: extracted.gender || profile.gender || null,
        age_bracket: extracted.age_bracket || profile.age_bracket || null,
      };

      const hasChanges = Object.keys(updated).some(k => updated[k] !== (profile as Record<string, string | null>)[k]);

      if (hasChanges) {
        const { error: upsertError } = await supabase.from("profiles").upsert({
          id: user.id,
          ...updated,
          player_notes: profile.player_notes,
          frankie_prefs: profile.frankie_prefs,
          persona: profile.persona || "frankie",
          clubs_seeded: profile.clubs_seeded ?? false,
          updated_at: new Date().toISOString(),
        });
        if (upsertError) console.error("Profile upsert error:", upsertError);
        profile = { ...profile, ...updated };
      }

      // Seed clubs if we have enough info and haven't done it yet
      if (!profile.clubs_seeded && profile.handicap && clubs.length === 0) {
        const gender = (profile.gender as Gender) || "male";
        const age = (profile.age_bracket as AgeGroup) || "30s";
        const clubsToInsert = seedClubs(profile.handicap, gender, age).map(c => ({
          ...c,
          user_id: user.id,
        }));
        const { error: clubsError } = await supabase.from("clubs").insert(clubsToInsert);
        if (!clubsError) {
          await supabase.from("profiles").update({ clubs_seeded: true }).eq("id", user.id);
          profile = { ...profile, clubs_seeded: true };
          clubs = clubsToInsert.map(c => ({
            club_name: c.club_name,
            expected_distance: c.expected_distance,
            distance_source: c.distance_source,
          }));
        }
      }
    }

    // For returning user greetings, summarize recent topics
    let recentTopics = "";
    const isReturningUser = isGreeting && messageCount > 0 && isProfileComplete(profile as Record<string, string | null>);
    if (isReturningUser && history.length > 0) {
      recentTopics = await summarizeRecentTopics(anthropic, history);
    }

    // Determine what profile info is still missing
    const missingProfileFields: string[] = [];
    if (!profile.gender) missingProfileFields.push("gender");
    if (!profile.age_bracket) missingProfileFields.push("age");
    if (clubs.length === 0) missingProfileFields.push("clubs");

    // Build system prompt
    const profileComplete = isProfileComplete(profile as Record<string, string | null>);
    const systemPromptText = profileComplete
      ? buildSystemPrompt(basePrompt, persona, profile, {
          isGreeting: !!isGreeting,
          messageCount,
          lastActiveAt,
          recentTopics,
          clubs,
          missingProfileFields,
        })
      : buildOnboardingPrompt(profile, isGreeting || history.length === 0);

    // Detect video/media URLs
    const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
    const VIDEO_HOSTS = ["icloud.com", "photos.google.com", "youtube.com", "youtu.be", "vimeo.com", "dropbox.com", "drive.google.com"];
    const containsVideoUrl = !isGreeting && URL_REGEX.test(message) &&
      VIDEO_HOSTS.some(host => message.toLowerCase().includes(host));

    const annotatedMessage = containsVideoUrl
      ? `${message}\n\n[SYSTEM NOTE: The user has shared a URL. You cannot open, watch, or view the contents of any link. Be honest about this limitation and suggest they share a screenshot or photo instead.]`
      : message;

    // Build messages with prompt caching
    const historyMessages = history.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const newMessage = isGreeting ? "Please give your opening message now." : annotatedMessage;

    const apiMessages: Anthropic.MessageParam[] = [
      ...historyMessages.slice(0, -1),
      ...(historyMessages.length > 0 ? [{
        role: historyMessages[historyMessages.length - 1].role as "user" | "assistant",
        content: [{
          type: "text" as const,
          text: historyMessages[historyMessages.length - 1].content,
          cache_control: { type: "ephemeral" as const },
        }],
      }] : []),
      { role: "user" as const, content: newMessage },
    ];

    // API call
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: [{ type: "text", text: systemPromptText, cache_control: { type: "ephemeral" } }],
      tools: [savePlanTool],
      messages: apiMessages,
    });

    let reply = "";
    let speech = "";
    let planSaved = false;

    if (response.stop_reason === "tool_use") {
      const toolBlock = response.content.find((b) => b.type === "tool_use");

      if (toolBlock && toolBlock.type === "tool_use" && toolBlock.name === "save_plan") {
        const input = toolBlock.input as { title: string; content: string };

        await supabase.from("practice_plans").insert({
          user_id: user.id,
          title: input.title,
          content: input.content,
        });
        planSaved = true;

        const followUp = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 512,
          system: [{ type: "text", text: systemPromptText, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool],
          messages: [
            ...apiMessages,
            { role: "assistant", content: response.content },
            {
              role: "user", content: [{
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: "Plan saved successfully.",
              }],
            },
          ],
        });

        reply = followUp.content.find((b) => b.type === "text")?.type === "text"
          ? (followUp.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
          : "";
      }
    } else {
      reply = response.content.find((b) => b.type === "text")?.type === "text"
        ? (response.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
        : "";
    }

    speech = reply.length > SPEECH_THRESHOLD
      ? await generateSpeech(anthropic, reply)
      : reply;

    await supabase.from("messages").insert({ user_id: user.id, role: "assistant", content: reply });

    return NextResponse.json({
      reply,
      speech,
      voiceId: persona.voiceId,
      personaName: persona.name,
      planSaved,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
