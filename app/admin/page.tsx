"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Admin is restricted to Jeff's account
const ADMIN_EMAIL = "jh.berkut@gmail.com";

export default function AdminPage() {
  const router = useRouter();
  const [basePrompt, setBasePrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || user.email !== ADMIN_EMAIL) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const { data } = await supabase.from("settings").select("value").eq("key", "base_prompt").single();
      if (data) setBasePrompt(data.value);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();

    await supabase.from("settings").upsert({
      key: "base_prompt",
      value: basePrompt,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return <div className="min-h-full flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>;
  }

  if (unauthorized) {
    return (
      <div className="min-h-full flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">🚫</p>
          <p className="text-gray-400">Not authorized.</p>
          <Link href="/chat" className="text-green-400 text-sm mt-2 inline-block">← Back to chat</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <Link href="/chat" className="text-green-400 text-sm">← Back</Link>
        <h1 className="text-lg font-semibold">Admin</h1>
        <div className="w-16" />
      </header>

      <form onSubmit={handleSave} className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Base Prompt
            <span className="ml-2 text-xs text-gray-600">Shared rules for all personas</span>
          </label>
          <textarea
            value={basePrompt}
            onChange={(e) => setBasePrompt(e.target.value)}
            rows={12}
            className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-green-500 resize-none"
          />
          <p className="text-xs text-gray-600 mt-1">
            This is appended to every persona's personality prompt. Changes take effect immediately — no redeploy needed.
          </p>
        </div>

        <button type="submit" disabled={saving}
          className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold text-lg transition-colors">
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
