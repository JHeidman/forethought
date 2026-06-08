"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PERSONAS, PersonaKey } from "@/lib/personas";

type Profile = {
  name: string;
  handicap: string;
  home_course: string;
  player_notes: string;
  frankie_prefs: string;
  persona: PersonaKey;
  goal: string;
};

type Club = {
  club_name: string;
  expected_distance: number;
  distance_source: string;
  default_basis: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({
    name: "",
    handicap: "",
    home_course: "",
    player_notes: "",
    frankie_prefs: "",
    persona: "frankie",
    goal: "",
  });
  const [clubs, setClubs] = useState<Club[]>([]);
  const [editingClub, setEditingClub] = useState<string | null>(null);
  const [editingDistance, setEditingDistance] = useState<string>("");
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [clearingAiNotes, setClearingAiNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [profileRes, clubsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("clubs").select("club_name, expected_distance, distance_source, default_basis").eq("user_id", user.id).order("sort_order"),
      ]);

      if (profileRes.data) {
        setProfile({
          name: profileRes.data.name ?? "",
          handicap: profileRes.data.handicap ?? "",
          home_course: profileRes.data.home_course ?? "",
          player_notes: profileRes.data.player_notes ?? "",
          frankie_prefs: profileRes.data.frankie_prefs ?? "",
          persona: (profileRes.data.persona as PersonaKey) ?? "frankie",
          goal: profileRes.data.goal ?? "",
        });
        setAiNotes(profileRes.data.ai_notes ?? null);
      }
      setClubs(clubsRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").upsert({ id: user.id, ...profile, updated_at: new Date().toISOString() });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveClubDistance(clubName: string, distance: number) {
    const res = await fetch("/api/clubs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ club_name: clubName, expected_distance: distance }),
    });
    if (res.ok) {
      setClubs(prev => prev.map(c =>
        c.club_name === clubName
          ? { ...c, expected_distance: distance, distance_source: "user_input", default_basis: "Set by you" }
          : c
      ));
    }
    setEditingClub(null);
  }

  async function clearAiNotes() {
    setClearingAiNotes(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ ai_notes: null }).eq("id", user.id);
    setAiNotes(null);
    setClearingAiNotes(false);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) return <div className="min-h-full flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Your Profile</h1>
      </header>

      <div className="flex-1 px-4 py-6 space-y-8 max-w-lg mx-auto w-full pb-24">

        {/* Persona Selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-3">Your Caddy</label>
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(PERSONAS) as [PersonaKey, typeof PERSONAS[PersonaKey]][]).map(([key, p]) => (
              <button key={key} type="button" onClick={() => setProfile({ ...profile, persona: key })}
                className={`rounded-xl p-3 text-left border transition-colors ${profile.persona === key ? "border-green-500 bg-green-950" : "border-gray-700 bg-gray-800 hover:border-gray-600"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{p.gender === "female" ? "👩" : "👨"}</span>
                  <span className="font-semibold text-white">{p.name}</span>
                </div>
                <p className="text-xs text-gray-400 leading-tight">{p.tagline}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Personal Instructions */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Personal Instructions
            <span className="ml-2 text-xs text-gray-600">How should your caddy treat you?</span>
          </label>
          <textarea value={profile.frankie_prefs} onChange={(e) => setProfile({ ...profile, frankie_prefs: e.target.value })}
            rows={3} className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base focus:outline-none focus:border-green-500 resize-none"
            placeholder='e.g. "Always be encouraging" or "I am left-handed"' />
        </div>

        {/* Golf Profile */}
        <div className="border-t border-gray-800 pt-6 space-y-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Golf Profile</p>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500" placeholder="Jeff" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Handicap</label>
            <input value={profile.handicap} onChange={(e) => setProfile({ ...profile, handicap: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500" placeholder='e.g. "12" or "casual"' />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Home Course</label>
            <input value={profile.home_course} onChange={(e) => setProfile({ ...profile, home_course: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500" placeholder="Augusta National (we can dream)" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Your Goal
              <span className="ml-2 text-xs text-gray-600">What are you working toward this season?</span>
            </label>
            <input value={profile.goal} onChange={(e) => setProfile({ ...profile, goal: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder='e.g. "Break 90 by end of summer" or "Get to a 15 handicap"' />
            <p className="text-xs text-gray-600 mt-1">Your caddy will keep this in mind and help you get there.</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Long-Term Memory
              <span className="ml-2 text-xs text-gray-500">Your caddy always knows this</span>
            </label>
            <textarea value={profile.player_notes} onChange={(e) => setProfile({ ...profile, player_notes: e.target.value })}
              rows={4} className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base focus:outline-none focus:border-green-500 resize-none"
              placeholder="e.g. tends to decelerate on chip shots…" />
          </div>
        </div>

        <form onSubmit={handleSave}>
          <button type="submit" disabled={saving}
            className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold text-lg transition-colors">
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save Profile"}
          </button>
        </form>

        {/* My Bag */}
        {clubs.length > 0 && (
          <div className="border-t border-gray-800 pt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide">My Bag</p>
              <p className="text-xs text-gray-600">Tap a distance to edit</p>
            </div>
            <div className="space-y-2">
              {clubs.map(c => (
                <div key={c.club_name} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3 border border-gray-700">
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{c.club_name}</p>
                    {c.default_basis && c.distance_source === "demographic_default" && (
                      <p className="text-xs text-gray-500 mt-0.5">{c.default_basis}</p>
                    )}
                    {c.distance_source === "user_input" && (
                      <p className="text-xs text-green-600 mt-0.5">Your distance</p>
                    )}
                  </div>

                  {editingClub === c.club_name ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={editingDistance}
                        onChange={(e) => setEditingDistance(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveClubDistance(c.club_name, parseInt(editingDistance));
                          if (e.key === "Escape") setEditingClub(null);
                        }}
                        className="w-16 rounded-lg bg-gray-900 border border-green-500 px-2 py-1 text-white text-sm text-center focus:outline-none"
                        autoFocus
                      />
                      <span className="text-gray-500 text-xs">yds</span>
                      <button onClick={() => saveClubDistance(c.club_name, parseInt(editingDistance))}
                        className="text-green-400 text-xs hover:text-green-300">✓</button>
                      <button onClick={() => setEditingClub(null)} className="text-gray-500 text-xs hover:text-gray-300">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingClub(c.club_name); setEditingDistance(String(c.expected_distance)); }}
                      className="flex items-center gap-1 group">
                      <span className="text-white font-mono">{c.expected_distance}</span>
                      <span className="text-gray-500 text-xs">yds</span>
                      <span className="text-gray-600 text-xs group-hover:text-gray-400 ml-1">✏️</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Distances marked "estimated" are based on typical values for your profile. Update any that don&apos;t match your actual game.
            </p>
          </div>
        )}

        {/* AI Coaching Notes */}
        <div className="border-t border-gray-800 pt-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">What Your Caddy Has Learned</p>
              <p className="text-xs text-gray-600 mt-0.5">Auto-updated every 10 messages</p>
            </div>
            {aiNotes && (
              <button onClick={clearAiNotes} disabled={clearingAiNotes}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50">
                {clearingAiNotes ? "Clearing…" : "Clear"}
              </button>
            )}
          </div>

          {aiNotes ? (
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{aiNotes}</p>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-sm text-gray-600 italic">Nothing captured yet. After a few conversations, your caddy will start noting what they&apos;ve learned about your game here.</p>
            </div>
          )}
        </div>

        <button type="button" onClick={handleSignOut}
          className="w-full rounded-xl border border-gray-700 hover:border-red-500 hover:text-red-400 px-4 py-3 text-gray-400 font-medium text-base transition-colors">
          Sign Out
        </button>

      </div>
    </div>
  );
}
