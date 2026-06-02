"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AppState = "idle" | "listening" | "thinking" | "speaking";

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [personaName, setPersonaName] = useState("Frankie");
  const [planSavedToast, setPlanSavedToast] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<string>("");
  const currentVoiceIdRef = useRef<string>("FGY2WhTYpPnrIDTdsKH5");

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [messagesResult, profileResult] = await Promise.all([
        supabase.from("messages").select("id, role, content").eq("user_id", user.id).order("created_at", { ascending: true }).limit(50),
        supabase.from("profiles").select("name, handicap, home_course, persona").eq("id", user.id).single(),
      ]);

      const existingMessages = messagesResult.data ?? [];
      const profile = profileResult.data;

      if (existingMessages.length > 0) {
        setMessages(existingMessages as Message[]);
      } else {
        setAppState("thinking");
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "hello", isGreeting: true }),
          });
          const data = await res.json();
          if (data.reply) {
            if (data.personaName) setPersonaName(data.personaName);
            if (data.voiceId) currentVoiceIdRef.current = data.voiceId;
            const msg = { id: crypto.randomUUID(), role: "assistant" as const, content: data.reply };
            setMessages([msg]);
            await speakText(data.speech || data.reply, data.voiceId);
          }
        } finally {
          setAppState("idle");
        }
      }

      if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
        setVoiceSupported(true);
      }
      if (window.innerWidth < 768) setVoiceMode(true);
    }
    init();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function speakText(text: string, voiceId?: string) {
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setAppState("speaking");

      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: voiceId || currentVoiceIdRef.current }),
      });

      if (!res.ok) { setAppState("idle"); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      await new Promise<void>((resolve) => {
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      });
    } catch {
      // Silently fail — text is still shown
    } finally {
      setAppState("idle");
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || appState === "thinking" || appState === "speaking") return;

    setInput("");
    setAppState("thinking");
    const tempId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: trimmed }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();

      if (data.personaName) setPersonaName(data.personaName);
      if (data.voiceId) currentVoiceIdRef.current = data.voiceId;

      if (data.planSaved) {
        setPlanSavedToast(true);
        setTimeout(() => setPlanSavedToast(false), 3000);
      }

      if (data.reply) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
        await speakText(data.speech || data.reply, data.voiceId);
      } else {
        setAppState("idle");
      }
    } catch {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Sorry, something went wrong." }]);
      setAppState("idle");
    }
  }, [appState]);

  function startListening() {
    if (appState !== "idle") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    transcriptRef.current = "";
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setAppState("listening");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
      }
      if (final) transcriptRef.current += " " + final;
      let interim = transcriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) interim += event.results[i][0].transcript;
      }
      setInput(interim.trim());
    };
    recognition.onerror = () => setAppState("idle");
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    const transcript = transcriptRef.current.trim() || input.trim();
    if (transcript) sendMessage(transcript);
    else setAppState("idle");
  }

  function stopSpeaking() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAppState("idle");
  }

  const stateLabel: Record<AppState, string> = {
    idle: voiceMode ? "Hold to speak" : "",
    listening: "Listening…",
    thinking: `${personaName} is thinking…`,
    speaking: `${personaName} is speaking…`,
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Plan saved toast */}
      {planSavedToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
          ✓ Practice plan saved
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="font-bold text-green-400 text-lg">⛳ {personaName}</h1>
          <p className="text-xs text-gray-500">Your AI caddy</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setVoiceMode((v) => !v)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${voiceMode ? "border-green-500 text-green-400" : "border-gray-700 text-gray-500"}`}
          >
            {voiceMode ? "🎙 Voice" : "⌨️ Text"}
          </button>
          <Link href="/profile" className="p-2 text-gray-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-green-600 text-white rounded-br-sm"
                : "bg-gray-800 text-gray-100 rounded-bl-sm"
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {appState === "thinking" && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-3 text-gray-400">
              <span className="animate-pulse">{personaName} is thinking…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Mode */}
      {voiceMode ? (
        <div className="shrink-0 border-t border-gray-800 px-4 py-6 flex flex-col items-center gap-4">
          {input && appState === "listening" && (
            <p className="text-gray-400 text-sm text-center italic max-w-xs">{input}</p>
          )}
          <p className={`text-sm font-medium ${
            appState === "listening" ? "text-green-400" :
            appState === "speaking" ? "text-blue-400" :
            appState === "thinking" ? "text-yellow-400" : "text-gray-500"
          }`}>
            {stateLabel[appState]}
          </p>

          {appState === "speaking" ? (
            <button onClick={stopSpeaking} className="w-24 h-24 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center shadow-lg transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
              </svg>
            </button>
          ) : (
            <button
              onPointerDown={startListening}
              onPointerUp={stopListening}
              onPointerLeave={stopListening}
              disabled={appState === "thinking"}
              className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all ${
                appState === "listening" ? "bg-red-600 scale-110 ring-4 ring-red-400 ring-opacity-50" :
                appState === "thinking" ? "bg-gray-700 opacity-50 cursor-not-allowed" :
                "bg-green-600 hover:bg-green-500 active:scale-95"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          )}

          <div className="flex gap-4 items-center">
            <Link href="/plans" className="text-xs text-gray-600 hover:text-gray-400">📋 Plans</Link>
            <button onClick={() => setVoiceMode(false)} className="text-xs text-gray-600 hover:text-gray-400">Switch to text</button>
          </div>
        </div>
      ) : (
        /* Text Mode */
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="shrink-0 border-t border-gray-800 bg-gray-950 px-3 py-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={`Ask ${personaName} anything…`}
            rows={1}
            disabled={appState !== "idle"}
            className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base resize-none focus:outline-none focus:border-green-500 max-h-32 disabled:opacity-50"
          />
          {voiceSupported && (
            <button type="button" onPointerDown={startListening} onPointerUp={stopListening} onPointerLeave={stopListening}
              disabled={appState !== "idle"}
              className={`shrink-0 rounded-xl p-3 transition-colors disabled:opacity-40 ${appState === "listening" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          )}
          <button type="submit" disabled={!input.trim() || appState !== "idle"}
            className="shrink-0 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 px-4 py-3 text-white font-semibold transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      )}
    </div>
  );
}
