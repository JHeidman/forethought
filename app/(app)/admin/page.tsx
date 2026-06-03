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
  const [tab, setTab] = useState<"users" | "prompt" | "codes">("users");
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
  const [codes, setCodes] = useState<string[]>([]);
  const [newCode, setNewCode] = useState("");
  const [codesSaving, setCodesSaving] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);

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
    if (code && !codes.includes(code)) {
      setCodes([...codes, code]);
      setNewCode("");
    }
  }

  function removeCode(code: string) {
    setCodes(codes.filter(c => c !== code));
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
        {([["users", "👥 Users"], ["prompt", "✏️ Prompt"], ["codes", "🔑 Codes"]] as [typeof tab, string][]).map(([key, label]) => (
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
            <p className="text-sm text-gray-400">Invite codes required to create an account. Share these with testers.</p>

            <div className="space-y-2">
              {codes.map(code => (
                <div key={code} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3 border border-gray-700">
                  <span className="font-mono text-green-400 tracking-widest text-sm">{code}</span>
                  <button onClick={() => removeCode(code)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </div>
              ))}
              {codes.length === 0 && <p className="text-gray-600 text-sm">No codes yet.</p>}
            </div>

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

            <button onClick={saveCodes} disabled={codesSaving}
              className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold transition-colors">
              {codesSaved ? "Saved ✓" : codesSaving ? "Saving…" : "Save Codes"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
