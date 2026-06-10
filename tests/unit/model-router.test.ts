import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getModel, getMainModel, getUtilityModel } from "../../lib/model-router";

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  // Restore original env after each test
  for (const key of ["MODEL_LOW", "MODEL_STANDARD", "MODEL_PREMIUM"]) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// ---------------------------------------------------------------------------
// getModel — slot resolution and env var override
// ---------------------------------------------------------------------------

describe("getModel — defaults", () => {
  beforeEach(() => setEnv({ MODEL_LOW: undefined, MODEL_STANDARD: undefined, MODEL_PREMIUM: undefined }));

  it("low slot defaults to haiku", () => {
    expect(getModel("low")).toContain("haiku");
  });

  it("standard slot defaults to sonnet", () => {
    expect(getModel("standard")).toContain("sonnet");
  });

  it("premium slot defaults to opus", () => {
    expect(getModel("premium")).toContain("opus");
  });
});

describe("getModel — env var overrides", () => {
  it("MODEL_LOW overrides the low slot", () => {
    setEnv({ MODEL_LOW: "claude-custom-low" });
    expect(getModel("low")).toBe("claude-custom-low");
  });

  it("MODEL_STANDARD overrides the standard slot", () => {
    setEnv({ MODEL_STANDARD: "claude-custom-standard" });
    expect(getModel("standard")).toBe("claude-custom-standard");
  });

  it("MODEL_PREMIUM overrides the premium slot", () => {
    setEnv({ MODEL_PREMIUM: "claude-custom-premium" });
    expect(getModel("premium")).toBe("claude-custom-premium");
  });

  it("slots are independent — overriding one does not affect others", () => {
    setEnv({ MODEL_LOW: "claude-custom-low", MODEL_STANDARD: undefined, MODEL_PREMIUM: undefined });
    expect(getModel("low")).toBe("claude-custom-low");
    expect(getModel("standard")).toContain("sonnet");
    expect(getModel("premium")).toContain("opus");
  });
});

// ---------------------------------------------------------------------------
// getMainModel — context-based routing
// ---------------------------------------------------------------------------

describe("getMainModel — off-course standard", () => {
  it("uses standard slot by default", () => {
    expect(getMainModel()).toContain("sonnet");
  });

  it("isOnCourse=false, isComplex=false → standard", () => {
    expect(getMainModel(false, false)).toContain("sonnet");
  });
});

describe("getMainModel — on-course", () => {
  it("on-course routes to low slot (fast responses)", () => {
    expect(getMainModel(true)).toContain("haiku");
  });

  it("on-course takes priority over isComplex", () => {
    // Even a complex request should use the fast model on-course
    expect(getMainModel(true, true)).toContain("haiku");
  });
});

describe("getMainModel — complex off-course", () => {
  it("complex off-course routes to premium slot", () => {
    expect(getMainModel(false, true)).toContain("opus");
  });
});

describe("getMainModel — env var overrides flow through", () => {
  it("overriding MODEL_STANDARD changes off-course default", () => {
    setEnv({ MODEL_STANDARD: "claude-test-standard" });
    expect(getMainModel(false, false)).toBe("claude-test-standard");
  });

  it("overriding MODEL_LOW changes on-course model", () => {
    setEnv({ MODEL_LOW: "claude-test-low" });
    expect(getMainModel(true)).toBe("claude-test-low");
  });

  it("overriding MODEL_PREMIUM changes complex model", () => {
    setEnv({ MODEL_PREMIUM: "claude-test-premium" });
    expect(getMainModel(false, true)).toBe("claude-test-premium");
  });
});

// ---------------------------------------------------------------------------
// getUtilityModel
// ---------------------------------------------------------------------------

describe("getUtilityModel", () => {
  it("uses low slot by default", () => {
    expect(getUtilityModel()).toContain("haiku");
  });

  it("overriding MODEL_LOW changes utility model", () => {
    setEnv({ MODEL_LOW: "claude-test-low" });
    expect(getUtilityModel()).toBe("claude-test-low");
  });
});

// ---------------------------------------------------------------------------
// Invariant: on-course ≤ off-course in capability
// ---------------------------------------------------------------------------

describe("on-course model is never heavier than off-course", () => {
  const weight = (m: string) =>
    m.includes("opus") ? 3 : m.includes("sonnet") ? 2 : 1;

  it("holds with default env vars", () => {
    expect(weight(getMainModel(true))).toBeLessThanOrEqual(weight(getMainModel(false)));
  });

  it("holds when MODEL_STANDARD is set to opus", () => {
    setEnv({ MODEL_STANDARD: "claude-opus-4-8" });
    // on-course still uses MODEL_LOW (haiku by default)
    expect(weight(getMainModel(true))).toBeLessThanOrEqual(weight(getMainModel(false)));
  });
});
