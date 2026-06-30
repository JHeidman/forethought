// Functional test runner — hits live Vercel deployment, no auth required
// Run: node scripts/functional-test.mjs
// Output: .claude/findings/YYYY-MM-DD-functional.md

const BASE = "https://forethought-7s4a.vercel.app";
const results = [];

async function check(name, fn) {
  try {
    const { pass, detail } = await fn();
    results.push({ name, pass, detail });
    console.log(`${pass ? "✅" : "❌"} ${name}: ${detail}`);
  } catch (e) {
    results.push({ name, pass: false, detail: `threw: ${e.message}` });
    console.log(`❌ ${name}: threw: ${e.message}`);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

await check("Home redirects (not 404)", async () => {
  const res = await fetch(BASE + "/", { redirect: "manual" });
  const pass = res.status === 307 || res.status === 302 || res.status === 200;
  return { pass, detail: `status ${res.status}` };
});

await check("Login page loads", async () => {
  const res = await fetch(BASE + "/login");
  const pass = res.status === 200;
  const text = await res.text();
  const hasForm = text.includes("password") || text.includes("email");
  return { pass: pass && hasForm, detail: `status ${res.status}, form fields present: ${hasForm}` };
});

await check("Signup page loads", async () => {
  const res = await fetch(BASE + "/signup");
  return { pass: res.status === 200, detail: `status ${res.status}` };
});

await check("Forgot password page loads", async () => {
  const res = await fetch(BASE + "/forgot-password");
  return { pass: res.status === 200, detail: `status ${res.status}` };
});

await check("/api/chat rejects unauthenticated requests", async () => {
  const res = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
  });
  // Should be 401 or 403 — NOT 200 with a real reply
  const pass = res.status === 401 || res.status === 403;
  return { pass, detail: `status ${res.status} (expected 401 or 403)` };
});

await check("/api/admin/feedback rejects unauthenticated requests", async () => {
  const res = await fetch(BASE + "/api/admin/feedback");
  const pass = res.status === 401 || res.status === 403;
  return { pass, detail: `status ${res.status} (expected 401 or 403)` };
});

await check("/api/admin/health rejects unauthenticated requests", async () => {
  const res = await fetch(BASE + "/api/admin/health");
  const pass = res.status === 401 || res.status === 403;
  return { pass, detail: `status ${res.status} (expected 401 or 403)` };
});

await check("/api/admin/users rejects unauthenticated requests", async () => {
  const res = await fetch(BASE + "/api/admin/users");
  const pass = res.status === 401 || res.status === 403;
  return { pass, detail: `status ${res.status} (expected 401 or 403)` };
});

await check("/api/speak rejects empty body", async () => {
  const res = await fetch(BASE + "/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "" }),
  });
  const pass = res.status === 400;
  return { pass, detail: `status ${res.status} (expected 400)` };
});

await check("/api/transcribe rejects missing audio", async () => {
  const res = await fetch(BASE + "/api/transcribe", { method: "POST" });
  const pass = res.status === 400 || res.status === 500;
  return { pass, detail: `status ${res.status}` };
});

// ── Report ─────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
const date = new Date().toISOString().slice(0, 10);

const lines = [
  `# Functional Test Report — ${date}`,
  ``,
  `**${passed}/${results.length} passed** | ${failed} failed`,
  ``,
  `| Test | Result | Detail |`,
  `|------|--------|--------|`,
  ...results.map(r => `| ${r.name} | ${r.pass ? "✅ Pass" : "❌ Fail"} | ${r.detail} |`),
  ``,
  `_Run: \`node scripts/functional-test.mjs\`_`,
];

import { writeFileSync, mkdirSync } from "fs";
mkdirSync(".claude/findings", { recursive: true });
writeFileSync(`.claude/findings/${date}-functional.md`, lines.join("\n"));
console.log(`\nReport saved: .claude/findings/${date}-functional.md`);
if (failed > 0) process.exit(1);
