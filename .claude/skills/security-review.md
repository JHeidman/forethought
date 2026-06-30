---
name: security-review
description: ForeThought-specific security review. Checks admin route protection, RLS gaps, API key exposure, input validation, and service role key usage. Saves dated findings to .claude/findings/.
---

You are performing a security review of the ForeThought codebase at C:\Users\jhber\dev\forethought.

## What to check

### 1. Admin route protection
Read every file in `app/api/admin/`. Each route must:
- Verify the caller's JWT via Supabase auth (not just check an email string client-side)
- Return 401 if no token, 403 if not admin
- Use the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY), not the anon key

Flag any route missing these checks.

### 2. API key exposure
Search for these patterns in all files under `app/` and `components/`:
- `sk-` (OpenAI/Anthropic keys)
- `gsk_` (Groq keys)  
- `tvly-` (Tavily keys)
- `sb_` followed by more than 10 chars (Supabase publishable key used server-side is fine; flag if in NEXT_PUBLIC_ context with sensitive operations)
- Any hardcoded key that isn't in an env var reference

Flag any hardcoded secrets.

### 3. Supabase RLS gaps
Read `app/api/chat/route.ts`, `app/api/clubs/route.ts`, `app/api/admin/*.ts`.
- Server routes using the SERVICE ROLE key bypass RLS — verify they always filter by `user_id` equal to the authenticated user
- Client-side Supabase queries (in `app/(app)/` pages) rely on RLS — verify the relevant tables have RLS enabled

Check the following tables: `profiles`, `clubs`, `messages`, `practice_plans`, `feedback`, `season_plans`

### 4. Unvalidated user input reaching the database
In `app/api/chat/route.ts` and `app/api/clubs/route.ts`:
- Is user-supplied text inserted directly into DB without sanitization?
- Are numeric fields (distances, loft, etc.) validated before insert?

### 5. Service role key usage
The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Flag any usage outside of:
- `app/api/admin/` routes (acceptable — admin only)
- `app/api/chat/route.ts` for feedback/profile writes (acceptable — authenticated endpoint)

Flag if found in any client-side file or NEXT_PUBLIC_ variable.

### 6. Authentication gaps
Read `app/api/chat/route.ts`. Verify:
- Every request extracts the user from Supabase auth (not trusts a user_id from the request body)
- There is no way to pass an arbitrary user_id in the request body and have it trusted

## Output format

Write a markdown report to `.claude/findings/YYYY-MM-DD-security.md` (use today's date).

Structure:
```markdown
# Security Review — YYYY-MM-DD

## Summary
X issues found: Y critical, Z warnings, W info

## Findings

### [CRITICAL/WARNING/INFO] Finding title
**File:** path/to/file.ts:line
**Issue:** What's wrong
**Risk:** What could happen
**Fix:** Specific code change to make

## Passed Checks
- List checks that found no issues
```

After saving, print the summary line and path to the findings file.
