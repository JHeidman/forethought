"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PERSONAS, PersonaKey } from "@/lib/personas";

type Profile = {
  name: string;
  handicap: string;
  home_course: string;
  player_notes: string;
  frankie_prefs: string;
  persona: PersonaKey;
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
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (data) {
        setProfile({
          name: data.name ?? "",
          handicap: data.handicap ?? "",
          home_course: data.home_course ?? "",
          player_notes: data.player_notes ?? "",
          frankie_prefs: data.frankie_prefs ?? "",
          persona: (data.persona as PersonaKey) ?? "frankie",
        });
      }
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

    await supabase.from("profiles").upsert({
      id: user.id,
      ...profile,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return <div className="min-h-full flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>;
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <Link href="/chat" className="text-green-400 text-sm">← Back</Link>
        <h1 className="text-lg font-semibold">Your Profile</h1>
        <Link href="/plans" className="text-green-400 text-sm">Plans →</Link>
      </header>

      <form onSubmit={handleSave} className="flex-1 px-4 py-6 space-y-6 max-w-lg mx-auto w-full">

        {/* Persona Selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-3">Your Caddy</label>
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(PERSONAS) as [PersonaKey, typeof PERSONAS[PersonaKey]][]).map(([key, p]) => (
              <button
                key={key}
                type="button"
                onClick={() => setProfile({ ...profile, persona: key })}
                className={`rounded-xl p-3 text-left border transition-colors ${
                  profile.persona === key
                    ? "border-green-500 bg-green-950"
                    : "border-gray-700 bg-gray-800 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{p.gender === "female" ? "👩" : "👨"}</span>
                  <span className="font-semibold text-white">{p.name}</span>
                </div>
                <p className="text-xs text-gray-400 leading-tight">{p.tagline}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Personal Caddy Instructions */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Personal Instructions
            <span className="ml-2 text-xs text-gray-600">How should your caddy treat you?</span>
          </label>
          <textarea
            value={profile.frankie_prefs}
            onChange={(e) => setProfile({ ...profile, frankie_prefs: e.target.value })}
            rows={3}
            className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base focus:outline-none focus:border-green-500 resize-none"
            placeholder='e.g. "Always be encouraging, never sarcastic with me" or "I am left-handed"'
          />
        </div>

        <div className="border-t border-gray-800 pt-4 space-y-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Golf Profile</p>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder="Jeff" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Handicap</label>
            <input value={profile.handicap} onChange={(e) => setProfile({ ...profile, handicap: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder='e.g. "12" or "casual"' />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Home Course</label>
            <input value={profile.home_course} onChange={(e) => setProfile({ ...profile, home_course: e.target.value })}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder="Augusta National (we can dream)" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Long-Term Memory
              <span className="ml-2 text-xs text-gray-500">Your caddy always knows this</span>
            </label>
            <textarea value={profile.player_notes} onChange={(e) => setProfile({ ...profile, player_notes: e.target.value })}
              rows={4}
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-base focus:outline-none focus:border-green-500 resize-none"
              placeholder="e.g. tends to decelerate on chip shots, struggles with fairway woods…" />
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold text-lg transition-colors">
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save Profile"}
        </button>

        <button type="button" onClick={handleSignOut}
          className="w-full rounded-xl border border-gray-700 hover:border-red-500 hover:text-red-400 px-4 py-3 text-gray-400 font-medium text-base transition-colors">
          Sign Out
        </button>
      </form>
    </div>
  );
}
