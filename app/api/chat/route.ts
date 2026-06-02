import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { getPersona } from "@/lib/personas";

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

const SPEECH_THRESHOLD = 300; // characters — responses shorter than this are spoken as-is

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

  return `You are a golf caddy and instructor in the middle of a setup conversation.

${known.length > 0 ? `You already know: ${known.join(", ")}.` : ""}
You still need to find out: ${needed.join(", ")}.

${isFirstMessage
    ? "Start by introducing yourself in one sentence, then ask for their name."
    : `Ask for the next missing piece of information: ${needed[0]}. Do not introduce yourself — that already happened.`}

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
  }
): string {
  return `${persona.personality}

${basePrompt}

Player profile:
- Name: ${profile.name}
- Handicap/Skill level: ${profile.handicap}
- Home course: ${profile.home_course}
- Notes about their game: ${profile.player_notes || "none yet"}
${profile.frankie_prefs ? `\nPersonal preferences from this player: ${profile.frankie_prefs}` : ""}

RULES:
- Keep responses concise. The player is often on the course with one hand free.
- Lead with the actionable recommendation, then explain why if needed.
- Speak like a person, not a manual.

HONESTY — CRITICAL:
- You can ONLY see and analyze content that is directly provided to you as text or images in this conversation.
- If a user shares a URL or video link, you CANNOT watch it, open it, or see its contents. Be honest about this. Say something like "I can't actually open that link — if you grab a screenshot or photo from the video, I can genuinely analyze that."
- Never pretend to have watched, seen, or analyzed something you haven't. Never describe what you "see" in a video you were given a link to.
- If you don't know something, say so. Never fill gaps with plausible-sounding guesses presented as fact.

SCOPE — STAY ON GOLF:
- You are a golf caddy and instructor. That's your whole job.
- Light small talk and rapport-building is fine — a real caddy chats with their player.
- If a user tries to use you as a general-purpose AI (asks you to write code, help with work tasks, discuss unrelated topics at length, etc.), politely decline and redirect. Something like: "Ha — I'm flattered, but my expertise starts and ends at the first tee. What's going on with your game?"
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

// Extract profile fields from conversation
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
- name: player's name
- handicap: handicap index or skill description
- home_course: name of their home course or where they usually play
Return only valid JSON. Example: {"name": "Jeff", "handicap": "39", "home_course": "Genesee Valley Golf Club"}`,
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

    // Fetch profile, history, and base prompt in parallel
    const [profileResult, historyResult, settingsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("messages").select("role, content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("settings").select("value").eq("key", "base_prompt").single(),
    ]);

    let profile = profileResult.data ?? {};
    const history = (historyResult.data ?? []).reverse();
    const basePrompt = settingsResult.data?.value ?? "You are a knowledgeable golf caddy and instructor. Be concise and actionable.";
    const persona = getPersona(profile.persona);

    // Save user message (skip for greeting)
    if (!isGreeting) {
      await supabase.from("messages").insert({ user_id: user.id, role: "user", content: message });
    }

    const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });

    // During onboarding, extract profile fields
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
          frankie_prefs: profile.frankie_prefs,
          persona: profile.persona || "frankie",
          updated_at: new Date().toISOString(),
        });
        if (upsertError) console.error("Profile upsert error:", upsertError);
        profile = { ...profile, ...updated };
      }
    }

    // Build system prompt
    const systemPromptText = isProfileComplete(profile as Record<string, string | null>)
      ? buildSystemPrompt(basePrompt, persona, profile)
      : buildOnboardingPrompt(profile, isGreeting || history.length === 0);

    // Detect video/media URLs and annotate the message so Frankie knows she can't view them
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

    const newMessage = isGreeting ? "hello" : annotatedMessage;

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

    // First API call
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

        // Follow-up after saving plan
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

    // Generate short speech version if reply is long; otherwise speak it as-is
    speech = reply.length > SPEECH_THRESHOLD
      ? await generateSpeech(anthropic, reply)
      : reply;

    // Save Frankie's reply
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
