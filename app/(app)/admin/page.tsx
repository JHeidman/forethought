"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = "jh.berkut@gmail.com";

const PERSONA_LABELS: Record<string, string> = {
  frankie: "🟢 Frankie",
  sam: "🔵 Sam",
  coach: "🟠 Coach",
  ace: "🟣 Ace",
};

type UserStat = {
  id: string;
  email: string;
  name: string | null;
  persona: string;
  handicap: string | null;
  is_admin: boolean;
  signedUpAt: string;
  messageCount: number;
  lastActive: string | null;
  planCount: number;
  estimatedCostUsd: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"users" | "prompt" | "codes" | "news" | "feedback" | "health">("users");
  const [unauthorized, setUnauthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  // Users tab
  const [users, setUsers] = useState<UserStat[]>([]);
  const [totalCost, setTotalCost] = useState("0.00");
  const [usersLoading, setUsersLoading] = useState(false);

  // Prompt tab
  const [basePrompt, setBasePrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Codes tab
  type InviteCode = { code: string; expiresAt?: string | null };
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [newCode, setNewCode] = useState("");
  const [newExpiry, setNewExpiry] = useState("");

  // News tab
  type Announcement = { id: string; version: string; title: string; summary: string; detail: string; is_active: boolean; created_at: string };
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newAnn, setNewAnn] = useState({ version: "", title: "", summary: "", detail: "" });
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsSaving, setNewsSaving] = useState(false);
  const [codesSaving, setCodesSaving] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);

  // Feedback tab
  type FeedbackItem = { id: string; type: "persona_gap" | "user_suggestion"; description: string; user_message: string; created_at: string; user_id: string; userName?: string };
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Health tab
  type ServiceStatus = { name: string; ok: boolean; detail: string };
  type HealthData = { services: Record<string, ServiceStatus>; checkedAt: string };
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || user.email !== ADMIN_EMAIL) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const { data: promptData } = await supabase.from("settings").select("value").eq("key", "base_prompt").single();
      if (promptData) setBasePrompt(promptData.value);

      const { data: codesData } = await supabase.from("settings").select("value").eq("key", "invite_codes").single();
      if (codesData) setCodes(JSON.parse(codesData.value));

      setLoading(false);
      loadUsers();
      loadAnnouncements();
      loadFeedback();
    }
    init();
  }, []);

  async function loadUsers() {
    setUsersLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setTotalCost(data.totalCostUsd);
    }
    setUsersLoading(false);
  }

  async function savePrompt(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    await supabase.from("settings").upsert({ key: "base_prompt", value: basePrompt, updated_at: new Date().toISOString() });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveCodes() {
    setCodesSaving(true);
    const supabase = createClient();
    await supabase.from("settings").upsert({ key: "invite_codes", value: JSON.stringify(codes), updated_at: new Date().toISOString() });
    setCodesSaving(false);
    setCodesSaved(true);
    setTimeout(() => setCodesSaved(false), 2000);
  }

  function addCode() {
    const code = newCode.trim().toUpperCase();
    if (code && !codes.find(c => c.code === code)) {
      setCodes([...codes, { code, expiresAt: newExpiry || null }]);
      setNewCode("");
      setNewExpiry("");
    }
  }

  function removeCode(code: string) {
    setCodes(codes.filter(c => c.code !== code));
  }

  async function loadFeedback() {
    setFeedbackLoading(true);
    const res = await fetch("/api/admin/feedback");
    if (res.ok) {
      const data = await res.json();
      setFeedback(data.feedback ?? []);
    }
    setFeedbackLoading(false);
  }

  async function deleteFeedback(id: string) {
    await fetch("/api/admin/feedback", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setFeedback(prev => prev.filter(f => f.id !== id));
  }

  async function loadHealth() {
    setHealthLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch("/api/admin/health", { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setHealth(await res.json());
    setHealthLoading(false);
  }

  async function loadAnnouncements() {
    setNewsLoading(true);
    const supabase = createClient();
    // Use service-role bypass by selecting without RLS filter via admin path
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    setAnnouncements(data ?? []);
    setNewsLoading(false);
  }

  async function toggleAnnouncement(id: string, currentActive: boolean) {
    const supabase = createClient();
    await supabase.from("announcements").update({ is_active: !currentActive }).eq("id", id);
    setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, is_active: !currentActive } : a));
  }

  async function deleteAnnouncement(id: string) {
    if (!confirm("Delete this announcement? This cannot be undone.")) return;
    const supabase = createClient();
    await supabase.from("announcements").delete().eq("id", id);
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  }

  async function addAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!newAnn.version.trim() || !newAnn.title.trim() || !newAnn.summary.trim() || !newAnn.detail.trim()) return;
    setNewsSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("announcements").insert({
      version: newAnn.version.trim(),
      title: newAnn.title.trim(),
      summary: newAnn.summary.trim(),
      detail: newAnn.detail.trim(),
      is_active: true,
    }).select().single();
    if (!error && data) {
      setAnnouncements(prev => [data, ...prev]);
      setNewAnn({ version: "", title: "", summary: "", detail: "" });
    }
    setNewsSaving(false);
  }

  function isExpired(expiresAt?: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (loading) return <div className="min-h-full flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>;

  if (unauthorized) return (
    <div className="min-h-full flex items-center justify-center px-4">
      <div className="text-center"><p className="text-4xl mb-3">🚫</p><p className="text-gray-400">Not authorized.</p></div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-4 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Admin</h1>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 shrink-0">
        {([["users", "👥 Users"], ["prompt", "✏️ Prompt"], ["codes", "🔑 Codes"], ["news", "📢 News"], ["feedback", "💬 Feedback"], ["health", "🩺 Health"]] as [typeof tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? "border-green-500 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Users Tab */}
        {tab === "users" && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-400">{users.length} users · Est. total cost: <span className="text-green-400">${totalCost}</span></p>
              <button onClick={loadUsers} disabled={usersLoading} className="text-xs text-gray-500 hover:text-gray-300">
                {usersLoading ? "Loading…" : "↻ Refresh"}
              </button>
            </div>

            {usersLoading && users.length === 0 ? (
              <p className="text-gray-500 text-sm">Loading users…</p>
            ) : (
              <div className="space-y-3">
                {users.map(u => (
                  <div key={u.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {u.name ?? "—"}
                          {u.is_admin && <span className="text-xs text-yellow-400 ml-2">admin</span>}
                        </p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                      <span className="text-xs text-gray-500">{PERSONA_LABELS[u.persona] ?? u.persona}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-gray-500">Signed up</p><p className="text-gray-300">{formatDate(u.signedUpAt)}</p></div>
                      <div><p className="text-gray-500">Last active</p><p className="text-gray-300">{formatDate(u.lastActive)}</p></div>
                      <div><p className="text-gray-500">Handicap</p><p className="text-gray-300">{u.handicap ?? "—"}</p></div>
                      <div><p className="text-gray-500">Messages</p><p className="text-gray-300">{u.messageCount}</p></div>
                      <div><p className="text-gray-500">Plans</p><p className="text-gray-300">{u.planCount}</p></div>
                      <div><p className="text-gray-500">Est. cost</p><p className="text-green-400">${u.estimatedCostUsd}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt Tab */}
        {tab === "prompt" && (
          <form onSubmit={savePrompt} className="p-4 space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Base Prompt
                <span className="ml-2 text-xs text-gray-600">Changes take effect immediately — no redeploy needed</span>
              </label>
              <textarea
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                rows={14}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-green-500 resize-none"
              />
            </div>
            <button type="submit" disabled={saving}
              className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold transition-colors">
              {saved ? "Saved ✓" : saving ? "Saving…" : "Save Prompt"}
            </button>
          </form>
        )}

        {/* Codes Tab */}
        {tab === "codes" && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-400">Each code generates a unique invite link. Share the link — the code is embedded and users don&apos;t need to type it.</p>

            <div className="space-y-4">
              {codes.map(c => {
                const inviteUrl = `https://forethought-7s4a.vercel.app/signup?code=${c.code}`;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(inviteUrl)}`;
                return (
                  <div key={c.code} className={`bg-gray-800 rounded-xl p-4 border ${isExpired(c.expiresAt) ? "border-red-800 opacity-60" : "border-gray-700"}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span className={`font-mono tracking-widest text-sm font-bold ${isExpired(c.expiresAt) ? "text-red-400 line-through" : "text-green-400"}`}>{c.code}</span>
                        {c.expiresAt ? (
                          <p className={`text-xs mt-0.5 ${isExpired(c.expiresAt) ? "text-red-500" : "text-gray-500"}`}>
                            {isExpired(c.expiresAt) ? "Expired" : "Expires"} {new Date(c.expiresAt).toLocaleDateString()}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-600 mt-0.5">No expiry</p>
                        )}
                      </div>
                      <button onClick={() => removeCode(c.code)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                    </div>

                    {!isExpired(c.expiresAt) && (
                      <div className="flex gap-3 items-start">
                        {/* QR Code */}
                        <img src={qrUrl} alt={`QR for ${c.code}`} className="w-24 h-24 rounded-lg bg-white p-1 shrink-0" />

                        {/* Link */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Invite link</p>
                          <p className="text-xs text-gray-300 break-all font-mono bg-gray-900 rounded-lg px-3 py-2">{inviteUrl}</p>
                          <button
                            onClick={() => navigator.clipboard.writeText(inviteUrl)}
                            className="mt-2 text-xs text-green-400 hover:text-green-300"
                          >
                            Copy link
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {codes.length === 0 && <p className="text-gray-600 text-sm">No codes yet.</p>}
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCode(); } }}
                  placeholder="NEW CODE"
                  className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white font-mono tracking-widest uppercase focus:outline-none focus:border-green-500"
                />
                <button onClick={addCode} className="rounded-xl bg-gray-700 hover:bg-gray-600 px-4 py-3 text-white font-medium">
                  Add
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">Expires on (optional):</label>
                <input
                  type="date"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                />
              </div>
            </div>

            <button onClick={saveCodes} disabled={codesSaving}
              className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold transition-colors">
              {codesSaved ? "Saved ✓" : codesSaving ? "Saving…" : "Save Codes"}
            </button>
          </div>
        )}

        {/* News Tab */}
        {tab === "news" && (
          <div className="p-4 space-y-6">

            {/* Existing announcements */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-300">Announcements</h2>
                <button onClick={loadAnnouncements} disabled={newsLoading} className="text-xs text-gray-500 hover:text-gray-300">
                  {newsLoading ? "Loading…" : "↻ Refresh"}
                </button>
              </div>

              {announcements.length === 0 && !newsLoading && (
                <p className="text-gray-600 text-sm">No announcements yet.</p>
              )}

              <div className="space-y-3">
                {announcements.map(a => (
                  <div key={a.id} className={`bg-gray-800 rounded-xl p-4 border ${a.is_active ? "border-gray-700" : "border-gray-800 opacity-50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs text-gray-500 font-mono">{a.version}</span>
                          {a.is_active
                            ? <span className="text-xs bg-green-900 text-green-400 px-1.5 py-0.5 rounded">live</span>
                            : <span className="text-xs bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">hidden</span>}
                        </div>
                        <p className="font-medium text-white text-sm">{a.title}</p>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{a.summary}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <button
                          onClick={() => toggleAnnouncement(a.id, a.is_active)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          {a.is_active ? "Hide" : "Show"}
                        </button>
                        <button
                          onClick={() => deleteAnnouncement(a.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">{formatDate(a.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Add new announcement */}
            <form onSubmit={addAnnouncement} className="space-y-3 border-t border-gray-800 pt-4">
              <h2 className="text-sm font-semibold text-gray-300">New Announcement</h2>
              <p className="text-xs text-gray-600">Users who haven&apos;t seen this will hear about it from Frankie on their next session.</p>

              <input
                value={newAnn.version}
                onChange={e => setNewAnn(v => ({ ...v, version: e.target.value }))}
                placeholder="Version / date — e.g. '1.3 · Jun 2025'"
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
              />
              <input
                value={newAnn.title}
                onChange={e => setNewAnn(v => ({ ...v, title: e.target.value }))}
                placeholder="Feature title — e.g. 'GPS Shot Tracking'"
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
              />
              <textarea
                value={newAnn.summary}
                onChange={e => setNewAnn(v => ({ ...v, summary: e.target.value }))}
                placeholder="Short summary (1-2 sentences) — what Frankie tells the player"
                rows={2}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-green-500"
              />
              <textarea
                value={newAnn.detail}
                onChange={e => setNewAnn(v => ({ ...v, detail: e.target.value }))}
                placeholder="Full detail — shown when the player asks for more info"
                rows={4}
                className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-green-500"
              />
              <button
                type="submit"
                disabled={newsSaving}
                className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold transition-colors"
              >
                {newsSaving ? "Adding…" : "Add Announcement"}
              </button>
            </form>
          </div>
        )}

        {/* Feedback Tab */}
        {tab === "feedback" && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{feedback.length} items</p>
                <p className="text-xs text-gray-600 mt-0.5">Persona gaps Frankie filed + player suggestions from chat</p>
              </div>
              <button onClick={loadFeedback} disabled={feedbackLoading} className="text-xs text-gray-500 hover:text-gray-300">
                {feedbackLoading ? "Loading…" : "↻ Refresh"}
              </button>
            </div>

            {feedbackLoading && feedback.length === 0 && (
              <p className="text-gray-500 text-sm">Loading…</p>
            )}

            {!feedbackLoading && feedback.length === 0 && (
              <p className="text-gray-600 text-sm">Nothing yet — gaps and suggestions will appear here as players chat.</p>
            )}

            <div className="space-y-3">
              {feedback.map(f => (
                <div key={f.id} className={`rounded-xl p-4 border ${f.type === "persona_gap" ? "bg-red-950 border-red-800" : "bg-blue-950 border-blue-800"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${f.type === "persona_gap" ? "bg-red-900 text-red-300" : "bg-blue-900 text-blue-300"}`}>
                      {f.type === "persona_gap" ? "⚠️ Persona gap" : "💡 Suggestion"}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-500">{f.userName} · {formatDate(f.created_at)}</span>
                      <button onClick={() => deleteFeedback(f.id)} className="text-xs text-gray-600 hover:text-red-400">✕</button>
                    </div>
                  </div>
                  <p className="text-white text-sm leading-relaxed">{f.description}</p>
                  {f.user_message && (
                    <p className="text-xs text-gray-500 mt-2 italic border-t border-gray-700 pt-2">
                      &ldquo;{f.user_message}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Health Tab */}
        {tab === "health" && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-600">Live status of all external APIs</p>
              <button onClick={loadHealth} disabled={healthLoading} className="text-xs text-gray-500 hover:text-gray-300">
                {healthLoading ? "Checking…" : "↻ Check now"}
              </button>
            </div>

            {!health && !healthLoading && (
              <button onClick={loadHealth} className="w-full py-8 rounded-xl border border-dashed border-gray-700 text-gray-500 text-sm hover:border-gray-500 hover:text-gray-300 transition-colors">
                Tap to check API health
              </button>
            )}

            {healthLoading && (
              <p className="text-gray-500 text-sm text-center py-8">Checking services…</p>
            )}

            {health && (
              <>
                <div className="space-y-3">
                  {Object.values(health.services).map((svc) => (
                    <div key={svc.name} className={`rounded-xl p-4 border flex items-start gap-3 ${svc.ok ? "bg-green-950 border-green-800" : "bg-red-950 border-red-800"}`}>
                      <span className="text-xl">{svc.ok ? "✅" : "🔴"}</span>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium">{svc.name}</p>
                        <p className={`text-xs mt-0.5 ${svc.ok ? "text-green-400" : "text-red-400"}`}>{svc.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-600 text-center">Checked {new Date(health.checkedAt).toLocaleTimeString()}</p>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
