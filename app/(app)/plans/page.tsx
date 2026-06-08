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
  const [seasonPlan, setSeasonPlan] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [seasonPlanExpanded, setSeasonPlanExpanded] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [plansRes, profileRes] = await Promise.all([
        supabase.from("practice_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("profiles").select("season_plan, goal").eq("id", user.id).single(),
      ]);

      setPlans(plansRes.data ?? []);
      setSeasonPlan(profileRes.data?.season_plan ?? null);
      setGoal(profileRes.data?.goal ?? null);
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

  const hasAnything = seasonPlan || plans.length > 0;

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
        <Link href="/chat" className="text-green-400 text-sm">← Back</Link>
        <h1 className="text-lg font-semibold">My Plans</h1>
        <div className="w-16" />
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6 pb-24">

        {!hasAnything && (
          <div className="text-center mt-16">
            <p className="text-4xl mb-3">🗺️</p>
            <p className="text-gray-400 font-medium">No plans yet</p>
            <p className="text-sm text-gray-600 mt-1">
              Tell your caddy what you&apos;re working toward and they&apos;ll help you build a roadmap.
            </p>
            <Link href="/chat" className="inline-block mt-4 text-green-400 text-sm hover:underline">
              Go talk to your caddy →
            </Link>
          </div>
        )}

        {/* Season Plan */}
        {seasonPlan && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Season Roadmap</p>
            <div className="bg-gray-800 rounded-2xl overflow-hidden border border-green-900">
              <button
                className="w-full text-left px-4 py-4 flex items-center justify-between"
                onClick={() => setSeasonPlanExpanded(!seasonPlanExpanded)}
              >
                <div>
                  <p className="font-semibold text-green-400">🎯 Your Season Plan</p>
                  {goal && <p className="text-xs text-gray-500 mt-0.5">{goal}</p>}
                </div>
                <span className="text-gray-500 text-lg">{seasonPlanExpanded ? "▲" : "▼"}</span>
              </button>

              {seasonPlanExpanded && (
                <div className="px-4 pb-5 border-t border-gray-700">
                  <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mt-4">
                    {seasonPlan}
                  </p>
                  <p className="text-xs text-gray-600 mt-4">
                    Your caddy updates this as they learn more about your game.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* No season plan yet — nudge */}
        {!seasonPlan && (
          <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700 border-dashed">
            <p className="text-sm text-gray-400 font-medium">🗺️ No season plan yet</p>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              {goal
                ? `Your caddy knows your goal ("${goal}") and is gathering the info needed to build your roadmap. Keep chatting!`
                : "Tell your caddy what you're working toward this season and they'll build a personalized roadmap to get you there."}
            </p>
            <Link href="/chat" className="inline-block mt-3 text-green-400 text-xs hover:underline">
              Continue talking to your caddy →
            </Link>
          </div>
        )}

        {/* Practice Plans */}
        {plans.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Practice Sessions</p>
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
          </div>
        )}

      </div>
    </div>
  );
}
