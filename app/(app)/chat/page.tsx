"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import CourseMode from "@/components/CourseMode";
import { haversineYards } from "@/lib/gps";
import { detectShotAnnouncement } from "@/lib/shot-detection";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AppState = "idle" | "listening" | "thinking" | "speaking";
type ListenMode = "address" | "solo" | "interact" | "interact-vad";

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("frankieListenMode") as ListenMode) ?? "address";
    }
    return "address";
  });
  const [muted, setMuted] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("frankieMuted") === "true";
    }
    return false;
  });
  const [personaName, setPersonaName] = useState("Frankie");
  const [planSavedToast, setPlanSavedToast] = useState(false);
  const [seasonPlanSavedToast, setSeasonPlanSavedToast] = useState(false);
  const [activeRound, setActiveRound] = useState<{ courseId: number; courseName: string; tee: string; conditions: string; } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionChips, setSuggestionChips] = useState<string[]>([]);
  const [playerGoal, setPlayerGoal] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<string>("");
  const currentVoiceIdRef = useRef<string>("FGY2WhTYpPnrIDTdsKH5");

  // GPS + shot tracking refs (refs not state — updates don't need re-renders)
  const gpsWatchIdRef = useRef<number | null>(null);
  const currentGpsRef = useRef<{ lat: number; lon: number; accuracyMeters: number } | null>(null);
  const lastShotRef = useRef<{ club: string; gps: { lat: number; lon: number } } | null>(null);

  // Voice mode refs — needed so async recognition callbacks always see latest values
  const listenModeRef = useRef<ListenMode>(listenMode);
  const personaNameRef = useRef<string>("Frankie");
  const autoListenActiveRef = useRef(false);   // true when address/solo loop is running
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);

  function buildChips(goal: string | null): string[] {
    const hour = new Date().getHours();
    const isMorning = hour >= 5 && hour < 12;
    const isEvening = hour >= 17;

    // Bucket 1 — Goal (dynamic based on whether goal is set)
    const goalBucket = goal
      ? [`How am I tracking toward my goal?`, `What's the best thing I can do to reach my goal?`]
      : [`What would a great golf season look like for me?`, `Help me set a goal for this season`, `I want to break 90 — where do I start?`];

    // Bucket 2 — Fix something (rotating swing/technique)
    const fixBucket = [
      "Help me fix my driver",
      "My irons are all over the place",
      "My short game is costing me shots",
      "I keep missing putts I should make",
      "I struggle to get out of bunkers",
      "My tempo falls apart under pressure",
      "I hit it fat more than I'd like",
      "I slice when I need a straight shot",
    ];

    // Bucket 3 — On course (time-of-day tinted)
    const onCourseBucket = isMorning
      ? ["What's a good warm-up before my round?", "I'm playing this morning — get me ready", "What should I focus on today?"]
      : isEvening
      ? ["I just finished a round — let's debrief", "Want to hear how my round went?", "Help me process what happened today"]
      : ["I'm playing a round today", "Help me with course strategy", "What club should I hit from a specific yardage?"];

    // Bucket 4 — Practice planning
    const practiceBucket = [
      "Build me a practice plan",
      "I have 30 minutes at the range — what should I work on?",
      "Help me make a short game practice routine",
      "What's the highest-leverage thing to practice right now?",
      "I'm going to the putting green — give me a drill",
    ];

    // Bucket 5 — Open / conversational
    const openBucket = [
      "What can you help me with?",
      "Ask me how my game is going",
      "I've been struggling lately — not sure what's wrong",
      "Tell me something useful about golf",
      "What's one thing most high-handicappers get wrong?",
    ];

    // Pick one from each bucket, shuffled within each bucket
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    return [
      pick(goalBucket),
      pick(fixBucket),
      pick(onCourseBucket),
      pick(practiceBucket),
      pick(openBucket),
    ];
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [messagesResult, profileResult] = await Promise.all([
        supabase.from("messages").select("id, role, content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("profiles").select("name, handicap, home_course, persona, goal").eq("id", user.id).single(),
      ]);

      const existingMessages = (messagesResult.data ?? []).reverse();
      const profile = profileResult.data;

      // Apply persona from profile immediately so header/voice are correct on return
      if (profile?.persona) {
        const PERSONA_NAMES: Record<string, string> = { frankie: "Frankie", sam: "Sam", coach: "Coach", ace: "Ace" };
        const PERSONA_VOICES: Record<string, string> = {
          frankie: "FGY2WhTYpPnrIDTdsKH5",
          sam: "EXAVITQu4vr4xnSDxMaL",
          coach: "JBFqnCBsd6RMkjVDRZzb",
          ace: "CwhRBWXzGAHq8TQ4Fs17",
        };
        setPersonaName(PERSONA_NAMES[profile.persona] ?? "Frankie");
        currentVoiceIdRef.current = PERSONA_VOICES[profile.persona] ?? "FGY2WhTYpPnrIDTdsKH5";
      }

      const goal = profile?.goal ?? null;
      setPlayerGoal(goal);
      const chips = buildChips(goal);
      setSuggestionChips(chips);

      if (existingMessages.length > 0) {
        setMessages(existingMessages as Message[]);
        setShowSuggestions(true); // show chips for returning users too

        // Check for unread announcements — if any exist, send a greeting so
        // Frankie can naturally mention what's new in this session.
        try {
          const annRes = await fetch("/api/announcements");
          const annData = annRes.ok ? await annRes.json() : {};
          console.log("[ann check] status:", annRes.status, "data:", annData);
          if (annRes.ok) {
            if (annData.announcements?.length > 0) {
              setAppState("thinking");
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
                setMessages(prev => [...prev, msg]);
                await speakText(data.speech || data.reply, data.voiceId);
              }
              setAppState("idle");
            }
          }
        } catch {
          // non-critical — silently ignore
        }
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
            setShowSuggestions(true);
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

  // Start/stop GPS watch when round state changes
  useEffect(() => {
    if (activeRound && "geolocation" in navigator) {
      gpsWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          currentGpsRef.current = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          };
        },
        (err) => console.warn("GPS error:", err.message),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    } else {
      // Round ended — clear watch and shot history
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
      currentGpsRef.current = null;
      lastShotRef.current = null;
    }

    return () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };
  }, [activeRound]);

  // Keep mode refs in sync with state
  useEffect(() => { listenModeRef.current = listenMode; }, [listenMode]);
  useEffect(() => { personaNameRef.current = personaName; }, [personaName]);

  // Persist listen mode
  useEffect(() => { localStorage.setItem("frankieListenMode", listenMode); }, [listenMode]);

  // Wake lock — keep screen on during auto-listen modes
  useEffect(() => {
    const isAutoMode = listenMode === "address" || listenMode === "solo";
    if (isAutoMode && autoListenActiveRef.current && "wakeLock" in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock.request("screen")
        .then((lock: any) => { wakeLockRef.current = lock; })
        .catch(() => {});
    } else {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, [listenMode]);

  // Name check helpers for address mode
  function containsPersonaName(transcript: string, name: string): boolean {
    const t = transcript.toLowerCase();
    const n = name.toLowerCase();
    return t.includes(n);
  }

  function stripPersonaName(transcript: string, name: string): string {
    return transcript
      .replace(new RegExp(`^(hey\\s+|ok\\s+|okay\\s+)?${name}[,.]?\\s*`, "i"), "")
      .trim();
  }

  const isInitialLoad = useRef(true);
  useEffect(() => {
    const behavior = isInitialLoad.current ? "auto" : "smooth";
    isInitialLoad.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem("frankieMuted", String(next));
    if (next && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setAppState("idle");
    }
  }

  async function speakText(text: string, voiceId?: string) {
    if (muted) return;
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
      // Auto-restart mic in looping modes after Frankie finishes speaking
      const mode = listenModeRef.current;
      if (autoListenActiveRef.current && (mode === "address" || mode === "solo")) {
        setTimeout(() => startListening(true), 800); // slight delay so mic doesn't catch audio echo
      }
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || appState === "thinking" || appState === "speaking") return;

    setInput("");
    setShowSuggestions(false);
    setAppState("thinking");
    const tempId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: trimmed }]);

    // Build shot context if on-course and player is announcing a club
    let shotContext: {
      announcedClub: string;
      lastShotClub: string | null;
      lastShotDistanceYards: number | null;
      lastShotGpsStart: { lat: number; lon: number } | null;
      lastShotGpsEnd: { lat: number; lon: number } | null;
      gpsAccuracyMeters: number | null;
    } | null = null;

    if (activeRound) {
      const announcedClub = detectShotAnnouncement(trimmed);
      if (announcedClub) {
        const currentGps = currentGpsRef.current;

        if (lastShotRef.current && currentGps) {
          // Calculate distance of the PREVIOUS shot
          const distYards = haversineYards(
            lastShotRef.current.gps.lat, lastShotRef.current.gps.lon,
            currentGps.lat, currentGps.lon
          );
          shotContext = {
            announcedClub,
            lastShotClub: lastShotRef.current.club,
            lastShotDistanceYards: distYards,
            lastShotGpsStart: lastShotRef.current.gps,
            lastShotGpsEnd: { lat: currentGps.lat, lon: currentGps.lon },
            gpsAccuracyMeters: currentGps.accuracyMeters,
          };
        } else {
          shotContext = {
            announcedClub,
            lastShotClub: null,
            lastShotDistanceYards: null,
            lastShotGpsStart: null,
            lastShotGpsEnd: null,
            gpsAccuracyMeters: currentGps?.accuracyMeters ?? null,
          };
        }

        // Snapshot current position as the start of this new shot
        if (currentGps) {
          lastShotRef.current = {
            club: announcedClub,
            gps: { lat: currentGps.lat, lon: currentGps.lon },
          };
        }
      }
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, roundContext: activeRound, shotContext }),
      });
      const data = await res.json();

      if (data.personaName) setPersonaName(data.personaName);
      if (data.voiceId) currentVoiceIdRef.current = data.voiceId;

      if (data.planSaved) {
        setPlanSavedToast(true);
        setTimeout(() => setPlanSavedToast(false), 3000);
      }
      if (data.seasonPlanSaved) {
        setSeasonPlanSavedToast(true);
        setTimeout(() => setSeasonPlanSavedToast(false), 5000);
      }

      if (data.reply) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
        await speakText(data.speech || data.reply, data.voiceId);
        setAppState("idle"); // ensure idle even if muted or speakText returned early
        // Refresh chips after every reply so there's always something to tap
        setSuggestionChips(buildChips(playerGoal));
        setShowSuggestions(true);
      } else {
        setAppState("idle");
      }
    } catch {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Sorry, something went wrong." }]);
      setAppState("idle");
    }
  }, [appState]);

  function startListening(isAutoRestart = false) {
    if (appState !== "idle" && !isAutoRestart) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    const mode = listenModeRef.current;
    transcriptRef.current = "";
    setInput("");
    const recognition = new SR();

    // Hold mode keeps mic open continuously; all others use single-utterance mode
    recognition.continuous = mode === "interact";
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

      // Hold mode: reset the safety inactivity timer on every result
      if (mode === "interact") {
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = setTimeout(() => {
          // Player forgot to untoggle — stop silently without sending
          recognitionRef.current?.stop();
          recognitionRef.current = null;
          transcriptRef.current = "";
          setInput("");
          setAppState("idle");
        }, 30000);
      }
    };

    recognition.onend = () => {
      const currentMode = listenModeRef.current;
      const transcript = transcriptRef.current.trim();

      if (currentMode === "address") {
        const name = personaNameRef.current;
        if (transcript && containsPersonaName(transcript, name)) {
          const stripped = stripPersonaName(transcript, name);
          if (stripped) {
            sendMessage(stripped);
          } else {
            setAppState("idle");
            // Name only, no message — restart and wait
            if (autoListenActiveRef.current) setTimeout(() => startListening(true), 600);
          }
        } else {
          // Not addressed to Frankie — discard and restart
          setAppState("idle");
          if (autoListenActiveRef.current) setTimeout(() => startListening(true), 600);
        }
      } else if (currentMode === "solo") {
        const wordCount = transcript.split(/\s+/).filter(Boolean).length;
        if (transcript && wordCount >= 2) {
          sendMessage(transcript);
        } else {
          // Too short (ambient noise) — restart
          setAppState("idle");
          if (autoListenActiveRef.current) setTimeout(() => startListening(true), 600);
        }
      } else if (currentMode === "interact-vad") {
        // Auto-send when speech ends
        if (transcript) sendMessage(transcript);
        else setAppState("idle");
        // No auto-restart — player taps for each message
      }
      // "interact" mode onend is handled by stopListening() manually
    };

    recognition.onerror = (event: { error: string }) => {
      const currentMode = listenModeRef.current;
      if (event.error === "no-speech" && autoListenActiveRef.current &&
          (currentMode === "address" || currentMode === "solo")) {
        // Normal timeout in looping modes — just restart quietly
        setAppState("idle");
        setTimeout(() => startListening(true), 400);
      } else {
        setAppState("idle");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    const mode = listenModeRef.current;
    if (mode === "interact") {
      // Manual stop — send whatever was accumulated
      const transcript = transcriptRef.current.trim() || input.trim();
      if (transcript) sendMessage(transcript);
      else setAppState("idle");
    } else {
      // For other modes, onend handles sending — just clean up
      setAppState("idle");
    }
  }

  function toggleListening() {
    const mode = listenModeRef.current;

    if (appState === "listening") {
      if (mode === "interact") {
        stopListening(); // manual stop + send
      } else if (mode === "address" || mode === "solo") {
        // Stop the auto-loop entirely
        autoListenActiveRef.current = false;
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
        setAppState("idle");
      } else {
        stopListening();
      }
    } else if (appState === "idle") {
      if (mode === "address" || mode === "solo") {
        // Activate auto-loop
        autoListenActiveRef.current = true;
        // Acquire wake lock to keep screen on
        if ("wakeLock" in navigator) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigator as any).wakeLock.request("screen")
            .then((lock: any) => { wakeLockRef.current = lock; })
            .catch(() => {});
        }
        startListening();
      } else {
        startListening();
      }
    }
  }

  function stopSpeaking() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAppState("idle");
  }

  function deactivateAutoListen() {
    autoListenActiveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    setAppState("idle");
  }

  const stateLabel: Record<AppState, string> = {
    idle: voiceMode ? "Tap to speak" : "",
    listening: "Listening… tap to send",
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

      {/* Season plan saved toast */}
      {seasonPlanSavedToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-700 text-white px-5 py-3 rounded-2xl text-sm font-medium shadow-lg flex flex-col items-center gap-1">
          <span>🗺️ Your season roadmap is ready</span>
          <a href="/plans" className="text-green-300 text-xs underline">View in My Plans →</a>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="font-bold text-green-400 text-lg">⛳ {personaName}</h1>
          <p className="text-xs text-gray-500">Your AI caddy</p>
        </div>
        <button
          onClick={() => setVoiceMode((v) => !v)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${voiceMode ? "border-green-500 text-green-400" : "border-gray-700 text-gray-500"}`}
        >
          {voiceMode ? "🎙 Voice" : "⌨️ Text"}
        </button>
        <button
          onClick={toggleMute}
          title={muted ? "Unmute Frankie" : "Mute Frankie"}
          className={`p-2 rounded-full transition-colors ${muted ? "text-red-400 hover:text-red-300" : "text-gray-400 hover:text-white"}`}
        >
          {muted ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>
      </header>

      {/* Course Mode */}
      <CourseMode
        activeRound={activeRound}
        onStart={(ctx) => {
          setActiveRound(ctx);
          // Send a message to let Frankie know we're on the course
          sendMessage(`I'm heading out to play today at ${ctx.courseName} from the ${ctx.tee} tees.${ctx.conditions ? ` Conditions: ${ctx.conditions}.` : ""} Get me ready.`);
        }}
        onEnd={() => setActiveRound(null)}
      />

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

        {/* Suggestion chips — shown every session, hidden once user sends anything */}
        {showSuggestions && appState === "idle" && suggestionChips.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            {playerGoal ? (
              <p className="text-xs text-gray-600 px-1">
                🎯 Goal: <span className="text-gray-500 italic">{playerGoal}</span>
              </p>
            ) : (
              <p className="text-xs text-gray-600 px-1">Try asking…</p>
            )}
            <div className="flex flex-wrap gap-2">
              {suggestionChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => sendMessage(chip)}
                  className="text-sm px-4 py-2 rounded-full border border-gray-700 bg-gray-800 text-gray-300 hover:border-green-500 hover:text-green-400 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

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
        <div className="shrink-0 border-t border-gray-800 px-4 pt-3 pb-6 flex flex-col items-center gap-3">

          {/* Listen mode selector */}
          <div className="flex gap-1.5 w-full">
            {([
              { mode: "address" as ListenMode, label: "Named",  title: `Say "${personaName}" first` },
              { mode: "solo"    as ListenMode, label: "Solo",   title: "Always listening — no name needed" },
              { mode: "interact" as ListenMode, label: "Hold",  title: "Tap to start, tap to send" },
              { mode: "interact-vad" as ListenMode, label: "Auto", title: "Tap once, sends when you stop talking" },
            ]).map(({ mode, label, title }) => (
              <button
                key={mode}
                title={title}
                onClick={() => {
                  if (autoListenActiveRef.current) deactivateAutoListen();
                  setListenMode(mode);
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  listenMode === mode
                    ? "bg-green-700 text-white"
                    : "bg-gray-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mode hint */}
          <p className="text-xs text-gray-600 text-center h-4">
            {listenMode === "address" && `Say "${personaName}" to send`}
            {listenMode === "solo"    && "Looping — tap mic to stop"}
            {listenMode === "interact" && "Tap mic · speak · tap to send · auto-stops after 30s"}
            {listenMode === "interact-vad" && "Tap mic · speak · sends when you go quiet"}
          </p>

          {/* Interim transcript */}
          {input && appState === "listening" && (
            <p className="text-gray-400 text-sm text-center italic max-w-xs">{input}</p>
          )}

          {/* State label */}
          <p className={`text-sm font-medium ${
            appState === "listening" ? "text-green-400" :
            appState === "speaking"  ? "text-blue-400"  :
            appState === "thinking"  ? "text-yellow-400" : "text-gray-500"
          }`}>
            {listenMode === "address" && appState === "listening"
              ? `Listening for "${personaName}"…`
              : stateLabel[appState]}
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
              onClick={toggleListening}
              disabled={appState === "thinking"}
              className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all ${
                appState === "listening"
                  ? "bg-red-600 scale-110 ring-4 ring-red-400 ring-opacity-50"
                  : appState === "thinking"
                  ? "bg-gray-700 opacity-50 cursor-not-allowed"
                  : (listenMode === "address" || listenMode === "solo") && autoListenActiveRef.current
                  ? "bg-green-800 ring-2 ring-green-500 ring-opacity-60 hover:bg-green-700"
                  : "bg-green-600 hover:bg-green-500 active:scale-95"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          )}

          <button onClick={() => { deactivateAutoListen(); setVoiceMode(false); }} className="text-xs text-gray-600 hover:text-gray-400">Switch to text</button>
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
            <button type="button" onClick={toggleListening}
              disabled={appState === "thinking" || appState === "speaking"}
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
