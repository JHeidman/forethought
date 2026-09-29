import { describe, it, expect } from "vitest";
import { isValidEmail, normalizeSource, generateInviteCode, findValidCode, type InviteCode } from "../../lib/invites";

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("golfer@example.com")).toBe(true);
  });

  it("rejects missing domain, spaces, and non-strings", () => {
    expect(isValidEmail("golfer@")).toBe(false);
    expect(isValidEmail("gol fer@example.com")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it("rejects addresses over 254 characters", () => {
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("normalizeSource", () => {
  it("lowercases and keeps letters, digits, dash and underscore", () => {
    expect(normalizeSource("Reddit-Golf_2026")).toBe("reddit-golf_2026");
  });

  it("strips anything else, including markup", () => {
    expect(normalizeSource("<script>alert(1)</script>")).toBe("scriptalert1script");
  });

  it("caps length at 40", () => {
    expect(normalizeSource("x".repeat(100))).toHaveLength(40);
  });

  it("returns null for empty or non-string input", () => {
    expect(normalizeSource("")).toBeNull();
    expect(normalizeSource("!!!")).toBeNull();
    expect(normalizeSource(["reddit"])).toBeNull();
    expect(normalizeSource(undefined)).toBeNull();
  });
});

describe("generateInviteCode", () => {
  it("produces 8 characters with no easily confused ones", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it("does not repeat across a batch", () => {
    const batch = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
    expect(batch.size).toBe(500);
  });
});

describe("findValidCode", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const codes: InviteCode[] = [
    { code: "OPENCODE" },
    { code: "FUTURE01", expiresAt: "2026-11-01", source: "reddit" },
    { code: "PAST0001", expiresAt: "2026-09-01" },
  ];

  it("matches regardless of case and surrounding spaces", () => {
    const result = findValidCode(codes, "  opencode ", now);
    expect(result.valid).toBe(true);
  });

  it("returns the matched code so the source can be recorded", () => {
    const result = findValidCode(codes, "FUTURE01", now);
    expect(result.valid && result.match.source).toBe("reddit");
  });

  it("reports expired codes", () => {
    expect(findValidCode(codes, "PAST0001", now)).toEqual({ valid: false, reason: "expired" });
  });

  it("reports unknown codes", () => {
    expect(findValidCode(codes, "NOPE", now)).toEqual({ valid: false, reason: "invalid" });
  });
});
