import Link from "next/link";
import InviteRequestForm from "./InviteRequestForm";

const FEATURES = [
  {
    emoji: "🏌️",
    title: "At the range",
    body: "Stop beating balls and hoping. Frankie builds a practice plan around what's costing you strokes, then asks how it went.",
  },
  {
    emoji: "⛳",
    title: "On the course",
    body: "Tell her the yardage, get a club. Hands-free, out loud, no squinting at your phone. Also available: a calm voice after the triple bogey.",
  },
  {
    emoji: "🎯",
    title: "All season",
    body: "Tell her the number you're chasing. She remembers your game from one session to the next and keeps you honest about it.",
  },
];

export default function LandingPage({ source }: { source: string | null }) {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-5 py-4 max-w-3xl mx-auto">
        <span className="text-lg font-bold text-green-400">⛳ ForeThought</span>
        <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">Sign in</Link>
      </header>

      <main className="px-5 pb-20 max-w-3xl mx-auto">
        <section className="pt-10 pb-14 sm:pt-16">
          <p className="text-sm uppercase tracking-widest text-gray-500 mb-4">A public service announcement</p>
          <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight tracking-tight">
            Rich? Already good at golf?
            <span className="block text-green-400 mt-2">This app was NOT written for you.</span>
          </h1>
          <p className="text-xl text-gray-400 mt-5">(Congrats on that, though. Really.)</p>
          <p className="text-lg text-gray-300 mt-8 max-w-xl leading-relaxed">
            Go hire a swing coach and a caddy. They&apos;ll do wonders for your game. Probably. Maybe.
          </p>
        </section>

        <section className="border-t border-gray-800 pt-12 pb-14">
          <h2 className="text-3xl sm:text-4xl font-bold">This one&apos;s for the rest of us.</h2>
          <p className="text-lg text-gray-300 mt-5 max-w-xl leading-relaxed">
            The slicers. The toppers. The three-putt-from-six-feet crowd who still can&apos;t wait for Saturday.
          </p>
          <p className="text-lg text-gray-300 mt-4 max-w-xl leading-relaxed">
            Meet <span className="text-white font-semibold">Frankie</span>: a coach and caddy who talks, listens,
            and remembers your game. You get better, at a fraction of the cost.
          </p>
          <a href="#invite"
            className="inline-block mt-8 rounded-xl bg-green-600 hover:bg-green-500 px-6 py-3 text-white font-semibold text-lg transition-colors">
            I&apos;m one of us. Let me in.
          </a>
        </section>

        <section className="grid gap-4 sm:grid-cols-3 pb-14">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl bg-gray-900 border border-gray-800 p-5">
              <p className="text-3xl mb-3">{f.emoji}</p>
              <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-gray-800 p-6 mb-14">
          <h2 className="text-xl font-bold mb-3">The fine print, in normal-sized print</h2>
          <ul className="space-y-3 text-gray-300 leading-relaxed">
            <li>Frankie is an AI. She can&apos;t swing the club for you. We checked.</li>
            <li>She won&apos;t replace a great instructor. If you do take a lesson, tell her what you were told and she&apos;ll build your practice around it.</li>
            <li>This is an early test with a small group. It runs in your phone&apos;s browser and it has rough edges. We want to hear about every one of them.</li>
          </ul>
        </section>

        <section id="invite" className="scroll-mt-6 max-w-md mx-auto">
          <h2 className="text-3xl font-bold text-center mb-2">Want in?</h2>
          <p className="text-gray-400 text-center mb-6">It&apos;s free while we test. We&apos;re letting in a few golfers at a time.</p>
          <InviteRequestForm source={source} />
        </section>
      </main>

      <footer className="border-t border-gray-800 px-5 py-6 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="text-green-400 hover:underline">Sign in</Link>
      </footer>
    </div>
  );
}
