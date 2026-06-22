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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) return NextResponse.json({ error: "No audio" }, { status: 400 });

    const groqKey = getEnvVar("GROQ_API_KEY");
    if (!groqKey) return NextResponse.json({ error: "Groq not configured" }, { status: 500 });

    // Determine file extension from MIME type for Groq
    const mime = audioFile.type || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";

    const groqForm = new FormData();
    groqForm.append("file", audioFile, `recording.${ext}`);
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("language", "en");
    groqForm.append("response_format", "json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Groq transcription error:", err);
      return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text ?? "" });
  } catch (err) {
    console.error("Transcribe route error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
