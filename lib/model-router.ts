/**
 * ForeThought Model Router
 *
 * Three independently-configurable model slots, set via env vars:
 *
 *   MODEL_LOW      — fast, cheap  (default: claude-haiku-4-5)
 *   MODEL_STANDARD — balanced     (default: claude-sonnet-4-6)
 *   MODEL_PREMIUM  — most capable (default: claude-opus-4-8)
 *
 * To upgrade a slot when a new model ships, just update the env var on
 * Vercel — no code changes needed.
 *
 * Routing picks the slot based on request context:
 *
 *   LOW      — on-course yardage/club advice, utility/background calls,
 *              short conversational replies
 *   STANDARD — off-course chat, tool calls (save_plan, update clubs, etc.)
 *   PREMIUM  — complex analysis: season plans, detailed swing diagnosis
 *              (reserved — not currently used unless explicitly requested)
 */

const DEFAULTS = {
  low:     "claude-haiku-4-5",
  standard: "claude-sonnet-4-6",
  premium: "claude-opus-4-8",
} as const;

export type ModelSlot = "low" | "standard" | "premium";

/** The resolved model string for each slot */
export function getModel(slot: ModelSlot): string {
  switch (slot) {
    case "low":     return process.env.MODEL_LOW      || DEFAULTS.low;
    case "standard": return process.env.MODEL_STANDARD || DEFAULTS.standard;
    case "premium": return process.env.MODEL_PREMIUM  || DEFAULTS.premium;
  }
}

/**
 * Pick the right model slot for a main chat response.
 *
 * @param isOnCourse  True when a round is active — short, fast responses needed
 * @param isComplex   True for season plans or multi-part swing diagnosis
 */
export function getMainModel(isOnCourse = false, isComplex = false): string {
  if (isOnCourse) return getModel("low");
  if (isComplex)  return getModel("premium");
  return getModel("standard");
}

/** Background/utility calls — profile extraction, ai_notes, topic summary, etc. */
export function getUtilityModel(): string {
  return getModel("low");
}
