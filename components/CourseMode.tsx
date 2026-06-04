"use client";

import { useState } from "react";

type CourseResult = {
  id: number;
  club_name: string;
  course_name: string;
  location: { city: string; state: string };
};

type RoundContext = {
  courseId: number;
  courseName: string;
  tee: string;
  conditions: string;
};

type Props = {
  onStart: (ctx: RoundContext) => void;
  onEnd: () => void;
  activeRound: RoundContext | null;
};

export default function CourseMode({ onStart, onEnd, activeRound }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseResult[]>([]);
  const [selected, setSelected] = useState<CourseResult | null>(null);
  const [tee, setTee] = useState("White");
  const [conditions, setConditions] = useState("");
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    const res = await fetch(`/api/course?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.courses ?? []);
    setSearching(false);
  }

  function startRound() {
    if (!selected) return;
    onStart({
      courseId: selected.id,
      courseName: `${selected.club_name} — ${selected.course_name}`,
      tee,
      conditions,
    });
    setOpen(false);
  }

  if (activeRound) {
    return (
      <div className="flex items-center justify-between bg-green-950 border border-green-800 rounded-xl px-3 py-2 mx-3 mb-2">
        <div>
          <p className="text-xs text-green-400 font-medium">⛳ On the course</p>
          <p className="text-xs text-gray-400">{activeRound.courseName} · {activeRound.tee} tees</p>
        </div>
        <button onClick={onEnd} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
          End round
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="px-3 mb-2">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-700 text-gray-500 hover:border-green-600 hover:text-green-400 text-sm transition-colors"
        >
          <span>⛳</span>
          <span>Playing today? Set your course</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Set today&apos;s course</p>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">×</button>
      </div>

      {!selected ? (
        <>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="Search for a course…"
              className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
            />
            <button onClick={search} disabled={searching}
              className="rounded-xl bg-green-700 hover:bg-green-600 px-3 py-2 text-white text-sm disabled:opacity-50">
              {searching ? "…" : "Search"}
            </button>
          </div>

          {results.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {results.map(c => (
                <button key={c.id} onClick={() => setSelected(c)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors">
                  <p className="text-white text-sm font-medium">{c.club_name}</p>
                  <p className="text-gray-400 text-xs">{c.course_name} · {c.location.city}, {c.location.state}</p>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
            <div>
              <p className="text-white text-sm font-medium">{selected.club_name}</p>
              <p className="text-gray-400 text-xs">{selected.course_name}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-500 hover:text-gray-300">Change</button>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Which tees?</label>
            <div className="flex gap-2 flex-wrap">
              {["Red", "White", "Blue", "Gold", "Black"].map(t => (
                <button key={t} onClick={() => setTee(t)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${tee === t ? "border-green-500 text-green-400 bg-green-950" : "border-gray-700 text-gray-500"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Conditions <span className="text-gray-600">(optional)</span></label>
            <input
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder="e.g. windy, morning dew, firm fairways"
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
            />
          </div>

          <button onClick={startRound}
            className="w-full rounded-xl bg-green-600 hover:bg-green-500 px-4 py-2 text-white font-medium text-sm transition-colors">
            Start Round ⛳
          </button>
        </>
      )}
    </div>
  );
}
