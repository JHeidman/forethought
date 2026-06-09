/**
 * ForeThought Model Router
 *
 * Controls which Claude model is used for each type of request.
 * Set MODEL_TIER in .env.local (or Vercel env vars) to switch tiers:
 *
 *   economy   — everything on haiku (dev/testing, lowest cost)
 *   standard  — main chat on sonnet, utilities on haiku (DEFAULT)
 *   premium   — main chat on opus, utilities on haiku
 *
 * On-course mode always uses a lighter model than the off-course main model
 * because responses are constrained to 2-3 sentences by the system prompt.
 */

export type ModelTier = "economy" | "standard" | "premium";

type ModelConfig = {
  /** Primary off-course chat responses */
  main: string;
  /** On-course mode (responses capped at 2-3 sentences by system prompt) */
  onCourse: string;
  /** Background utility calls: profile extraction, speech gen, topic summary,
   *  ai_notes extraction, plan ingredient extraction */
  utility: string;
};

const TIERS: Record<ModelTier, ModelConfig> = {
  economy: {
    main: "claude-haiku-4-5",
    onCourse: "claude-haiku-4-5",
    utility: "claude-haiku-4-5",
  },
  standard: {
    main: "claude-sonnet-4-6",
    onCourse: "claude-haiku-4-5",
    utility: "claude-haiku-4-5",
  },
  premium: {
    main: "claude-opus-4-8",
    onCourse: "claude-sonnet-4-6",
    utility: "claude-haiku-4-5",
  },
};

function getTier(): ModelTier {
  const raw = process.env.MODEL_TIER?.toLowerCase();
  if (raw === "economy" || raw === "standard" || raw === "premium") return raw;
  return "standard"; // safe default
}

/** Returns the full model config for the active tier */
export function getModelConfig(): ModelConfig {
  return TIERS[getTier()];
}

/** Returns the model to use for main chat responses */
export function getMainModel(isOnCourse = false): string {
  const config = getModelConfig();
  return isOnCourse ? config.onCourse : config.main;
}

/** Returns the model to use for utility/background calls */
export function getUtilityModel(): string {
  return getModelConfig().utility;
}

/** Returns the active tier name (for logging/debugging) */
export function getActiveTier(): ModelTier {
  return getTier();
}
