-- Announcements system
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid default gen_random_uuid() primary key,
  version     text not null,           -- e.g. "1.2", "Jun 2025"
  title       text not null,           -- short name shown in lists
  summary     text not null,           -- 1-2 sentences; what Frankie tells the player
  detail      text not null,           -- full description for "tell me more"
  is_active   boolean default true,
  created_at  timestamptz default now()
);

CREATE TABLE IF NOT EXISTS user_announcement_reads (
  user_id         uuid references auth.users on delete cascade not null,
  announcement_id uuid references announcements on delete cascade not null,
  read_at         timestamptz default now(),
  primary key (user_id, announcement_id)
);

-- RLS: anyone authenticated can read active announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read active announcements" ON announcements
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

-- Admin can do everything (matched by email in app layer; service role bypasses RLS)
CREATE POLICY "Service role full access announcements" ON announcements
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE user_announcement_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reads" ON user_announcement_reads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON public.announcements TO authenticated;
GRANT SELECT, INSERT ON public.user_announcement_reads TO authenticated, service_role;
GRANT ALL ON public.announcements TO service_role;

-- Seed with the major features we've already shipped
INSERT INTO announcements (version, title, summary, detail, created_at) VALUES
(
  '1.0 · Jun 2025',
  'GPS Shot Tracking',
  'I can now track your shot distances automatically using GPS — no more guessing how far you actually hit that 7-iron.',
  'When you''re playing a round, announce your club before you hit ("I''m hitting my 7-iron") and I''ll automatically measure how far the ball travels using your phone''s GPS. After a few rounds I''ll build up real distance averages for each club and can propose updates to your yardages. Any obvious outliers — like a 7-iron that went 40 yards — I''ll ask about naturally in case it was a mishit. You can also say things like "I shanked that one" and I''ll log it so it doesn''t skew your averages.',
  now() - interval '3 days'
),
(
  '1.0 · Jun 2025',
  'Hands-Free Voice Modes',
  'There are now four different ways to talk to me hands-free on the course — pick whatever works best for how you play.',
  'In voice mode, you''ll see a row of four mode chips at the top: Named (say "Frankie" first — great for group play so cart chatter doesn''t trigger me), Solo (always listening — best when playing alone), Hold (tap the mic, speak, tap again to send — good for windy days), and Auto (tap once, I send when you go quiet — most hands-free of all). Your mode is saved and remembered next time. The screen stays on automatically while listening.',
  now() - interval '3 days'
),
(
  '1.0 · Jun 2025',
  'Season Planning',
  'I can now build you a personalised season roadmap — tell me your goal and I''ll put together a real plan.',
  'Once you set a goal (like "break 90 by August"), I''ll naturally gather a few details over our conversations — what you typically shoot, where most of your strokes go, how often you play and practice. When I have enough, I''ll offer to write your plan. You can also just ask for one at any time. Saved plans live on the Plans page.',
  now() - interval '7 days'
),
(
  '0.9 · Jun 2025',
  'Club Bag & Specs',
  'Your bag is now fully set up with accurate distances, and you can add equipment details for each club.',
  'On the Profile page you''ll find your full club bag with distance estimates based on your age and skill level. You can edit any club''s expected distance, carry distance, shaft flex, loft, and shot shape tendency. The more details you add, the better I can tailor club recommendations to your actual equipment.',
  now() - interval '14 days'
)
ON CONFLICT DO NOTHING;
