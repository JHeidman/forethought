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

const DEFAULT_VOICE_ID = "FGY2WhTYpPnrIDTdsKH5";

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId } = await req.json();
    const VOICE_ID = voiceId || DEFAULT_VOICE_ID;
    if (!text?.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = getEnvVar("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return NextResponse.json({ error: "ElevenLabs API key not configured", keyLength: 0 }, { status: 500 });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("ElevenLabs error:", err);
      return NextResponse.json({ error: "TTS failed", detail: err, status: response.status }, { status: 500 });
    }

    // Stream the audio back to the client
    return new NextResponse(response.body, {
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
