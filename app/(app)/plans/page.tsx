"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Plan = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data } = await supabase
        .from("practice_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setPlans(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function deletePlan(id: string) {
    setDeleting(id);
    const supabase = createClient();
    await supabase.from("practice_plans").delete().eq("id", id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  if (loading) {
    return <div className="min-h-full flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>;
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <Link href="/chat" className="text-green-400 text-sm">← Back</Link>
        <h1 className="text-lg font-semibold">Practice Plans</h1>
        <div className="w-16" />
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        {plans.length === 0 ? (
          <div className="text-center mt-16">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-400 font-medium">No saved plans yet</p>
            <p className="text-sm text-gray-600 mt-1">Ask your caddy to create a practice plan and save it.</p>
            <Link href="/chat" className="inline-block mt-4 text-green-400 text-sm hover:underline">
              Go talk to your caddy →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <div key={plan.id} className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
                <button
                  className="w-full text-left px-4 py-4 flex items-center justify-between"
                  onClick={() => setExpanded(expanded === plan.id ? null : plan.id)}
                >
                  <div>
                    <p className="font-medium text-white">{plan.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(plan.created_at)}</p>
                  </div>
                  <span className="text-gray-500 text-lg">{expanded === plan.id ? "▲" : "▼"}</span>
                </button>

                {expanded === plan.id && (
                  <div className="px-4 pb-4 border-t border-gray-700">
                    <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mt-3">
                      {plan.content}
                    </p>
                    <button
                      onClick={() => deletePlan(plan.id)}
                      disabled={deleting === plan.id}
                      className="mt-4 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {deleting === plan.id ? "Deleting…" : "Delete plan"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
