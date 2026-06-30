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

type AppState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [voiceMode, setVoiceMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [personaName, setPersonaName] = useState("Frankie");
  const [planSavedToast, setPlanSavedToast] = useState(false);
  const [seasonPlanSavedToast, setSeasonPlanSavedToast] = useState(false);
  const [activeRound, setActiveRound] = useState<{ courseId: number; courseName: string; tee: string; conditions: string; } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionChips, setSuggestionChips] = useState<string[]>([]);
  const [playerGoal, setPlayerGoal] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentVoiceIdRef = useRef<string>("FGY2WhTYpPnrIDTdsKH5");
  const currentPersonaRef = useRef<string>("frankie");
  const voiceTierRef = useRef<string>("premium");

  // GPS + shot tracking refs (refs not state — updates don't need re-renders)
  const gpsWatchIdRef = useRef<number | null>(null);
  const currentGpsRef = useRef<{ lat: number; lon: number; accuracyMeters: number } | null>(null);
  const lastShotRef = useRef<{ club: string; gps: { lat: number; lon: number } } | null>(null);

  const personaNameRef = useRef<string>("Frankie");
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  const voiceModeRef = useRef(false);
  const [holdMode, setHoldMode] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActiveRef = useRef(false);
  const prevAppStateRef = useRef<AppState>("idle");
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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
        currentPersonaRef.current = profile.persona ?? "frankie";
        voiceTierRef.current = (profile as Record<string, unknown>).voice_tier as string ?? "premium";
      }

      const goal = profile?.goal ?? null;
      setPlayerGoal(goal);
      const chips = buildChips(goal);
      setSuggestionChips(chips);

      if (existingMessages.length > 0) {
        setMessages(existingMessages as Message[]);
        setShowSuggestions(true); // show chips for returning users too

        // Check for unread announcements — but only once per browser session.
        // Guard with sessionStorage so navigating away and back doesn't re-fire.
        const alreadyShown = sessionStorage.getItem("frankieAnnouncementsShown");
        if (!alreadyShown) {
          try {
            const annRes = await fetch("/api/announcements");
            const annData = annRes.ok ? await annRes.json() : {};
            if (annRes.ok && annData.announcements?.length > 0) {
              // Mark as read immediately so re-mounts never re-show them
              sessionStorage.setItem("frankieAnnouncementsShown", "true");
              void fetch("/api/announcements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: annData.announcements.map((a: { id: string }) => a.id) }),
              });
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
                if (data.persona) currentPersonaRef.current = data.persona;
                if (data.voiceTier) voiceTierRef.current = data.voiceTier;
                const msg = { id: crypto.randomUUID(), role: "assistant" as const, content: data.reply };
                setMessages(prev => [...prev, msg]);
                await speakText(data.speech || data.reply, data.voiceId);
              }
              setAppState("idle");
            }
          } catch {
            // non-critical — silently ignore
          }
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

  // Keep refs in sync
  useEffect(() => { personaNameRef.current = personaName; }, [personaName]);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  // Auto-listen: when voice mode is on and Frankie finishes speaking, start listening again
  useEffect(() => {
    const prev = prevAppStateRef.current;
    prevAppStateRef.current = appState;

    if (!voiceModeRef.current) return;
    if (appState !== "idle") return;
    if (prev !== "speaking" && prev !== "thinking") return;

    const t = setTimeout(() => {
      if (voiceModeRef.current) void startListeningInternal();
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState]);

  // Restore mute state from localStorage (after hydration)
  useEffect(() => {
    if (localStorage.getItem("frankieMuted") === "true") setMuted(true);
  }, []);

  const isInitialLoad = useRef(true);
  useEffect(() => {
    const behavior = isInitialLoad.current ? "auto" : "smooth";
    isInitialLoad.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages]);

  function readImageFile(file: File): Promise<{ base64: string; mediaType: string }> {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) { reject(new Error("Not an image")); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve({ base64, mediaType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) readImageFile(file).then(setPendingImage).catch(() => {});
  }

  function handlePaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.items)
      .find(item => item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) readImageFile(file).then(setPendingImage).catch(() => {});
  }

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

  function splitSentences(text: string): string[] {
    const raw = text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text];
    return raw.map(s => s.trim()).filter(s => s.length > 2).slice(0, 4);
  }

  async function fetchAudioUrl(text: string, voiceId?: string): Promise<string | null> {
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: voiceId || currentVoiceIdRef.current,
          tier: voiceTierRef.current,
          persona: currentPersonaRef.current,
        }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  function playAudioUrl(url: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
      audio.play().catch(() => resolve());
    });
  }

  async function speakText(text: string, voiceId?: string) {
    if (muted) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAppState("speaking");

    try {
      const sentences = splitSentences(text);
      if (sentences.length === 0) { setAppState("idle"); return; }

      // Prefetch first sentence immediately
      let nextFetch: Promise<string | null> = fetchAudioUrl(sentences[0], voiceId);

      for (let i = 0; i < sentences.length; i++) {
        const url = await nextFetch;

        // Start prefetching the next sentence while current plays
        if (i + 1 < sentences.length) {
          nextFetch = fetchAudioUrl(sentences[i + 1], voiceId);
        }

        if (!url) continue;

        // Stop if user muted mid-speech
        if (muted) { URL.revokeObjectURL(url); break; }

        await playAudioUrl(url);
      }
    } catch {
      // Silently fail — text is still shown
    } finally {
      setAppState("idle");
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !pendingImage) || appState === "thinking" || appState === "speaking") return;

    const imageToSend = pendingImage;
    setInput("");
    setPendingImage(null);
    setShowSuggestions(false);
    setAppState("thinking");
    const tempId = crypto.randomUUID();
    const displayText = trimmed || (imageToSend ? "📷 [image]" : "");
    setMessages((prev) => [...prev, { id: tempId, role: "user", content: displayText }]);

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
        body: JSON.stringify({ message: trimmed || "What do you see in this image?", imageData: imageToSend, roundContext: activeRound, shotContext }),
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
  }, [appState, pendingImage]);

  // Keep sendMessageRef in sync so voice callbacks always have the latest version
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  function stopSilenceDetection() {
    if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
  }

  async function startListeningInternal() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Microphone not available. Use Safari on iPhone, or check browser permissions.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.name : String(err);
      if (msg === "NotAllowedError" || msg === "PermissionDeniedError") {
        setMicError("Microphone blocked. On iPhone: open the Settings app → Chrome → turn on Microphone, then reload this page.");
      } else if (msg === "NotFoundError") {
        setMicError("No microphone found on this device.");
      } else {
        setMicError(`Mic error: ${msg}`);
      }
      return;
    }

    streamRef.current = stream;
    audioChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : undefined;

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stopSilenceDetection();
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const blob = new Blob(audioChunksRef.current, { type: mimeType ?? "audio/webm" });
      audioChunksRef.current = [];

      if (blob.size < 500) { setAppState("idle"); return; }

      setAppState("transcribing");
      try {
        const ext = (mimeType ?? "").includes("mp4") ? "mp4" : (mimeType ?? "").includes("ogg") ? "ogg" : "webm";
        const form = new FormData();
        form.append("audio", blob, `recording.${ext}`);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = await res.json();
        const text = data.text?.trim() ?? "";
        const NOISE_PHRASES = /^(\.+|you\.?|thank you\.?|thanks\.?|bye\.?|okay\.?|ok\.?|um\.?|uh\.?|hmm\.?|\s*)$/i;
        if (text && text.split(/\s+/).length >= 2 && !NOISE_PHRASES.test(text)) {
          await sendMessageRef.current(text);
        } else {
          setAppState("idle");
        }
      } catch {
        setAppState("idle");
      }
    };

    // Silence detection — auto-stop when user pauses speaking
    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const THRESHOLD = 22;       // 0-255 volume level — below this is silence
      const SILENCE_MS = 1800;    // stop after this much silence
      const MIN_SPEECH_MS = 600;  // don't stop until user has spoken at least this long
      let hasSpeech = false;
      let silenceStart: number | null = null;
      const speechStart = Date.now();

      silenceIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        if (avg > THRESHOLD) {
          hasSpeech = true;
          silenceStart = null;
        } else if (hasSpeech && Date.now() - speechStart > MIN_SPEECH_MS) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart > SILENCE_MS) {
            clearInterval(silenceIntervalRef.current!);
            silenceIntervalRef.current = null;
            mediaRecorderRef.current?.stop();
            mediaRecorderRef.current = null;
          }
        }
      }, 100);
    } catch {
      // AudioContext failed — still record normally, just without auto-stop
    }

    mediaRecorderRef.current = recorder;
    recorder.start();
    setAppState("listening");
  }

  function startListening() {
    if (appState !== "idle") return;
    setMicError(null);
    void startListeningInternal();
  }

  function stopListening() {
    stopSilenceDetection();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  function toggleListening() {
    if (appState === "listening") stopListening();
    else if (appState === "idle") startListening();
  }

  function stopSpeaking() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAppState("idle");
  }

  function handleMicPointerDown() {
    if (appState === "thinking" || appState === "transcribing") return;
    if (appState === "speaking") { stopSpeaking(); return; }
    holdTimerRef.current = setTimeout(() => {
      holdActiveRef.current = true;
      setHoldMode(true);
      if (appState === "idle") void startListeningInternal();
    }, 200);
  }

  function handleMicPointerUp() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      setHoldMode(false);
      stopListening();
    } else {
      toggleListening();
    }
  }

  function handleMicPointerLeave() {
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      setHoldMode(false);
      stopListening();
    }
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  const stateLabel: Record<AppState, string> = {
    idle: holdMode ? "Hold mic to speak" : (voiceMode ? "Listening… tap to speak" : "Tap to speak"),
    listening: holdMode ? "Release to send" : "Listening… pause to send",
    transcribing: "Transcribing…",
    thinking: `${personaName} is thinking…`,
    speaking: `${personaName} is speaking…`,
  };

  return (
    <div
      className="flex flex-col h-full bg-gray-950"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950 bg-opacity-80 pointer-events-none">
          <div className="border-2 border-dashed border-green-500 rounded-2xl px-10 py-8 text-green-400 text-lg font-medium">
            Drop image to attach
          </div>
        </div>
      )}
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
        <div className="shrink-0 border-t border-gray-800 px-4 pt-4 pb-6 flex flex-col items-center gap-3">

          {micError && (
            <p className="text-red-400 text-xs text-center max-w-xs leading-snug">{micError}</p>
          )}

          {/* State label */}
          <p className={`text-sm font-medium ${
            appState === "listening" ? "text-green-400" :
            appState === "speaking"  ? "text-blue-400"  :
            appState === "thinking" || appState === "transcribing" ? "text-yellow-400" : "text-gray-500"
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
              onPointerDown={handleMicPointerDown}
              onPointerUp={handleMicPointerUp}
              onPointerLeave={handleMicPointerLeave}
              onContextMenu={(e) => e.preventDefault()}
              disabled={appState === "thinking" || appState === "transcribing"}
              className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all ${
                appState === "listening"
                  ? "bg-green-600 ring-4 ring-green-400 ring-opacity-60 scale-110 animate-pulse"
                  : appState === "thinking" || appState === "transcribing"
                  ? "bg-gray-700 opacity-50 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-500 active:scale-95"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          )}

        </div>
      ) : (
        /* Text Mode */
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="shrink-0 border-t border-gray-800 bg-gray-950 px-3 pt-2 pb-3 flex flex-col gap-2">
          {/* Image preview */}
          {pendingImage && (
            <div className="relative w-20 h-20 ml-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${pendingImage.mediaType};base64,${pendingImage.base64}`}
                alt="Attached"
                className="w-20 h-20 object-cover rounded-xl border border-gray-700"
              />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-gray-900 border border-gray-600 rounded-full text-gray-400 hover:text-white text-xs flex items-center justify-center"
              >✕</button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              onPaste={handlePaste}
              placeholder={`Ask ${personaName} anything…`}
              rows={1}
              disabled={appState !== "idle"}
              className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base resize-none focus:outline-none focus:border-green-500 max-h-32 disabled:opacity-50"
            />
            {/* Image file picker */}
            <label className={`shrink-0 rounded-xl p-3 cursor-pointer transition-colors ${pendingImage ? "bg-green-800 text-green-300" : "bg-gray-800 text-gray-400 hover:text-white"} ${appState !== "idle" ? "opacity-40 pointer-events-none" : ""}`}>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readImageFile(file).then(setPendingImage).catch(() => {});
                  e.target.value = "";
                }}
              />
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </label>
            <button type="button" onClick={toggleListening}
                disabled={appState === "thinking" || appState === "speaking" || appState === "transcribing"}
                className={`shrink-0 rounded-xl p-3 transition-colors disabled:opacity-40 ${appState === "listening" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            <button type="submit" disabled={(!input.trim() && !pendingImage) || appState !== "idle"}
              className="shrink-0 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 px-4 py-3 text-white font-semibold transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
