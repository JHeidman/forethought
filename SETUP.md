# ForeThought — Setup Instructions

## 1. Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **SQL Editor** and run the entire contents of `supabase-schema.sql`
3. Go to **Project Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`
4. Go to **Authentication → Users** and manually create your account (email + password)

## 2. Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create or regenerate an API key
3. Paste it as `ANTHROPIC_API_KEY`

## 3. Environment Variables

Fill in `.env.local` with the values above:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...
ANTHROPIC_API_KEY=sk-ant-...
```

## 4. Run Locally

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to /login.

## 5. Deploy to Vercel

1. Push this folder to a GitHub repo
2. Connect the repo to Vercel
3. Add the 4 environment variables in Vercel project settings
4. Deploy

## Pages

- `/login` — sign in
- `/chat` — talk to Frankie (main interface)
- `/settings` — update your golf profile and long-term memory
