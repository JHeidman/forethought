# Swing Video Analysis — Design Spec

**Date:** 2026-07-07  
**Status:** Approved for implementation planning

---

## Overview

Frankie gains the ability to watch a user's golf swing by recording a short video clip in-app, extracting key frames, and analyzing them via Claude vision. She uses the user's current goals and coaching history to lead with 1-2 targeted observations — not a generic checklist.

This is V1 (browser-based). A native iOS/Android implementation is backlogged as a separate design session (Task #41).

---

## Core Design Principles

- **Frankie initiates.** She suggests swing recording at the right coaching moment — not a feature users have to discover. The in-chat button is a fallback.
- **Hands-free.** Voice trigger ("Got it") ends the recording so the user doesn't have to scramble to tap a button after their swing.
- **Seamless.** No app-switching, no uploading from camera roll. Everything happens in-app.
- **Caddy-like feedback.** 1-2 observations max per swing, tied to what the user is actually working on. Not a generic lesson.

---

## User Flow

### Entry Points

**Primary:** Frankie proactively suggests it via the `record_swing` tool when context warrants:
- User mentions they're at the range or course
- User describes a mechanical problem that would be easier to see than describe
- User has been stuck on the same issue across multiple sessions
- User asks about something visual (swing plane, hip turn, setup, etc.)

When Frankie calls `record_swing`, the UI surfaces the recording flow automatically — no button hunting required.

**Fallback:** A "Record Swing" button available in the chat input area (both voice and text mode) for users who want to initiate it themselves.

---

### Recording Flow (step by step)

**Step 1 — Setup screen**

Before the camera opens, show a brief instruction screen:

> 🎥 **Recording your swing**
> 
> • Place your phone at **hip height**, aimed at you from the **side** (face-on or down-the-line both work)
> • Have someone hold it, or prop it against your bag
> • After your swing, **say "Got it" or tap the button** — do this right after you finish, timing matters
> 
> [Flip camera 🔄]  [Start Recording →]

**Step 2 — Rolling buffer**

- Camera opens. Rear camera default (filming the user), front camera available via flip toggle.
- A rolling 10-second video buffer starts immediately via MediaRecorder.
- The microphone simultaneously listens for the trigger phrase "Got it."
- UI shows a simple live viewfinder with a pulsing record indicator and a large "Got it" button.

**Step 3 — User swings**

User addresses the ball and swings normally. No need to tap anything before swinging.

**Step 4 — Trigger**

Immediately after the swing finishes, user either:
- Says **"Got it"** (mic detects the phrase)
- Taps the **"Got it" button** on screen (fallback for noisy environments — driving ranges are loud)

**Step 5 — Frame extraction**

App freezes the rolling buffer, takes the last 4-5 seconds, and samples 5 frames evenly across that window. Each frame is exported as a base64 JPEG via canvas. The video blob is then discarded — nothing is stored or uploaded.

**Step 6 — Frankie acknowledges immediately**

Before analysis completes, Frankie speaks:
> *"Got it, give me a second to look at that…"*

This plays within ~500ms of the trigger. No silent loading spinner.

**Step 7 — Analysis**

The 5 frames are sent to `/api/chat` alongside a prompt that instructs Frankie to:
- Review the frames in sequence (address → backswing → impact → follow-through)
- Lead with **1-2 observations maximum**
- Prioritize observations that relate to the user's **current goal** (`golf_goals`) or recent coaching focus (`ai_notes`) over generic findings
- Fall back to the most critical mechanical issue she sees if no specific goal context is available

**Step 8 — Feedback delivery**

Frankie responds via voice (consistent with the existing TTS pipeline) with her 1-2 observations. The 5 extracted frames are also displayed in the chat as a visual record — the user can see the screenshots Frankie is referencing.

---

## Technical Architecture

### New: `lib/swing-capture.ts`

Isolated module responsible for the video buffer and frame extraction. Kept separate so it can be swapped for a native implementation later without touching the Frankie coaching layer.

**Exports:**
- `startRollingBuffer(): Promise<SwingCaptureSession>` — starts MediaRecorder + rolling buffer
- `SwingCaptureSession.freeze(): Promise<VideoBlob>` — freezes the last 10 seconds
- `extractFrames(blob: Blob, count: number, windowSeconds: number): Promise<FrameData[]>` — seeks to evenly-spaced timestamps in the last `windowSeconds`, returns base64 JPEGs
- `SwingCaptureSession.stop()` — cleans up MediaRecorder and releases camera

**Frame extraction detail:**
- Creates hidden `<video>` element, sets `src` to `URL.createObjectURL(blob)`
- Waits for `loadedmetadata`
- Seeks to: `duration - windowSeconds + (i / count) * windowSeconds` for i in 0..count
- At each seek: `canvas.drawImage(video, 0, 0)` → `canvas.toDataURL('image/jpeg', 0.85)`
- Returns array of `{ base64: string, mediaType: 'image/jpeg', timestamp: number }`
- Revokes object URL and discards blob when done

### New: `app/(app)/chat/components/SwingRecorder.tsx`

The in-chat recording UI component. Shown as a modal/overlay when `record_swing` tool fires or the fallback button is tapped.

**States:**
- `setup` — instruction screen with camera flip toggle and Start button
- `recording` — live viewfinder, pulsing indicator, "Got it" button, mic listening
- `processing` — brief state while frames are extracted (shows "Got it, give me a second…" text)
- `done` — closes and returns frames to parent

**Props:**
- `onFramesReady(frames: FrameData[]): void` — called when extraction completes
- `onCancel(): void`

### Modified: `app/api/chat/route.ts`

- Add `swingFrames?: FrameData[]` to the request body schema
- When `swingFrames` is present, include all frames as image content blocks in the user message (same pattern as existing `imageData` handling, extended to multiple images)
- Add `record_swing` tool definition — no parameters needed, just signals Frankie wants to initiate the recording flow

### Modified: `app/(app)/chat/page.tsx`

- Handle `record_swing` tool call from Frankie → open `SwingRecorder` component
- Add fallback "Record Swing" button to the chat input area
- When `SwingRecorder` returns frames: set Frankie's acknowledgment audio playing, then send frames to `/api/chat`
- Display returned frames in the chat message bubble alongside Frankie's text response

### New: `/api/speak` pre-response

When swing frames are included in a request, the chat page plays a pre-baked acknowledgment line ("Got it, give me a second to look at that…") immediately, before the `/api/chat` response arrives. This uses the existing `speakText()` function with a hardcoded string.

---

## Frankie's Coaching Prompt (swing analysis)

Added to `buildSystemPrompt()` as a conditional block when swing frames are present:

```
The user has shared frames from a swing recording. Analyze them in sequence.

Lead with 1-2 observations ONLY. Do not give a comprehensive breakdown.

Prioritize in this order:
1. Anything directly related to their current goal: {golf_goals}
2. Anything related to recent coaching focus from your notes: {ai_notes}  
3. The single most critical mechanical issue you observe

Be specific and visual — tell them what you see, not just what to fix. 
Reference the position (address, backswing, impact, follow-through) you're looking at.
Keep it conversational, not clinical. You're a caddy, not a swing robot.
```

---

## Voice Trigger

The mic during recording listens for "Got it" (case-insensitive, partial match acceptable — "got it", "gotcha", "ok got it" all trigger).

Uses the existing Groq Whisper transcription pipeline: short audio chunk → transcription → match check → trigger if matched.

The swing recorder manages its own mic instance, separate from the chat voice mode mic. The chat mic is suspended while the swing recorder is active, and resumed when it closes.

Fallback button is always visible and always works — critical for noisy driving range environments.

---

## What's NOT in V1

- Frame annotations or highlights (draw lines on the swing — future iteration)
- Storing swing videos or frames in the database (no swing history yet)
- Comparing current swing to a previous recording
- Specialized swing AI integration (V1 Sports, Swing Vision) — backlogged
- Native iOS/Android camera API — backlogged (Task #41)
- Front-on vs. down-the-line automatic detection

---

## Success Criteria

- User can complete the full flow (Frankie suggests → setup → record → "Got it" → feedback) in under 60 seconds
- Voice trigger works reliably at a driving range (noisy environment)
- Frankie's feedback references the user's actual goal or coaching focus, not generic tips
- Frames are visible in the chat so the user can see what Frankie is looking at
- The video blob is never uploaded or stored — all processing is on-device
