/**
 * ForeThought API Tests
 * Run with: node tests/api.test.js
 * Requires the dev server to be running on localhost:3000
 */

const fs = require("fs");
const path = require("path");

// Load env
const env = fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8");
env.split("\n").forEach((line) => {
  const [k, ...v] = line.split("=");
  if (k && v.length) process.env[k.trim()] = v.join("=").trim();
});

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL || "jh.berkut+test@gmail.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

let sessionCookie = "";

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

async function apiCall(path, body, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...options.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Capture cookies from auth
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];

  return res;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function login() {
  if (!TEST_PASSWORD) {
    console.log("  ⚠ TEST_PASSWORD not set — skipping authenticated tests");
    return false;
  }

  const { createBrowserClient } = require("@supabase/ssr");

  // Use a mock cookie store to capture whatever cookies @supabase/ssr sets
  const cookieStore = {};
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
        setAll: (cookies) => cookies.forEach(({ name, value }) => { cookieStore[name] = value; }),
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error) throw new Error(`Login failed: ${error.message}`);

  // Build cookie header from all captured cookies
  sessionCookie = Object.entries(cookieStore)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");

  return true;
}

// ── Test Suites ───────────────────────────────────────────────────────────────

async function testServer() {
  console.log("\n📡 Server reachability");

  await test("Dev server is running", async () => {
    const res = await fetch(`${BASE_URL}/login`);
    assert(res.ok, `Got ${res.status}`);
  });
}

async function testChatAPI() {
  console.log("\n💬 Chat API");

  await test("Rejects unauthenticated requests", async () => {
    const saved = sessionCookie;
    sessionCookie = "";
    const res = await apiCall("/api/chat", { message: "hello" });
    sessionCookie = saved;
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test("Rejects empty message", async () => {
    const res = await apiCall("/api/chat", { message: "" });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("Returns reply for valid message", async () => {
    const res = await apiCall("/api/chat", { message: "What club should I use from 150 yards?" });
    assert(res.ok, `Got ${res.status}`);
    const data = await res.json();
    assert(data.reply, "No reply field in response");
    assert(data.reply.length > 0, "Reply is empty");
  });

  await test("Greeting flow returns reply", async () => {
    const res = await apiCall("/api/chat", { message: "hello", isGreeting: true });
    assert(res.ok, `Got ${res.status}`);
    const data = await res.json();
    assert(data.reply, "No reply in greeting response");
  });
}

async function testSpeakAPI() {
  console.log("\n🔊 Speak API");

  await test("Rejects empty text", async () => {
    const res = await apiCall("/api/speak", { text: "" });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test("Returns audio for valid text", async () => {
    const res = await apiCall("/api/speak", { text: "Great shot. Keep that weight forward." });
    assert(res.ok, `Got ${res.status}`);
    assert(
      res.headers.get("content-type")?.includes("audio"),
      `Expected audio content-type, got ${res.headers.get("content-type")}`
    );
  });
}

async function testDatabase() {
  console.log("\n🗄️  Database");

  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  await test("Profiles table is accessible", async () => {
    const { error } = await sb.from("profiles").select("id").limit(1);
    assert(!error, `DB error: ${error?.message}`);
  });

  await test("Messages table is accessible", async () => {
    const { error } = await sb.from("messages").select("id").limit(1);
    assert(!error, `DB error: ${error?.message}`);
  });

  await test("Settings table exists with base_prompt", async () => {
    const { data, error } = await sb.from("settings").select("value").eq("key", "base_prompt").single();
    assert(!error, `DB error: ${error?.message}`);
    assert(data?.value, "base_prompt is empty");
  });

  await test("Practice plans table is accessible", async () => {
    const { error } = await sb.from("practice_plans").select("id").limit(1);
    assert(!error, `DB error: ${error?.message}`);
  });

  await test("Jeff's profile exists and is complete", async () => {
    const { data, error } = await sb
      .from("profiles")
      .select("name, handicap, home_course, persona")
      .eq("id", "18d31da6-3803-41d1-9033-143f3fe296f3")
      .single();
    assert(!error, `DB error: ${error?.message}`);
    assert(data.name, "Name is missing");
    assert(data.handicap, "Handicap is missing");
    assert(data.home_course, "Home course is missing");
  });
}

async function testNewFeatures() {
  console.log("\n🆕 New Features");

  await test("Chat returns speech and reply fields", async () => {
    const res = await apiCall("/api/chat", { message: "What club from 150 yards?" });
    assert(res.ok, `Got ${res.status}`);
    const data = await res.json();
    assert(data.reply, "No reply field");
    assert(data.speech, "No speech field");
    assert(data.voiceId, "No voiceId field");
    assert(data.personaName, "No personaName field");
  });

  await test("Speech field is shorter than or equal to reply", async () => {
    const res = await apiCall("/api/chat", { message: "Give me a full practice plan for the driving range with 5 different drills." });
    assert(res.ok, `Got ${res.status}`);
    const data = await res.json();
    assert(data.speech.length <= data.reply.length, "Speech is longer than reply");
  });

  await test("Speak API uses voiceId param", async () => {
    const res = await apiCall("/api/speak", {
      text: "Great shot.",
      voiceId: "EXAVITQu4vr4xnSDxMaL", // Sam's voice
    });
    assert(res.ok, `Got ${res.status}`);
    assert(res.headers.get("content-type")?.includes("audio"), "Expected audio");
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nForeThought API Tests`);
  console.log(`Target: ${BASE_URL}`);
  console.log("─".repeat(40));

  await testServer();
  await testDatabase();

  const loggedIn = await login();
  if (loggedIn) {
    await testChatAPI();
    await testSpeakAPI();
    await testNewFeatures();
  }

  console.log("\n" + "─".repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
