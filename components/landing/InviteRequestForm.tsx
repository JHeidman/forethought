"use client";

import { useState } from "react";

const HANDICAP_OPTIONS = [
  { value: "29-plus", label: "29+ (I contain multitudes)" },
  { value: "19-28", label: "19 to 28" },
  { value: "10-18", label: "10 to 18" },
  { value: "under-10", label: "Under 10 (are you lost?)" },
  { value: "no-idea", label: "No idea, I don't keep one" },
];

const WANTS_OPTIONS = [
  { value: "practice", label: "Practice help" },
  { value: "on-course", label: "On-course help" },
  { value: "both", label: "Both" },
];

export default function InviteRequestForm({ source }: { source: string | null }) {
  const [email, setEmail] = useState("");
  const [handicapRange, setHandicapRange] = useState("");
  const [wants, setWants] = useState("both");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/invite-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, handicapRange, wants, source, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else setError(data.error ?? "Something went wrong. Try again?");
    } catch {
      setError("Couldn't reach us. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-gray-900 border border-green-700 p-6 text-center">
        <p className="text-4xl mb-3">⛳</p>
        <h3 className="text-xl font-bold text-green-400 mb-2">You&apos;re on the list.</h3>
        <p className="text-gray-300">
          We&apos;re letting people in a few at a time. Your invite will come by email from Jeff, an actual person.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-gray-900 border border-gray-800 p-6 space-y-5">
      <div>
        <label htmlFor="invite-email" className="block text-sm text-gray-400 mb-1">Email</label>
        <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" placeholder="you@example.com"
          className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500" />
      </div>

      <div>
        <label htmlFor="invite-handicap" className="block text-sm text-gray-400 mb-1">Roughly, your handicap</label>
        <select id="invite-handicap" required value={handicapRange} onChange={(e) => setHandicapRange(e.target.value)}
          className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base focus:outline-none focus:border-green-500">
          <option value="" disabled>Pick one</option>
          {HANDICAP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <fieldset>
        <legend className="block text-sm text-gray-400 mb-2">What do you want most?</legend>
        <div className="grid grid-cols-3 gap-2">
          {WANTS_OPTIONS.map(o => (
            <button key={o.value} type="button" onClick={() => setWants(o.value)} aria-pressed={wants === o.value}
              className={`rounded-xl border px-2 py-3 text-sm font-medium transition-colors ${
                wants === o.value
                  ? "bg-green-700 border-green-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="hidden" aria-hidden="true">
        <label htmlFor="invite-website">Website</label>
        <input id="invite-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button type="submit" disabled={sending}
        className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold text-lg transition-colors">
        {sending ? "Sending…" : "Request an invite"}
      </button>

      <p className="text-xs text-gray-500 text-center leading-relaxed">
        We use your email to send your invite and to ask how it&apos;s going. No spam, and we never sell it.
      </p>
    </form>
  );
}
