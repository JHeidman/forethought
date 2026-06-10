# ForeThought — AI Golf Caddy

## What This Is
ForeThought is a mobile-first web app that gives golfers a persistent AI caddy (Frankie). It remembers your game across sessions, helps on the course with GPS-aware shot tracking, diagnoses swing problems, builds practice and season plans, and supports full hands-free voice mode.

**Live app:** https://forethought-7s4a.vercel.app  
**GitHub:** https://github.com/JHeidman/forethought  
**Deployed via:** Git push to `main` → Vercel auto-deploys

## Tech Stack
- **Framework:** Next.js 16 (App Router, `"use client"` components)
- **Database + Auth:** Supabase (Postgres + Row Level Security)
- **AI:** Anthropic Claude (claude-opus-4-8 for chat, haiku for utilities)
- **Voice:** Web Speech API (browser native) + ElevenLabs TTS
- **Styling:** Tailwind CSS
- **Tests:** Vitest (unit tests for pure functions)

## Key Commands
```bash
npm run dev          # local dev server
npm run build        # production build (runs before every deploy)
npm run test:unit    # run unit tests
git push             # triggers Vercel auto-deploy
```

## Project Structure
```
app/
  (app)/             # authenticated routes (TabBar layout)
    chat/page.tsx    # main chat UI — voice mode, GPS, message history
    profile/page.tsx # user profile, club bag, ai_notes, announcements
    plans/page.tsx   # practice plans + season roadmap
    admin/page.tsx   # admin: users, system prompt, announcements
  api/
    chat/route.ts    # main AI endpoint — system prompt, persona, tools
    speak/route.ts   # ElevenLabs TTS
    announcements/   # feature announcements system
    clubs/           # club bag CRUD + spec lookup
    course/          # golf course search + scorecard detail
components/
  TabBar.tsx         # bottom nav (Chat / Plans / Profile / Admin)
  CourseMode.tsx     # on-course round context setter
lib/
  personas.ts        # 4 caddy personas (Frankie, Sam, Coach, Ace)
  announcements.ts   # buildAnnouncementsBlock() — unit tested
  shot-detection.ts  # detectShotAnnouncement(), matchClubToBag() — unit tested
  gps.ts             # haversineYards(), assessShotDistance() — unit tested
  model-router.ts    # getMainModel(), getUtilityModel() — unit tested
  club-defaults.ts   # demographic distance defaults by gender/age
tests/
  unit/              # Vitest pure-function tests (109 tests)
  smoke.spec.ts      # Playwright smoke tests
```

## Database (Supabase)
Key tables: `profiles`, `messages`, `clubs`, `practice_plans`, `announcements`, `user_announcement_reads`, `settings`, `shot_history`

- `profiles.ai_notes` — auto-generated coaching notes (Claude extracts after every 4 messages or high-signal keywords)
- `profiles.player_notes` — user-written notes (never touched by AI)
- `settings.base_prompt` — editable system prompt base (admin page)
- `announcements` — feature announcements shown to users conversationally on login

## Important Patterns
- **Always write tests** for any new pure functions added to `lib/`
- **Fire-and-forget in serverless:** Use `await` not bare async calls — Vercel kills the Lambda on response, dropping unawaited work
- **Hydration:** All `localStorage` reads must be in `useEffect`, never in `useState` initializers
- **Supabase upserts:** Use `void` operator, not `.then().catch()` (PostgrestFilterBuilder isn't a real Promise)
- **Deployment:** `git push` to main — Vercel auto-deploys. The production alias is `forethought-7s4a.vercel.app`

## Environment Variables (needed on Vercel + .env.local)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `GOLF_COURSE_API_KEY`
