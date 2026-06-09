import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMainModel, getUtilityModel, getActiveTier } from "../../lib/model-router";

// Helpers to set / clear MODEL_TIER between tests
function setTier(tier: string | undefined) {
  if (tier === undefined) {
    delete process.env.MODEL_TIER;
  } else {
    process.env.MODEL_TIER = tier;
  }
}

describe("model-router", () => {
  const originalTier = process.env.MODEL_TIER;

  afterEach(() => {
    setTier(originalTier);
  });

  // ---------------------------------------------------------------------------
  // Standard tier (default)
  // ---------------------------------------------------------------------------

  describe("standard tier", () => {
    beforeEach(() => setTier("standard"));

    it("uses sonnet for off-course main chat", () => {
      expect(getMainModel(false)).toContain("sonnet");
    });

    it("uses haiku for on-course main chat", () => {
      expect(getMainModel(true)).toContain("haiku");
    });

    it("uses haiku for utility calls", () => {
      expect(getUtilityModel()).toContain("haiku");
    });

    it("reports tier as standard", () => {
      expect(getActiveTier()).toBe("standard");
    });
  });

  // ---------------------------------------------------------------------------
  // Economy tier
  // ---------------------------------------------------------------------------

  describe("economy tier", () => {
    beforeEach(() => setTier("economy"));

    it("uses haiku for all calls (off-course)", () => {
      expect(getMainModel(false)).toContain("haiku");
    });

    it("uses haiku for all calls (on-course)", () => {
      expect(getMainModel(true)).toContain("haiku");
    });

    it("uses haiku for utility calls", () => {
      expect(getUtilityModel()).toContain("haiku");
    });

    it("reports tier as economy", () => {
      expect(getActiveTier()).toBe("economy");
    });
  });

  // ---------------------------------------------------------------------------
  // Premium tier
  // ---------------------------------------------------------------------------

  describe("premium tier", () => {
    beforeEach(() => setTier("premium"));

    it("uses opus for off-course main chat", () => {
      expect(getMainModel(false)).toContain("opus");
    });

    it("uses sonnet for on-course (not opus — faster responses)", () => {
      expect(getMainModel(true)).toContain("sonnet");
    });

    it("still uses haiku for utility calls", () => {
      expect(getUtilityModel()).toContain("haiku");
    });

    it("reports tier as premium", () => {
      expect(getActiveTier()).toBe("premium");
    });
  });

  // ---------------------------------------------------------------------------
  // Default / fallback behaviour
  // ---------------------------------------------------------------------------

  describe("default fallback", () => {
    it("falls back to standard when MODEL_TIER is unset", () => {
      setTier(undefined);
      expect(getActiveTier()).toBe("standard");
    });

    it("falls back to standard for an unknown tier value", () => {
      setTier("turbo");
      expect(getActiveTier()).toBe("standard");
    });

    it("is case-insensitive — 'ECONOMY' resolves to economy tier", () => {
      setTier("ECONOMY");
      expect(getActiveTier()).toBe("economy");
      expect(getMainModel(false)).toContain("haiku");
    });
  });

  // ---------------------------------------------------------------------------
  // On-course model is always ≤ off-course model (speed guarantee)
  // ---------------------------------------------------------------------------

  describe("on-course is never heavier than off-course", () => {
    const tiers = ["economy", "standard", "premium"] as const;

    for (const tier of tiers) {
      it(`holds for ${tier} tier`, () => {
        setTier(tier);
        const onCourse = getMainModel(true);
        const offCourse = getMainModel(false);
        // On-course should never be opus when off-course is sonnet or haiku,
        // and never be sonnet when off-course is haiku.
        // Simplest invariant: if both are the same family it's fine; opus > sonnet > haiku
        const weight = (m: string) =>
          m.includes("opus") ? 3 : m.includes("sonnet") ? 2 : 1;
        expect(weight(onCourse)).toBeLessThanOrEqual(weight(offCourse));
      });
    }
  });
});
