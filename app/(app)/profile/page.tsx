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
  carry_distance: number | null;
  distance_source: string;
  default_basis: string | null;
  brand: string | null;
  club_model: string | null;
  loft: number | null;
  lie_angle: number | null;
  shaft_flex: string | null;
  shaft_material: string | null;
  confidence: number | null;
  typical_shape: string | null;
  notes: string | null;
  specs_source: string | null;
};

type ClubEditState = {
  expected_distance: string;
  carry_distance: string;
  brand: string;
  club_model: string;
  loft: string;
  lie_angle: string;
  shaft_flex: string;
  shaft_material: string;
  confidence: number;
  typical_shape: string;
  notes: string;
};

const SHAFT_FLEX_OPTIONS = ["Ladies", "Senior", "Regular", "Stiff", "X-Stiff"];
const SHAFT_MATERIAL_OPTIONS = ["Graphite", "Steel"];
const SHAPE_OPTIONS = ["Fade", "Straight", "Draw", "Variable"];

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
  const [editValues, setEditValues] = useState<ClubEditState>({
    expected_distance: "",
    carry_distance: "",
    brand: "",
    club_model: "",
    loft: "",
    lie_angle: "",
    shaft_flex: "",
    shaft_material: "",
    confidence: 0,
    typical_shape: "",
    notes: "",
  });
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [savingClub, setSavingClub] = useState(false);
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
        supabase.from("clubs").select("*").eq("user_id", user.id).order("sort_order"),
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

  function openClubEdit(club: Club) {
    setEditingClub(club.club_name);
    setLookupNote(null);
    setEditValues({
      expected_distance: String(club.expected_distance),
      carry_distance: club.carry_distance ? String(club.carry_distance) : "",
      brand: club.brand ?? "",
      club_model: club.club_model ?? "",
      loft: club.loft ? String(club.loft) : "",
      lie_angle: club.lie_angle ? String(club.lie_angle) : "",
      shaft_flex: club.shaft_flex ?? "",
      shaft_material: club.shaft_material ?? "",
      confidence: club.confidence ?? 0,
      typical_shape: club.typical_shape ?? "",
      notes: club.notes ?? "",
    });
  }

  async function lookupSpecs(clubName: string) {
    if (!editValues.brand || !editValues.club_model) return;
    setLookingUp(true);
    setLookupNote(null);
    try {
      const res = await fetch("/api/clubs/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: editValues.brand,
          model: editValues.club_model,
          clubType: clubName,
        }),
      });
      const data = await res.json();
      if (data.unknown || data.error) {
        setLookupNote("No specs found for this club. You can enter them manually.");
      } else {
        setEditValues(prev => ({
          ...prev,
          loft: data.loft ? String(data.loft) : prev.loft,
          lie_angle: data.lie_angle ? String(data.lie_angle) : prev.lie_angle,
          shaft_flex: (data.shaft_flex_options?.[Math.floor(data.shaft_flex_options.length / 2)]) ?? prev.shaft_flex,
          shaft_material: data.shaft_material ?? prev.shaft_material,
        }));
        setLookupNote(data.notes ?? "Specs loaded — adjust anything that doesn't match your setup.");
      }
    } catch {
      setLookupNote("Lookup failed. You can enter specs manually.");
    } finally {
      setLookingUp(false);
    }
  }

  async function saveClub(clubName: string) {
    setSavingClub(true);
    const payload = {
      club_name: clubName,
      expected_distance: parseInt(editValues.expected_distance) || undefined,
      carry_distance: editValues.carry_distance ? parseInt(editValues.carry_distance) : null,
      brand: editValues.brand || null,
      club_model: editValues.club_model || null,
      loft: editValues.loft ? parseFloat(editValues.loft) : null,
      lie_angle: editValues.lie_angle ? parseFloat(editValues.lie_angle) : null,
      shaft_flex: editValues.shaft_flex || null,
      shaft_material: editValues.shaft_material || null,
      confidence: editValues.confidence || null,
      typical_shape: editValues.typical_shape || null,
      notes: editValues.notes || null,
      specs_source: lookupNote && !lookupNote.startsWith("No specs") ? "lookup" : "user",
    };

    const res = await fetch("/api/clubs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setClubs(prev => prev.map(c => c.club_name === clubName ? {
        ...c,
        expected_distance: parseInt(editValues.expected_distance) || c.expected_distance,
        carry_distance: editValues.carry_distance ? parseInt(editValues.carry_distance) : null,
        brand: editValues.brand || null,
        club_model: editValues.club_model || null,
        loft: editValues.loft ? parseFloat(editValues.loft) : null,
        lie_angle: editValues.lie_angle ? parseFloat(editValues.lie_angle) : null,
        shaft_flex: editValues.shaft_flex || null,
        shaft_material: editValues.shaft_material || null,
        confidence: editValues.confidence || null,
        typical_shape: editValues.typical_shape || null,
        notes: editValues.notes || null,
        distance_source: "user_input",
      } : c));
      setEditingClub(null);
    }
    setSavingClub(false);
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
              placeholder='e.g. "Break 90 by end of summer"' />
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
              <p className="text-xs text-gray-600">Tap a club to edit</p>
            </div>
            <div className="space-y-2">
              {clubs.map(c => (
                <div key={c.club_name}>
                  {/* Club summary row */}
                  <button
                    onClick={() => editingClub === c.club_name ? setEditingClub(null) : openClubEdit(c)}
                    className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors text-left ${
                      editingClub === c.club_name
                        ? "bg-gray-750 border-green-600"
                        : "bg-gray-800 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{c.club_name}</p>
                      {c.brand && c.club_model && (
                        <p className="text-xs text-gray-500 truncate">{c.brand} {c.club_model}</p>
                      )}
                      {!c.brand && c.default_basis && c.distance_source === "demographic_default" && (
                        <p className="text-xs text-gray-600">{c.default_basis}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      {/* Confidence dots */}
                      {c.confidence && c.confidence > 0 && (
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map(n => (
                            <div key={n} className={`w-1.5 h-1.5 rounded-full ${n <= c.confidence! ? "bg-green-500" : "bg-gray-700"}`} />
                          ))}
                        </div>
                      )}
                      {/* Shot shape badge */}
                      {c.typical_shape && (
                        <span className="text-xs text-gray-500 italic">{c.typical_shape.toLowerCase()}</span>
                      )}
                      <div className="text-right">
                        <span className="text-white font-mono text-sm">{c.expected_distance}</span>
                        <span className="text-gray-500 text-xs ml-1">yds</span>
                      </div>
                      <span className="text-gray-600 text-xs">{editingClub === c.club_name ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded editor */}
                  {editingClub === c.club_name && (
                    <div className="bg-gray-900 rounded-xl border border-gray-700 mt-1 p-4 space-y-5">

                      {/* Equipment identity */}
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Equipment</p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Brand</label>
                            <input
                              value={editValues.brand}
                              onChange={e => setEditValues(v => ({ ...v, brand: e.target.value }))}
                              placeholder="e.g. TaylorMade"
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Model</label>
                            <input
                              value={editValues.club_model}
                              onChange={e => setEditValues(v => ({ ...v, club_model: e.target.value }))}
                              placeholder="e.g. Stealth 2"
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                        </div>
                        {editValues.brand && editValues.club_model && (
                          <button
                            onClick={() => lookupSpecs(c.club_name)}
                            disabled={lookingUp}
                            className="w-full rounded-lg bg-gray-800 border border-green-700 text-green-400 px-3 py-2 text-sm font-medium hover:bg-green-950 disabled:opacity-50 transition-colors"
                          >
                            {lookingUp ? "Looking up specs…" : "✨ Look up specs"}
                          </button>
                        )}
                        {lookupNote && (
                          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{lookupNote}</p>
                        )}
                      </div>

                      {/* Distances */}
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Distances</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Total (yds)</label>
                            <input
                              type="number"
                              value={editValues.expected_distance}
                              onChange={e => setEditValues(v => ({ ...v, expected_distance: e.target.value }))}
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Carry (yds)</label>
                            <input
                              type="number"
                              value={editValues.carry_distance}
                              onChange={e => setEditValues(v => ({ ...v, carry_distance: e.target.value }))}
                              placeholder="optional"
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Feel */}
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Feel</p>
                        <div className="space-y-3">
                          {/* Confidence */}
                          <div>
                            <label className="text-xs text-gray-500 mb-2 block">Confidence with this club</label>
                            <div className="flex gap-2">
                              {[1,2,3,4,5].map(n => (
                                <button
                                  key={n}
                                  onClick={() => setEditValues(v => ({ ...v, confidence: v.confidence === n ? 0 : n }))}
                                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                    n <= editValues.confidence
                                      ? "bg-green-700 border-green-600 text-white"
                                      : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600"
                                  }`}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                            <div className="flex justify-between text-xs text-gray-600 mt-1 px-1">
                              <span>Avoid it</span>
                              <span>Love it</span>
                            </div>
                          </div>
                          {/* Shot shape */}
                          <div>
                            <label className="text-xs text-gray-500 mb-2 block">Typical shot shape</label>
                            <div className="flex gap-2 flex-wrap">
                              {SHAPE_OPTIONS.map(shape => (
                                <button
                                  key={shape}
                                  onClick={() => setEditValues(v => ({ ...v, typical_shape: v.typical_shape === shape ? "" : shape }))}
                                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                    editValues.typical_shape === shape
                                      ? "bg-green-700 border-green-600 text-white"
                                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                                  }`}
                                >
                                  {shape}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Specs */}
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Specs <span className="text-gray-600 normal-case">(optional)</span></p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Loft (°)</label>
                            <input
                              type="number"
                              step="0.5"
                              value={editValues.loft}
                              onChange={e => setEditValues(v => ({ ...v, loft: e.target.value }))}
                              placeholder="e.g. 10.5"
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Lie angle (°)</label>
                            <input
                              type="number"
                              step="0.5"
                              value={editValues.lie_angle}
                              onChange={e => setEditValues(v => ({ ...v, lie_angle: e.target.value }))}
                              placeholder="e.g. 62"
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Shaft flex</label>
                            <select
                              value={editValues.shaft_flex}
                              onChange={e => setEditValues(v => ({ ...v, shaft_flex: e.target.value }))}
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            >
                              <option value="">— select —</option>
                              {SHAFT_FLEX_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">Shaft material</label>
                            <select
                              value={editValues.shaft_material}
                              onChange={e => setEditValues(v => ({ ...v, shaft_material: e.target.value }))}
                              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
                            >
                              <option value="">— select —</option>
                              {SHAFT_MATERIAL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Notes <span className="text-gray-600 normal-case">(optional)</span></label>
                        <textarea
                          value={editValues.notes}
                          onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))}
                          rows={2}
                          placeholder='e.g. "New this season" or "borrowed shaft, slightly long"'
                          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500 resize-none"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setEditingClub(null)}
                          className="flex-1 rounded-xl border border-gray-700 text-gray-400 py-2.5 text-sm hover:border-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveClub(c.club_name)}
                          disabled={savingClub}
                          className="flex-1 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-2.5 text-sm font-medium transition-colors"
                        >
                          {savingClub ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Only distances matter — everything else is optional but helps your caddy give better advice.
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
