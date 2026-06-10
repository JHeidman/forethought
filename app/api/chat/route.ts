import { NextRequest, NextResponse, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { getPersona } from "@/lib/personas";
import { seedClubs, type Gender, type AgeGroup } from "@/lib/club-defaults";
import { getCourseDetail, formatScorecardForPrompt } from "@/lib/golf-course-api";
import { getMainModel, getUtilityModel } from "@/lib/model-router";
import { assessShotDistance } from "@/lib/gps";
import { matchClubToBag } from "@/lib/shot-detection";
import { buildAnnouncementsBlock, type AnnouncementItem } from "@/lib/announcements";

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

const SPEECH_THRESHOLD = 600;

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
    goal?: string | null;
  },
  context: {
    isGreeting: boolean;
    messageCount: number;
    lastActiveAt: string | null;
    recentTopics: string;
    clubs: Array<{
    club_name: string;
    expected_distance: number;
    carry_distance?: number | null;
    distance_source: string;
    brand?: string | null;
    club_model?: string | null;
    loft?: number | null;
    lie_angle?: number | null;
    shaft_flex?: string | null;
    shaft_material?: string | null;
    confidence?: number | null;
    typical_shape?: string | null;
    notes?: string | null;
  }>;
    missingProfileFields: string[];
    scorecardContext: string;
    planIngredients: PlanIngredients;
    seasonPlan: string | null;
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

  // Build club section — richer when data is available
  const clubSection = context.clubs.length > 0 ? (() => {
    const lines = context.clubs.map(c => {
      const estimated = c.distance_source === "demographic_default";
      const equipment = (c.brand && c.club_model) ? `${c.brand} ${c.club_model}` : null;
      const specs: string[] = [];
      if (c.loft) specs.push(`${c.loft}°`);
      if (c.lie_angle) specs.push(`lie ${c.lie_angle}°`);
      if (c.shaft_flex) specs.push(c.shaft_flex);
      if (c.shaft_material) specs.push(c.shaft_material);
      const specsStr = specs.length > 0 ? ` (${specs.join(", ")})` : "";
      const distStr = c.carry_distance
        ? `carry ${c.carry_distance} | total ${c.expected_distance} yds`
        : `${c.expected_distance} yds${estimated ? " (estimated)" : ""}`;
      const feel: string[] = [];
      if (c.confidence) feel.push(`confidence ${c.confidence}/5`);
      if (c.typical_shape) feel.push(`shape: ${c.typical_shape.toLowerCase()}`);
      const feelStr = feel.length > 0 ? ` [${feel.join(", ")}]` : "";
      const notesStr = c.notes ? ` — ${c.notes}` : "";
      const equipStr = equipment ? ` ${equipment}${specsStr}` : "";
      return `- ${c.club_name}:${equipStr} ${distStr}${feelStr}${notesStr}`;
    }).join("\n");

    const hasConfidence = context.clubs.some(c => c.confidence);
    const hasShape = context.clubs.some(c => c.typical_shape);

    let guidance = "Use these distances when recommending clubs.";
    if (hasConfidence) guidance += " Respect confidence ratings — avoid recommending low-confidence clubs in pressure situations unless the player asks.";
    if (hasShape) guidance += " Account for shot shape when advising on aim and club selection — a player who fades the driver should aim accordingly.";
    guidance += " If a distance seems off based on what the player tells you, trust what they say over the data.";

    return `\nPlayer's bag:\n${lines}\n${guidance}`;
  })() : "";

  // Progressive profiling — what we still need to learn
  const needsGenderOrAge = context.missingProfileFields.includes("gender") || context.missingProfileFields.includes("age");
  const needsClubs = context.missingProfileFields.includes("clubs");
  const needsGoal = context.missingProfileFields.includes("goal");
  const profilingContext = context.missingProfileFields.length > 0 ? `
PROGRESSIVE PROFILING — YOU NEED TO LEARN THESE THINGS:
You still don't know: ${context.missingProfileFields.join(", ")}.
${needsGenderOrAge ? `
AGE & GENDER — ask this in your NEXT response if you haven't already this session. Weave it in naturally at the end of whatever you're saying. Example: "By the way — to give you the best club recommendations, it helps to know a bit more about you. Are you a guy or a woman? And roughly what age range?" Just one casual question, friendly tone. Don't make it feel like a form.` : ""}
${needsClubs ? `
CLUBS — once you know their age and gender (or if they've already answered), ask about their bag in your next 1-2 responses. Something like: "I've got some estimated distances for your clubs, but I'd love to know what you actually carry. What's in your bag? And do you have a rough sense of how far you hit your 7-iron?" Keep it conversational.` : ""}
${needsGoal ? `
PLAYER GOAL — this is important. Within the first few conversations, gently explore what the player is working toward this season. Ask something like: "What would a great golf season look like for you?" or "Do you have a number you're chasing — like breaking 90 or getting to a certain handicap?" Don't push if they're not interested — if they deflect, note it and move on. But for most players, having a goal changes everything about how you coach them. Ask only if the conversation has reached a natural moment. Never as a cold first question.` : ""}
IMPORTANT: Ask only ONE thing per response. Never ask multiple questions at once. Don't repeat a question you've already asked this session.` : "";

  const goalSection = profile.goal
    ? `PLAYER'S SEASON GOAL: "${profile.goal}"
This is what ${firstName} is working toward. Let it inform your coaching — connect advice, practice plans, and feedback to this goal where natural. Don't mention it every message, but it should be your north star. Celebrate progress toward it. Flag when something is directly relevant to achieving it.`
    : `PLAYER GOAL: Not yet known.
This is important context you're still missing. Within the first few sessions, explore what they're working toward. A good opener: "What would a great golf season look like for you?" Many players have a score they want to break — once you know their goal, everything you coach becomes more meaningful.`;

  const planContext = buildPlanContext(profile.goal ?? null, context.planIngredients, context.seasonPlan, firstName);

  return `${persona.personality}

${profilingContext}

${basePrompt}

Player profile:
- Name: ${profile.name}
- Handicap/Skill level: ${profile.handicap}
- Home course: ${profile.home_course}
- Gender: ${profile.gender || "not yet known"}
- Age group: ${profile.age_bracket || "not yet known"}
- Season goal: ${profile.goal || "not yet set"}
- GPS/scoring app: ${(profile as Record<string, string | null>).scoring_app || "not yet known"}
- Notes about their game: ${profile.player_notes || "none yet"}
- AI coaching notes (auto-generated from past sessions): ${(profile as Record<string, string | null>).ai_notes || "none yet — will build over time"}
${profile.frankie_prefs ? `\nPersonal preferences from this player: ${profile.frankie_prefs}` : ""}

${goalSection}
${clubSection}
${context.scorecardContext ? `\n${context.scorecardContext}` : ""}
${relationshipContext ? `\n${relationshipContext}` : ""}
${proactiveContext}

${planContext}

${context.scorecardContext ? `ON-COURSE MODE — CRITICAL:
The player is actively on the golf course right now. Adjust your entire style:
- Keep every response to 2-3 sentences maximum. No exceptions.
- Lead with the answer, skip the preamble. "Take the 7-iron, aim at the left edge" not "Great question! Given the conditions and your distances, I'd suggest..."
- Speak like a caddy standing next to them, not a coach in a lesson. Punchy, direct, confident.
- They cannot read long text while playing. Everything you say will be spoken aloud.
- You track shot distances via GPS automatically. When you get shot data (see SHOT TRACKING block), react to it naturally — confirm good shots, gently ask about mishits. Don't announce "I've logged your shot" — just act on the data.
- Whenever the player describes a shot they just hit — direction, feel, result, anything — call note_shot silently alongside your reply. "Dead left", "caught it thin", "straight but short", "shanked it" — all worth capturing. You don't need to tell them you're doing it.
- If the description also confirms a mishit (fat, thin, topped, shank, etc.), call BOTH note_shot AND mark_mishit.

${(() => {
  const app = (profile as Record<string, string | null>).scoring_app;
  if (app && app !== "none") {
    return `GPS & SCORING APP: The player uses ${app} for distances and scoring. Do NOT offer to keep score or tell them distances to pin — ${app} handles that. Your job is club selection, strategy, and coaching. When they tell you their yardage (which they got from ${app}), trust it and give your best advice.`;
  } else if (!app) {
    return `GPS & SCORING APP: You don't know yet whether the player uses a GPS or scoring app. Early in this round, ask naturally — something like: "Are you running USwing or another app today, or do you want me to track things?" One casual question. If they use an app, you can focus purely on the caddy stuff. If not, offer to keep score.`;
  } else {
    return `GPS & SCORING APP: The player doesn't use a GPS or scoring app. You can offer to keep score if the conversation calls for it, and rely on what they tell you for distances.`;
  }
})()}
` : ""}RANGE / PRACTICE MODE:
If the player indicates they're at the range, on a practice green, or working on something specific (e.g. "I'm at the range", "heading to practice", "working on my driver today"), automatically shift into practice mode for that session:
- Be more iterative and conversational. After giving advice, ask a follow-up: "How did that feel?" or "What happened on the last one?"
- You can go a bit deeper — explain the drill, what to feel for, what to watch.
- Think of it as a lesson, not a quick answer. You have the player's full attention.
- Keep responses focused but don't artificially cut them short. 3-5 sentences is fine.
- Help them build a feedback loop: try something → report back → adjust → repeat.
You don't need to be told explicitly. Pick it up from context and just adjust.

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
      model: getUtilityModel(),
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
): Promise<{ name?: string; handicap?: string; home_course?: string; gender?: string; age_bracket?: string; goal?: string; scoring_app?: string }> {
  try {
    const result = await anthropic.messages.create({
      model: getUtilityModel(),
      max_tokens: 300,
      system: `Extract golf player profile information from this conversation. Return ONLY a JSON object with these fields (omit any field you're not confident about):
- name: player's name
- handicap: handicap index or skill description
- home_course: name of their home course or where they usually play
- gender: "male", "female", or "other" — only if clearly stated
- age_bracket: "under_30", "30s", "40s", "50s", or "60_plus" — only if age or age range is mentioned
- goal: their season or improvement goal in their own words — e.g. "break 90 by end of summer", "get to a 15 handicap", "stop embarrassing myself at work scrambles". Only capture if clearly stated. Keep it short and in their voice.
- scoring_app: the name of any GPS or scoring app they use on the course — e.g. "USwing", "18Birdies", "Golfshot", "Golf Pad", "Arccos". Only if clearly mentioned. Use "none" if they explicitly say they don't use one.
Return only valid JSON. Example: {"name": "Jeff", "handicap": "39", "home_course": "Genesee Valley", "gender": "male", "age_bracket": "50s", "goal": "break 80 this season", "scoring_app": "18Birdies"}`,
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
      model: getUtilityModel(),
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

// Async fire-and-forget: extract coaching insights from recent conversation and append to ai_notes
async function updateAiNotes(
  userId: string,
  anthropic: Anthropic,
  supabaseUrl: string,
  supabaseKey: string,
  existingAiNotes: string | null
): Promise<void> {
  try {
    const serviceKey = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    console.log("[updateAiNotes] start — userId:", userId, "hasServiceKey:", !!serviceKey);

    const { createClient } = await import("@supabase/supabase-js");
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch last 30 messages for this user
    const { data: messages, error: msgErr } = await adminClient
      .from("messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (msgErr) { console.error("[updateAiNotes] messages fetch error:", msgErr); return; }
    if (!messages || messages.length < 5) { console.log("[updateAiNotes] not enough messages:", messages?.length); return; }

    console.log("[updateAiNotes] summarizing", messages.length, "messages");

    const conversation = messages.reverse()
      .map((m: { role: string; content: string }) => `${m.role === "user" ? "Player" : "Caddy"}: ${m.content}`)
      .join("\n");

    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const result = await anthropic.messages.create({
      model: getUtilityModel(),
      max_tokens: 300,
      system: `You are reviewing a golf coaching conversation to extract key insights about this player's game.

Extract ONLY new, specific, concrete information not already in the existing notes.
Focus on: swing issues identified and fixes tried, progress made or breakthroughs, goals or focus areas mentioned, courses played or scores, anything the player asked to remember, changes in skill level.

Format as 1-3 bullet points starting with "• ", prefixed with today's date (${today}).
Example: "• ${today}: Fixed weight transfer using finish-hold drill. Still struggling with driver contact."

If nothing new and meaningful was learned in this conversation, return exactly: NOTHING_NEW

Existing notes:
${existingAiNotes || "None yet."}`,
      messages: [{ role: "user", content: `Recent conversation:\n\n${conversation}` }],
    });

    const extracted = result.content[0].type === "text" ? result.content[0].text.trim() : "";
    console.log("[updateAiNotes] extracted:", extracted.slice(0, 100));
    if (!extracted || extracted === "NOTHING_NEW") return;

    const updatedNotes = existingAiNotes
      ? `${existingAiNotes}\n${extracted}`
      : extracted;

    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ ai_notes: updatedNotes })
      .eq("id", userId);

    if (updateErr) console.error("[updateAiNotes] update error:", updateErr);
    else console.log("[updateAiNotes] saved notes successfully");

  } catch (err) {
    console.error("[updateAiNotes] caught error:", err);
  }
}

// ── Season plan helpers ──────────────────────────────────────────────────────

type PlanIngredients = {
  scoring_range?: string;
  strokes_lost?: string;
  round_frequency?: string;
  practice_frequency?: string;
  time_horizon?: string;
  biggest_weakness?: string;
};

function hasEnoughForPlan(goal: string | null, ing: PlanIngredients): boolean {
  if (!goal) return false;
  if (!ing.scoring_range) return false;
  const extras = ["strokes_lost", "round_frequency", "practice_frequency", "biggest_weakness"] as const;
  return extras.filter(k => ing[k]).length >= 2;
}

function getNextPlanQuestion(ing: PlanIngredients): { field: string; question: string } | null {
  const queue: Array<{ field: keyof PlanIngredients; question: string }> = [
    {
      field: "scoring_range",
      question: "What do you typically shoot? Not your best round — just an honest average.",
    },
    {
      field: "strokes_lost",
      question: "If you had to be honest about where most of your strokes go — is it the driver, short game, putting, or blow-up holes?",
    },
    {
      field: "round_frequency",
      question: "How often do you actually get out and play?",
    },
    {
      field: "practice_frequency",
      question: "How often do you want to practice — range, putting green, chipping area? Never is a totally valid answer. I just want to build something you'll actually do.",
    },
    {
      field: "biggest_weakness",
      question: "If you could fix one thing about your game overnight, what would it be?",
    },
  ];
  return queue.find(q => !ing[q.field]) ?? null;
}

function buildPlanContext(
  goal: string | null,
  ing: PlanIngredients,
  existingPlan: string | null,
  firstName: string
): string {
  if (!goal) return "";

  const known: string[] = [];
  if (ing.scoring_range) known.push(`scoring: ${ing.scoring_range}`);
  if (ing.strokes_lost) known.push(`where strokes go: ${ing.strokes_lost}`);
  if (ing.round_frequency) known.push(`plays: ${ing.round_frequency}`);
  if (ing.practice_frequency) known.push(`practices: ${ing.practice_frequency}`);
  if (ing.time_horizon) known.push(`timeline: ${ing.time_horizon}`);
  if (ing.biggest_weakness) known.push(`self-reported weakness: ${ing.biggest_weakness}`);

  const next = getNextPlanQuestion(ing);
  const enough = hasEnoughForPlan(goal, ing);

  let section = `\nSEASON PLAN BUILDING:
Goal: "${goal}"
Plan ingredients you've gathered so far: ${known.length > 0 ? known.join(", ") : "none yet"}
`;

  if (existingPlan) {
    section += `\nA season plan already exists for ${firstName}. Reference it naturally when relevant. If something significant changes (handicap improvement, new focus area), offer to update it using the save_season_plan tool.\n`;
  } else if (enough) {
    section += `\nYou have enough information to draft ${firstName}'s season plan. When the conversation reaches a natural moment — not forced — say something like: "I've been paying attention to what you've told me, and I think I have enough to put together a real roadmap for getting you to your goal. Want to hear it?" If they say yes, generate it and save it using the save_season_plan tool.\n`;
  } else if (next) {
    section += `\nNext ingredient to gather: ${next.field}
Suggested question (use your own voice, not verbatim): "${next.question}"
Ask this naturally when the conversation allows — not as an interrogation. ONE question per response. Only ask if the conversation has a natural pause or opening.\n`;
  }

  if (!existingPlan) {
    section += `\nIf ${firstName} explicitly asks for a plan, roadmap, or "how do I get there" — generate it immediately using save_season_plan, noting any assumptions you had to make.\n`;
  }

  return section;
}

// Extract plan ingredients from conversation
async function extractPlanIngredients(
  anthropic: Anthropic,
  conversationText: string,
  existing: PlanIngredients
): Promise<PlanIngredients> {
  try {
    const result = await anthropic.messages.create({
      model: getUtilityModel(),
      max_tokens: 200,
      system: `Extract golf improvement plan information from this conversation. Return ONLY a JSON object with these fields (omit any you're not confident about — do not guess):
- scoring_range: what they typically shoot, e.g. "98-104", "low 90s", "mid-80s"
- strokes_lost: where most strokes go, e.g. "short game and blow-up holes", "putting and driver"
- round_frequency: how often they play, e.g. "once a week", "2-3 times a month", "rarely"
- practice_frequency: how often they practice, e.g. "never", "once a week", "a few times a month"
- time_horizon: when they want to reach their goal, e.g. "end of summer", "by September", "this year"
- biggest_weakness: self-identified weakness, e.g. "short game", "mental game", "driver consistency"
Return only valid JSON. Already known: ${JSON.stringify(existing)}`,
      messages: [{ role: "user", content: conversationText }],
    });
    const raw = result.content[0].type === "text" ? result.content[0].text.trim() : "{}";
    const text = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);
    // Merge: only overwrite if new value is non-empty
    const merged: PlanIngredients = { ...existing };
    for (const k of Object.keys(parsed) as Array<keyof PlanIngredients>) {
      if (parsed[k] && !existing[k]) merged[k] = parsed[k];
    }
    return merged;
  } catch {
    return existing;
  }
}

// Save practice plan tool
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

// Save season plan tool
const saveSeasonPlanTool: Anthropic.Tool = {
  name: "save_season_plan",
  description: "Generate and save the player's season improvement roadmap. Call this when: (1) the player explicitly asks for a plan or roadmap, OR (2) you've gathered enough information about their game and you're offering to share what you've put together. The plan should be realistic, honest, and calibrated to their actual practice/play habits.",
  input_schema: {
    type: "object" as const,
    properties: {
      plan: {
        type: "string",
        description: `The full season plan. Format it like this (use emoji headers):

🎯 Goal: [restate their goal]

📊 The Honest Diagnosis
[2-3 sentences about where strokes are going, based on what they told you]

🔧 The Priority Stack
[3 priorities in ROI order — what to fix first for maximum strokes saved. Brief, actionable.]

📅 Realistic Milestones
[2-3 milestones calibrated to their actual play and practice frequency. Be honest — if they rarely practice, say so and adjust expectations accordingly.]

💡 This Week
[One specific, concrete thing to try right now. Not a list — just one thing.]

Write directly to the player. Be honest. If they said they never practice, build a plan that works without practice. Keep it under 350 words.`
      },
    },
    required: ["plan"],
  },
};

type ShotContext = {
  announcedClub: string;
  lastShotClub: string | null;
  lastShotDistanceYards: number | null;
  lastShotGpsStart: { lat: number; lon: number } | null;
  lastShotGpsEnd: { lat: number; lon: number } | null;
  gpsAccuracyMeters: number | null;
};

function buildShotTrackingBlock(
  shotContext: ShotContext,
  clubs: Array<{ club_name: string; expected_distance: number }>
): string {
  const lines: string[] = ["SHOT TRACKING (this message):"];
  lines.push(`Player is about to hit: ${shotContext.announcedClub}`);

  const accuracyOk = shotContext.gpsAccuracyMeters !== null && shotContext.gpsAccuracyMeters <= 20;
  if (shotContext.gpsAccuracyMeters !== null) {
    lines.push(`GPS accuracy: ${Math.round(shotContext.gpsAccuracyMeters)}m ${accuracyOk ? "(reliable)" : "(poor — distance reading may be off)"}`);
  }

  if (shotContext.lastShotClub && shotContext.lastShotDistanceYards !== null) {
    const matchedClub = matchClubToBag(shotContext.lastShotClub, clubs);
    const clubData = clubs.find(c => c.club_name.toLowerCase() === matchedClub.toLowerCase());
    const expected = clubData?.expected_distance ?? 0;
    const measured = shotContext.lastShotDistanceYards;

    lines.push(`\nPrevious shot: ${shotContext.lastShotClub}`);
    lines.push(`  GPS-measured distance: ${measured} yards`);
    if (expected > 0) lines.push(`  Expected distance: ${expected} yards`);

    if (accuracyOk && measured > 15) {
      const assessment = assessShotDistance(measured, expected);
      lines.push(`  Assessment: ${assessment.label}`);

      if (assessment.isOutlier) {
        if (assessment.isShort) {
          lines.push(`\nThis shot was significantly shorter than expected. Ask naturally — one brief question — something like: "That ${shotContext.lastShotClub} came up short — mishit, or did it hit something?" If they confirm a mishit, note it. Don't lecture.`);
        } else {
          lines.push(`\nThis shot was significantly longer than expected. Ask naturally — one brief question — something like: "That ${shotContext.lastShotClub} went a long way — perfect strike, or did it get a bounce?" If it was genuinely good contact, update your mental model.`);
        }
      } else {
        lines.push(`Distance is normal — no need to comment on it. Just give pre-shot advice for the ${shotContext.announcedClub}.`);
      }
    } else if (!accuracyOk) {
      lines.push(`GPS accuracy was poor — don't report or comment on this distance. Just give pre-shot advice.`);
    } else if (measured <= 15) {
      lines.push(`Distance too short to be a real shot (likely just walking) — ignore it.`);
    }
  } else {
    lines.push(`\nNo previous shot data yet this round — this is likely the first shot or tee shot.`);
  }

  return lines.join("\n");
}

// ── Distance learning helpers ────────────────────────────────────────────────

type DistanceProposal = {
  club_name: string;
  currentDistance: number;
  proposedDistance: number;
  shotCount: number;
  percentDiff: number;
};

function calculateDistanceProposals(
  clubs: Array<{ club_name: string; expected_distance: number }>,
  shotHistory: Array<{ club_name: string; distance_yards: number }>
): DistanceProposal[] {
  // Group shots by club
  const byClub: Record<string, number[]> = {};
  for (const shot of shotHistory) {
    if (!byClub[shot.club_name]) byClub[shot.club_name] = [];
    byClub[shot.club_name].push(shot.distance_yards);
  }

  const proposals: DistanceProposal[] = [];

  for (const club of clubs) {
    const shots = byClub[club.club_name.toLowerCase()] ??
                  byClub[club.club_name] ?? [];
    if (shots.length < 5) continue; // need at least 5 shots for signal

    // Trimmed median: sort, drop top/bottom 15%
    const sorted = [...shots].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.15);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const proposed = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);

    const percentDiff = Math.round(((proposed - club.expected_distance) / club.expected_distance) * 100);
    if (Math.abs(percentDiff) < 8) continue; // not significant enough to mention

    proposals.push({
      club_name: club.club_name,
      currentDistance: club.expected_distance,
      proposedDistance: proposed,
      shotCount: shots.length,
      percentDiff,
    });
  }

  return proposals;
}

function buildDistanceLearningBlock(proposals: DistanceProposal[]): string {
  if (proposals.length === 0) return "";

  const lines = ["DISTANCE LEARNING — GPS DATA SUGGESTS UPDATES NEEDED:"];
  lines.push("Based on GPS-measured shots, these clubs show a consistent difference from what's on file:");

  for (const p of proposals) {
    const dir = p.percentDiff > 0 ? "longer" : "shorter";
    lines.push(`- ${p.club_name}: on file ${p.currentDistance} yds → GPS average ${p.proposedDistance} yds (${Math.abs(p.percentDiff)}% ${dir}, from ${p.shotCount} shots)`);
  }

  lines.push(`
At a natural moment in this conversation — ideally when one of these clubs comes up, or at the end of a round — bring this up. Be specific about what you've observed. Explain that it could be affecting your recommendations. Ask if they want you to update the numbers. Something like:

"I've been watching your [club] and you're consistently getting [X yards], not the [Y yards] I had on file. That might be why I've been sending you one club short. Want me to update that?"

Or for multiple clubs: name them together — "your 7-iron and 8-iron are both running longer than I had..."

If they say yes → call update_club_distances with ONLY the clubs they confirmed.
If they say no or not now → acknowledge it and move on. Don't push.

IMPORTANT: Never call update_club_distances without explicit player confirmation. Never bring this up mid-shot or in the middle of answering something else. Wait for a natural opening.`);

  return lines.join("\n");
}

// ── Distance learning tools ───────────────────────────────────────────────────

const updateClubDistancesTool: Anthropic.Tool = {
  name: "update_club_distances",
  description: "Update expected distances for one or more clubs based on GPS-measured shot data. Only call this AFTER the player has explicitly confirmed they want the update. Never call proactively.",
  input_schema: {
    type: "object" as const,
    properties: {
      updates: {
        type: "array",
        description: "Clubs to update",
        items: {
          type: "object",
          properties: {
            club_name: { type: "string", description: "Exact club name as it appears in their bag" },
            new_distance: { type: "number", description: "New expected distance in yards" },
          },
          required: ["club_name", "new_distance"],
        },
      },
    },
    required: ["updates"],
  },
};

const markMishitTool: Anthropic.Tool = {
  name: "mark_mishit",
  description: "Mark the player's most recent shot with a specific club as a mishit, excluding it from distance calculations. Call this when the player confirms a shot was mishit.",
  input_schema: {
    type: "object" as const,
    properties: {
      club_name: { type: "string", description: "The club that was mishit" },
      description: { type: "string", description: "How it was mishit — e.g. 'fat', 'thin', 'topped', 'heel'" },
    },
    required: ["club_name"],
  },
};

const noteShotTool: Anthropic.Tool = {
  name: "note_shot",
  description: "Record the player's description of a shot they just hit — direction, feel, result, etc. Call this whenever the player describes a shot outcome, even briefly. Examples: 'dead left', 'straight but short', 'felt great, landed pin high', 'shanked it right'. Does NOT mark as a mishit or affect distance calculations — use mark_mishit for that.",
  input_schema: {
    type: "object" as const,
    properties: {
      club_name: { type: "string", description: "The club that was hit" },
      notes: { type: "string", description: "The player's description of the shot in their own words — direction, feel, result" },
    },
    required: ["club_name", "notes"],
  },
};

// Fire-and-forget: save a completed shot to shot_history
async function saveShotToHistory(
  userId: string,
  shotContext: ShotContext,
  supabaseUrl: string,
  supabaseKey: string
): Promise<void> {
  if (!shotContext.lastShotClub || shotContext.lastShotDistanceYards === null) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await client.from("shot_history").insert({
      user_id: userId,
      club_name: shotContext.lastShotClub,
      distance_yards: shotContext.lastShotDistanceYards,
      gps_start: shotContext.lastShotGpsStart,
      gps_end: shotContext.lastShotGpsEnd,
      source: "on_course",
    });
  } catch (err) {
    console.error("saveShotToHistory error:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { message, isGreeting, roundContext, shotContext } = await req.json();
    // roundContext: { courseId, courseName, tee, conditions } — injected when player is on course
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

    // Fetch profile, history, settings, message count, clubs, plan data, and unread announcements in parallel
    // Shot history only fetched on-course — needed for distance learning proposals
    const [profileResult, historyResult, settingsResult, countResult, clubsResult, shotHistoryResult, announcementsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("messages").select("role, content, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("settings").select("value").eq("key", "base_prompt").single(),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("clubs").select("club_name, expected_distance, carry_distance, distance_source, brand, club_model, loft, lie_angle, shaft_flex, shaft_material, confidence, typical_shape, notes").eq("user_id", user.id).order("sort_order"),
      roundContext
        ? supabase.from("shot_history").select("club_name, distance_yards").eq("user_id", user.id).eq("is_mishit", false).gt("distance_yards", 10)
        : Promise.resolve({ data: [] as Array<{ club_name: string; distance_yards: number }> }),
      // Only fetch unread announcements on greeting (first message of session)
      isGreeting
        ? (async () => {
            const allRes = await supabase.from("announcements").select("*").eq("is_active", true).order("created_at", { ascending: false });
            const all = allRes.data ?? [];
            if (!all.length) return { data: [] };
            const readsRes = await supabase.from("user_announcement_reads").select("announcement_id").eq("user_id", user.id);
            const readIds = new Set((readsRes.data ?? []).map((r: { announcement_id: string }) => r.announcement_id));
            return { data: all.filter((a: { id: string }) => !readIds.has(a.id)) };
          })()
        : Promise.resolve({ data: [] }),
    ]);

    let profile = profileResult.data ?? {};
    const historyRaw = (historyResult.data ?? []).reverse();
    const history = historyRaw.map(m => ({ role: m.role, content: m.content }));
    const messageCount = countResult.count ?? 0;
    const lastActiveAt = historyRaw.length > 0 ? historyRaw[historyRaw.length - 1].created_at : null;
    const basePrompt = settingsResult.data?.value ?? "You are a knowledgeable golf caddy and instructor. Be concise and actionable.";
    const persona = getPersona(profile.persona);
    let clubs = clubsResult.data ?? [];
    const shotHistory = (shotHistoryResult as { data: Array<{ club_name: string; distance_yards: number }> | null }).data ?? [];
    const distanceProposals = roundContext && clubs.length > 0
      ? calculateDistanceProposals(clubs as Array<{ club_name: string; expected_distance: number }>, shotHistory)
      : [];
    let planIngredients: PlanIngredients = (profile.plan_ingredients as PlanIngredients) ?? {};
    const seasonPlan: string | null = profile.season_plan ?? null;
    const unreadAnnouncements: AnnouncementItem[] = (announcementsResult as { data: AnnouncementItem[] }).data ?? [];

    // Save user message (skip for greeting)
    if (!isGreeting) {
      await supabase.from("messages").insert({ user_id: user.id, role: "user", content: message });
    }

    const anthropic = new Anthropic({ apiKey: getEnvVar("ANTHROPIC_API_KEY") });

    // Run profile extraction and topic summary in parallel with each other
    // but BEFORE the main Claude call so we have fresh profile data
    const conversationText = !isGreeting ? [
      ...history.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`),
      `user: ${message}`,
    ].join("\n") : "";

    const isReturningUser = isGreeting && messageCount > 0 && isProfileComplete(profile as Record<string, string | null>);

    // Only extract profile if something might have changed (skip during greetings and on-course)
    // On-course: player is mid-round, no need to update profile between shots
    const needsExtraction = !isGreeting && !roundContext && (
      !isProfileComplete(profile as Record<string, string | null>) ||
      !profile.gender ||
      !profile.age_bracket ||
      !profile.goal ||
      !profile.scoring_app
    );

    // Extract plan ingredients when we have a goal and plan isn't complete yet (skip on-course)
    const needsIngredients = !isGreeting && !roundContext && !!profile.goal && !hasEnoughForPlan(profile.goal ?? null, planIngredients);

    const [extractedProfile, recentTopics, updatedIngredients] = await Promise.all([
      needsExtraction
        ? extractProfile(anthropic, conversationText, {
            name: profile.name ?? null,
            handicap: profile.handicap ?? null,
            home_course: profile.home_course ?? null,
            gender: profile.gender ?? null,
            age_bracket: profile.age_bracket ?? null,
            goal: profile.goal ?? null,
          })
        : Promise.resolve({}),
      isReturningUser && history.length > 0
        ? summarizeRecentTopics(anthropic, history)
        : Promise.resolve(""),
      needsIngredients
        ? extractPlanIngredients(anthropic, conversationText, planIngredients)
        : Promise.resolve(planIngredients),
    ]);

    if (needsExtraction && Object.keys(extractedProfile).length > 0) {
      const updated: Record<string, string | null> = {
        name: (extractedProfile as Record<string, string>).name || profile.name || null,
        handicap: (extractedProfile as Record<string, string>).handicap || profile.handicap || null,
        home_course: (extractedProfile as Record<string, string>).home_course || profile.home_course || null,
        gender: (extractedProfile as Record<string, string>).gender || profile.gender || null,
        age_bracket: (extractedProfile as Record<string, string>).age_bracket || profile.age_bracket || null,
        goal: (extractedProfile as Record<string, string>).goal || profile.goal || null,
        scoring_app: (extractedProfile as Record<string, string>).scoring_app || profile.scoring_app || null,
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
          goal: updated.goal,
          scoring_app: updated.scoring_app,
          updated_at: new Date().toISOString(),
        });
        if (upsertError) console.error("Profile upsert error:", upsertError);
        profile = { ...profile, ...updated };
      }

      // Seed clubs if we now have enough info
      if (!profile.clubs_seeded && profile.handicap && clubs.length === 0) {
        const gender = (profile.gender as Gender) || "male";
        const age = (profile.age_bracket as AgeGroup) || "30s";
        const genderAssumed = !profile.gender;
        const ageAssumed = !profile.age_bracket;
        const clubsToInsert = seedClubs(profile.handicap, gender, age, genderAssumed, ageAssumed).map(c => ({ ...c, user_id: user.id }));
        const { error: clubsError } = await supabase.from("clubs").insert(clubsToInsert);
        if (!clubsError) {
          await supabase.from("profiles").update({ clubs_seeded: true }).eq("id", user.id);
          profile = { ...profile, clubs_seeded: true };
          clubs = clubsToInsert.map(c => ({
            club_name: c.club_name,
            expected_distance: c.expected_distance,
            carry_distance: null,
            distance_source: c.distance_source,
            brand: null,
            club_model: null,
            loft: null,
            lie_angle: null,
            shaft_flex: null,
            shaft_material: null,
            confidence: null,
            typical_shape: null,
            notes: null,
          }));
        }
      }
    }

    // Save updated plan ingredients if they changed
    if (needsIngredients && JSON.stringify(updatedIngredients) !== JSON.stringify(planIngredients)) {
      planIngredients = updatedIngredients;
      await supabase.from("profiles").update({ plan_ingredients: planIngredients }).eq("id", user.id);
    }

    // Load scorecard if player is on the course.
    // Use pre-fetched scorecardContext from the client when available (cached on round start)
    // to avoid hitting golfcourseapi.com on every message.
    let scorecardContext = "";
    if (roundContext?.courseId) {
      if (roundContext.scorecardContext) {
        // Fast path: client already has it
        scorecardContext = roundContext.scorecardContext;
      } else {
        // Fallback: fetch it (e.g. page reload mid-round)
        try {
          const course = await getCourseDetail(roundContext.courseId);
          if (course) {
            const gender = (profile.gender === "female" ? "female" : "male") as "male" | "female";
            scorecardContext = formatScorecardForPrompt(course, roundContext.tee ?? "White", gender);
          }
        } catch (err) {
          console.error("Scorecard load error:", err);
        }
      }
    }

    // Determine what profile info is still missing
    const missingProfileFields: string[] = [];
    if (!profile.gender) missingProfileFields.push("gender");
    if (!profile.age_bracket) missingProfileFields.push("age");
    if (clubs.length === 0) missingProfileFields.push("clubs");
    if (!profile.goal) missingProfileFields.push("goal");

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
          scorecardContext,
          planIngredients,
          seasonPlan,
        })
      : buildOnboardingPrompt(profile, isGreeting || history.length === 0);

    // Append on-course context blocks to system prompt
    const distanceLearningBlock = buildDistanceLearningBlock(distanceProposals);
    const shotTrackingBlock = shotContext?.announcedClub
      ? buildShotTrackingBlock(shotContext as ShotContext, clubs as Array<{ club_name: string; expected_distance: number }>)
      : "";

    // Announcements block — only on greeting when there are unread items
    const announcementsBlock = isGreeting && unreadAnnouncements.length > 0
      ? buildAnnouncementsBlock(unreadAnnouncements, profile.name?.split(" ")[0] ?? "there")
      : "";

    const finalSystemPrompt = [
      systemPromptText,
      announcementsBlock,
      distanceLearningBlock,
      shotTrackingBlock,
    ].filter(Boolean).join("\n\n");

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
    const isOnCourse = !!roundContext?.courseId;
    const activeModel = getMainModel(isOnCourse);
    const response = await anthropic.messages.create({
      model: activeModel,
      max_tokens: 1024,
      system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
      messages: apiMessages,
    });

    let reply = "";
    let speech = "";
    let planSaved = false;
    let seasonPlanSaved = false;

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
          model: activeModel,
          max_tokens: 512,
          system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
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

      } else if (toolBlock && toolBlock.type === "tool_use" && toolBlock.name === "save_season_plan") {
        const input = toolBlock.input as { plan: string };

        // Save season plan to profile
        await supabase.from("profiles").update({
          season_plan: input.plan,
          updated_at: new Date().toISOString(),
        }).eq("id", user.id);
        seasonPlanSaved = true;

        const followUp = await anthropic.messages.create({
          model: activeModel,
          max_tokens: 512,
          system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
          messages: [
            ...apiMessages,
            { role: "assistant", content: response.content },
            {
              role: "user", content: [{
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: "Season plan saved successfully.",
              }],
            },
          ],
        });

        reply = followUp.content.find((b) => b.type === "text")?.type === "text"
          ? (followUp.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
          : "";

      } else if (toolBlock && toolBlock.type === "tool_use" && toolBlock.name === "update_club_distances") {
        const input = toolBlock.input as { updates: Array<{ club_name: string; new_distance: number }> };

        // Update each club's expected_distance
        await Promise.all(
          input.updates.map(({ club_name, new_distance }) =>
            supabase.from("clubs")
              .update({ expected_distance: new_distance, distance_source: "gps_measured" })
              .eq("user_id", user.id)
              .ilike("club_name", club_name)
          )
        );

        const followUp = await anthropic.messages.create({
          model: activeModel,
          max_tokens: 256,
          system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
          messages: [
            ...apiMessages,
            { role: "assistant", content: response.content },
            {
              role: "user", content: [{
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: `Updated: ${input.updates.map(u => `${u.club_name} → ${u.new_distance} yds`).join(", ")}`,
              }],
            },
          ],
        });

        reply = followUp.content.find((b) => b.type === "text")?.type === "text"
          ? (followUp.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
          : "";

      } else if (toolBlock && toolBlock.type === "tool_use" && toolBlock.name === "mark_mishit") {
        const input = toolBlock.input as { club_name: string; description?: string };

        // Mark the most recent shot for this club as a mishit
        const { data: latestShot } = await supabase
          .from("shot_history")
          .select("id")
          .eq("user_id", user.id)
          .ilike("club_name", input.club_name)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (latestShot) {
          await supabase.from("shot_history")
            .update({ is_mishit: true, mishit_description: input.description ?? null })
            .eq("id", latestShot.id);
        }

        const followUp = await anthropic.messages.create({
          model: activeModel,
          max_tokens: 256,
          system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
          messages: [
            ...apiMessages,
            { role: "assistant", content: response.content },
            {
              role: "user", content: [{
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: latestShot
                  ? `Marked as mishit${input.description ? ` (${input.description})` : ""} — excluded from distance averages.`
                  : "No recent shot found for that club.",
              }],
            },
          ],
        });

        reply = followUp.content.find((b) => b.type === "text")?.type === "text"
          ? (followUp.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
          : "";

      } else if (toolBlock && toolBlock.type === "tool_use" && toolBlock.name === "note_shot") {
        const input = toolBlock.input as { club_name: string; notes: string };

        // Find most recent shot for this club and append notes
        const { data: latestShot } = await supabase
          .from("shot_history")
          .select("id, shot_notes")
          .eq("user_id", user.id)
          .ilike("club_name", input.club_name)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (latestShot) {
          const existing = latestShot.shot_notes;
          const updated = existing ? `${existing} | ${input.notes}` : input.notes;
          await supabase.from("shot_history").update({ shot_notes: updated }).eq("id", latestShot.id);
        }

        const followUp = await anthropic.messages.create({
          model: activeModel,
          max_tokens: 256,
          system: [{ type: "text", text: finalSystemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [savePlanTool, saveSeasonPlanTool, updateClubDistancesTool, markMishitTool, noteShotTool],
          messages: [
            ...apiMessages,
            { role: "assistant", content: response.content },
            {
              role: "user", content: [{
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: latestShot ? "Shot noted." : "No recent shot found for that club.",
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

    // On-course: speak the full reply (responses are kept short by the system prompt)
    // Off-course: speak first 4 sentences for long replies
    if (roundContext?.courseId) {
      speech = reply;
    } else if (reply.length <= SPEECH_THRESHOLD) {
      speech = reply;
    } else {
      const sentences = reply.replace(/\n+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [];
      speech = sentences.slice(0, 4).join(" ").trim() || reply.substring(0, SPEECH_THRESHOLD);
    }

    await supabase.from("messages").insert({ user_id: user.id, role: "assistant", content: reply });

    // Use after() so these run after the response is sent but are guaranteed
    // to complete before Vercel terminates the Lambda.
    after(async () => {
      // Save completed shot to history when player announces a club
      if (shotContext?.lastShotClub && shotContext?.lastShotDistanceYards !== null) {
        await saveShotToHistory(
          user.id,
          shotContext as ShotContext,
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          getEnvVar("SUPABASE_SERVICE_ROLE_KEY")
        );
      }

      // Update AI notes every 4 messages, or immediately on high-signal messages
      const newMessageCount = messageCount + 2;
      const isHighSignal = /\b(remember|breakthrough|figured out|finally|clicking|nailed it|shot \d+|broke \d+|best round|worst round|discovered|realized)\b/i.test(message ?? "");
      if (!isGreeting && (newMessageCount % 4 === 0 || isHighSignal)) {
        await updateAiNotes(
          user.id,
          anthropic,
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
          profile.ai_notes ?? null
        );
      }

      // Mark announcements as read after greeting delivery
      if (isGreeting && unreadAnnouncements.length > 0) {
        const ids = unreadAnnouncements.map((a: AnnouncementItem) => a.id);
        await supabase.from("user_announcement_reads")
          .upsert(ids.map((id: string) => ({ user_id: user.id, announcement_id: id })), { onConflict: "user_id,announcement_id" });
      }
    });

    return NextResponse.json({
      reply,
      speech,
      voiceId: persona.voiceId,
      personaName: persona.name,
      planSaved,
      seasonPlanSaved,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
