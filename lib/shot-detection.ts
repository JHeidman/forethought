/**
 * Detects when a player is announcing they're about to hit a club.
 * Returns the normalized club name (matching clubs table format) or null.
 *
 * Handles common speech patterns:
 *   "I'm going to hit my 7-iron"
 *   "hitting driver"
 *   "gonna use my PW"
 *   "sand wedge from here"
 *   "teeing off with driver"
 */

// Intent words that signal the player is announcing a shot (not discussing past shots)
const HIT_INTENT_RE = /\b(going to|gonna|about to|will hit|will use|hitting|taking|using|use|pull(?:ing)?|tee(?:ing)?(?:\s+off)?(?:\s+with)?|club(?:\s+up)?|putt(?:ing)?)\b/i;

type ClubEntry = {
  pattern: RegExp;
  name: string | ((m: RegExpMatchArray) => string);
};

// Ordered from most specific to least specific to avoid false matches
const CLUB_PATTERNS: ClubEntry[] = [
  // Named wedges (check before generic "wedge")
  { pattern: /\blob[\s-]?wedge\b|\b(lw)\b/i,                             name: "Lob Wedge" },
  { pattern: /\bsand[\s-]?wedge\b|\b(sw)\b/i,                            name: "Sand Wedge" },
  { pattern: /\bgap[\s-]?wedge\b|\bapproach[\s-]?wedge\b|\b(gw|aw)\b/i,  name: "Gap Wedge" },
  { pattern: /\bpitch(?:ing)?[\s-]?wedge\b|\b(pw)\b/i,                   name: "Pitching Wedge" },
  // Woods (check numbered before generic)
  { pattern: /\b(\d)[\s-]?wood\b/i,  name: (m) => `${m[1]}-wood` },
  // Hybrids
  { pattern: /\b(\d)[\s-]?hybrid\b/i, name: (m) => `${m[1]}-hybrid` },
  { pattern: /\bhybrid\b/i,           name: "4-hybrid" }, // default to most common
  // Irons (check "iron" explicitly — avoid matching lone digits)
  { pattern: /\b(\d)[\s-]?iron\b/i,  name: (m) => `${m[1]}-iron` },
  // Driver
  { pattern: /\bdriver\b/i,           name: "Driver" },
  // Putter
  { pattern: /\bputter\b|\bputt(?:ing)?\b/i, name: "Putter" },
];

export function detectShotAnnouncement(message: string): string | null {
  if (!HIT_INTENT_RE.test(message)) return null;

  for (const { pattern, name } of CLUB_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      const normalized = typeof name === "function" ? name(match) : name;
      return normalizeClubName(normalized);
    }
  }

  return null;
}

/**
 * Normalizes detected club name to match the STANDARD_CLUBS names in club-defaults.ts.
 * e.g. "7-iron" → "7-iron", "3-Wood" → "3-wood", "Driver" → "Driver"
 */
function normalizeClubName(raw: string): string {
  const lower = raw.toLowerCase();

  // Wedges — title case
  if (lower.includes("wedge")) {
    return raw.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  // Driver, Putter — title case
  if (lower === "driver" || lower === "putter") {
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  // Numbered clubs (3-wood, 5-iron, 4-hybrid) — lowercase hyphenated
  return lower;
}

/**
 * Fuzzy-match a detected club name against the player's actual bag.
 * Returns the best match from the bag, or the detected name if no close match.
 */
export function matchClubToBag(
  detected: string,
  bagClubs: Array<{ club_name: string }>
): string {
  const detLower = detected.toLowerCase();

  // Exact match first
  const exact = bagClubs.find(c => c.club_name.toLowerCase() === detLower);
  if (exact) return exact.club_name;

  // Partial match — e.g. "7-iron" matches "7-iron" even with different casing
  const partial = bagClubs.find(c => {
    const bagLower = c.club_name.toLowerCase();
    return bagLower.includes(detLower) || detLower.includes(bagLower);
  });
  if (partial) return partial.club_name;

  return detected; // return as-is if no match
}
