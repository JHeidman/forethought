import { describe, it, expect } from "vitest";
import { buildAnnouncementsBlock, type AnnouncementItem } from "../../lib/announcements";

// Helpers
function makeAnn(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "abc-123",
    version: "1.0 · Jun 2025",
    title: "GPS Shot Tracking",
    summary: "I now track your shot distances automatically using GPS.",
    detail: "Full detail about GPS shot tracking.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty / no announcements
// ---------------------------------------------------------------------------

describe("buildAnnouncementsBlock — empty", () => {
  it("returns empty string when no announcements", () => {
    expect(buildAnnouncementsBlock([], "Jeff")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Single announcement
// ---------------------------------------------------------------------------

describe("buildAnnouncementsBlock — single announcement", () => {
  const ann = makeAnn();
  const result = buildAnnouncementsBlock([ann], "Jeff");

  it("returns a non-empty string", () => {
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses singular 'thing' in the count phrase for one announcement", () => {
    expect(result).toContain("1 new thing");
    // The count phrase should be singular — "1 new thing", not "1 new things"
    expect(result).not.toContain("1 new things");
  });

  it("includes the player's first name", () => {
    expect(result).toContain("Jeff");
  });

  it("includes the announcement title in the what's new list", () => {
    expect(result).toContain("GPS Shot Tracking");
  });

  it("includes the summary in the what's new list", () => {
    expect(result).toContain(ann.summary);
  });

  it("includes the full detail section", () => {
    expect(result).toContain("Full detail about GPS shot tracking.");
  });

  it("includes the version in the detail section", () => {
    expect(result).toContain("1.0 · Jun 2025");
  });

  it("contains the conversational cue phrase", () => {
    expect(result).toContain("new tricks since we last talked");
  });

  it("instructs not to bring it up again", () => {
    expect(result).toContain("one-time welcome-back share");
  });

  it("starts with the section header", () => {
    expect(result.startsWith("YOUR NEW CAPABILITIES TO SHARE:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple announcements
// ---------------------------------------------------------------------------

describe("buildAnnouncementsBlock — multiple announcements", () => {
  const anns: AnnouncementItem[] = [
    makeAnn({ id: "1", title: "GPS Shot Tracking",   summary: "Summary A", detail: "Detail A", version: "1.0" }),
    makeAnn({ id: "2", title: "Hands-Free Modes",    summary: "Summary B", detail: "Detail B", version: "1.1" }),
    makeAnn({ id: "3", title: "Season Planning",     summary: "Summary C", detail: "Detail C", version: "1.2" }),
  ];
  const result = buildAnnouncementsBlock(anns, "Sarah");

  it("uses plural 'things' for multiple announcements", () => {
    expect(result).toContain("3 new things");
  });

  it("includes all titles", () => {
    expect(result).toContain("GPS Shot Tracking");
    expect(result).toContain("Hands-Free Modes");
    expect(result).toContain("Season Planning");
  });

  it("includes all summaries", () => {
    expect(result).toContain("Summary A");
    expect(result).toContain("Summary B");
    expect(result).toContain("Summary C");
  });

  it("includes all details", () => {
    expect(result).toContain("Detail A");
    expect(result).toContain("Detail B");
    expect(result).toContain("Detail C");
  });

  it("formats each what's-new line with a dash prefix", () => {
    expect(result).toContain("- GPS Shot Tracking: Summary A");
    expect(result).toContain("- Hands-Free Modes: Summary B");
  });

  it("uses the provided first name", () => {
    expect(result).toContain("Sarah");
    expect(result).not.toContain("Jeff");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("buildAnnouncementsBlock — edge cases", () => {
  it("handles a first name of 'there' (unknown player)", () => {
    const result = buildAnnouncementsBlock([makeAnn()], "there");
    expect(result).toContain("there");
    expect(result.length).toBeGreaterThan(0);
  });

  it("detail section separates multiple announcements with a blank line", () => {
    const anns = [
      makeAnn({ id: "1", title: "A", detail: "Detail A", version: "v1" }),
      makeAnn({ id: "2", title: "B", detail: "Detail B", version: "v2" }),
    ];
    const result = buildAnnouncementsBlock(anns, "Jeff");
    // The two detail blocks should be separated by double newline
    expect(result).toContain("Detail A\n\nB");
  });

  it("each what's-new bullet is on its own line", () => {
    const anns = [
      makeAnn({ id: "1", title: "Alpha", summary: "Sum A" }),
      makeAnn({ id: "2", title: "Beta",  summary: "Sum B" }),
    ];
    const result = buildAnnouncementsBlock(anns, "Jeff");
    const lines = result.split("\n");
    const alphaBullet = lines.find(l => l.includes("Alpha"));
    const betaBullet  = lines.find(l => l.includes("Beta") && l.startsWith("-"));
    expect(alphaBullet).toBeDefined();
    expect(betaBullet).toBeDefined();
    // They should be different lines
    expect(alphaBullet).not.toBe(betaBullet);
  });

  it("title and version both appear in the detail block", () => {
    const ann = makeAnn({ title: "Cool Feature", version: "2.5 · Dec 2025", detail: "Does something great." });
    const result = buildAnnouncementsBlock([ann], "Jeff");
    expect(result).toContain("Cool Feature (2.5 · Dec 2025): Does something great.");
  });
});
