import { NextRequest, NextResponse } from "next/server";
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

const ELEVENLABS_DEFAULT_VOICE = "FGY2WhTYpPnrIDTdsKH5"; // Frankie

// OpenAI voices per persona — best available match for each personality
const OPENAI_VOICE_MAP: Record<string, string> = {
  frankie: "nova",   // warm, female
  sam:     "shimmer", // calm, female
  coach:   "onyx",   // warm, male
  ace:     "fable",  // casual, male
};
const OPENAI_DEFAULT_VOICE = "nova";

async function speakElevenLabs(text: string, voiceId: string): Promise<Response | null> {
  const apiKey = getEnvVar("ELEVENLABS_API_KEY");
  if (!apiKey) return null;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    // Quota exhausted — signal fallback needed
    if (response.status === 401 && err.includes("quota_exceeded")) return null;
    console.error("ElevenLabs error:", err);
    return null;
  }

  return response;
}

async function speakOpenAI(text: string, persona: string): Promise<Response | null> {
  const apiKey = getEnvVar("OPENAI_API_KEY");
  if (!apiKey) return null;

  const voice = OPENAI_VOICE_MAP[persona] ?? OPENAI_DEFAULT_VOICE;

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice, input: text }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("OpenAI TTS error:", err);
    return null;
  }

  return response;
}

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, tier, persona } = await req.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const effectiveVoiceId = voiceId || ELEVENLABS_DEFAULT_VOICE;
    let audioResponse: Response | null = null;

    if (tier === "standard") {
      // Standard: OpenAI only
      audioResponse = await speakOpenAI(text, persona ?? "frankie");
    } else {
      // Premium: try ElevenLabs, fall back to OpenAI if quota exceeded
      audioResponse = await speakElevenLabs(text, effectiveVoiceId);
      if (!audioResponse) {
        console.warn("ElevenLabs unavailable — falling back to OpenAI TTS");
        audioResponse = await speakOpenAI(text, persona ?? "frankie");
      }
    }

    if (!audioResponse) {
      return NextResponse.json({ error: "TTS unavailable" }, { status: 500 });
    }

    return new NextResponse(audioResponse.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    console.error("Speak API error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
