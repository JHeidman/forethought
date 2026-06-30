"use client";

interface Panel {
  emoji: string;
  title: string;
  subtitle: string;
  prompt: string;
}

const PANELS: Panel[] = [
  {
    emoji: "🏌️",
    title: "Practice Planning",
    subtitle: "Build a focused session",
    prompt: "Let's build me a practice plan. Here's what I want to work on:",
  },
  {
    emoji: "⛳",
    title: "Round Prep",
    subtitle: "Get ready for today's round",
    prompt: "I'm playing today. Help me get ready — here's where I'm playing and what I want to focus on:",
  },
  {
    emoji: "🎯",
    title: "My Goals",
    subtitle: "Track what you're working toward",
    prompt: "Let's talk about my golf goals. Here's where I am right now:",
  },
  {
    emoji: "💡",
    title: "Quick Tip",
    subtitle: "One thing to work on right now",
    prompt: "Give me one specific thing to work on right now. My biggest issue lately is:",
  },
];

interface Props {
  onSelect: (prompt: string) => void;
}

export default function EngagementPanels({ onSelect }: Props) {
  return (
    <div className="px-4 pb-4">
      <p className="text-center text-sm text-gray-400 mb-3">
        What are we working on today?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {PANELS.map((panel, i) => (
          <button
            key={i}
            onClick={() => onSelect(panel.prompt)}
            aria-label={panel.title}
            className="flex flex-col items-start gap-1 rounded-2xl bg-gray-800 border border-gray-700 p-4 text-left transition-all active:scale-95 hover:border-green-600 hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <span className="text-2xl">{panel.emoji}</span>
            <span className="text-sm font-semibold text-white leading-tight">
              {panel.title}
            </span>
            <span className="text-xs text-gray-400 leading-tight">
              {panel.subtitle}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
