import { describe, it, expect } from "vitest";
import { detectShotAnnouncement, matchClubToBag } from "../../lib/shot-detection";

// ---------------------------------------------------------------------------
// detectShotAnnouncement
// ---------------------------------------------------------------------------

describe("detectShotAnnouncement", () => {
  // Should detect
  const shouldDetect: Array<[string, string]> = [
    // Driver
    ["hitting driver",                      "Driver"],
    ["I'm going to hit driver",             "Driver"],
    ["gonna use my driver",                 "Driver"],
    ["teeing off with driver",              "Driver"],

    // Woods
    ["hitting my 3-wood",                   "3-wood"],
    ["going to use 5 wood",                 "5-wood"],
    ["gonna hit 7-wood",                    "7-wood"],

    // Hybrids
    ["using my 4-hybrid",                   "4-hybrid"],
    ["hitting 3 hybrid",                    "3-hybrid"],
    ["going to hit hybrid",                 "4-hybrid"], // default hybrid

    // Irons
    ["hitting 7-iron",                      "7-iron"],
    ["gonna use my 5 iron",                 "5-iron"],
    ["going to hit 9-iron",                 "9-iron"],
    ["I'll use a 3-iron",                   "3-iron"],

    // Wedges
    ["hitting pitching wedge",              "Pitching Wedge"],
    ["gonna use my PW",                     "Pitching Wedge"],
    ["hitting gap wedge",                   "Gap Wedge"],
    ["using approach wedge",                "Gap Wedge"],
    ["hitting sand wedge",                  "Sand Wedge"],
    ["going to hit SW",                     "Sand Wedge"],
    ["hitting my LW",                       "Lob Wedge"],
    ["use the lob wedge here",              "Lob Wedge"],

    // Putter — "putting" / "gonna putt" are self-evidently a shot
    ["putting",                             "Putter"],
    ["gonna putt this one",                 "Putter"],
    ["using my putter",                     "Putter"],

    // "use" as standalone intent word
    ["I'll use a 3-iron",                   "3-iron"],
    ["use my 5-iron",                       "5-iron"],

    // Other casual speech
    ["pull out the 6-iron",                 "6-iron"],
    ["club up to a 4-iron",                 "4-iron"],
  ];

  for (const [input, expected] of shouldDetect) {
    it(`detects "${input}" → ${expected}`, () => {
      expect(detectShotAnnouncement(input)).toBe(expected);
    });
  }

  // Should NOT detect (past shots, questions, non-shot statements)
  const shouldNotDetect: string[] = [
    "that 7-iron was great",
    "I hit my driver 280 last time",   // past tense "hit" — no longer in intent regex
    "what club should I use?",         // question, not announcement
    "the wind is blowing left",
    "nice shot buddy",
    "I need a 6-iron",                 // "need" is not a hit-intent word
    "",
    "150 yards to the pin",
    "GW from here",                    // bare abbreviation, no intent word
    "lob wedge",                       // bare club name, no intent word
  ];

  for (const input of shouldNotDetect) {
    it(`does not detect "${input}"`, () => {
      expect(detectShotAnnouncement(input)).toBeNull();
    });
  }

  it("is case-insensitive", () => {
    expect(detectShotAnnouncement("HITTING DRIVER")).toBe("Driver");
    expect(detectShotAnnouncement("Going To Use My PITCHING WEDGE")).toBe("Pitching Wedge");
  });
});

// ---------------------------------------------------------------------------
// matchClubToBag
// ---------------------------------------------------------------------------

describe("matchClubToBag", () => {
  const bag = [
    { club_name: "Driver" },
    { club_name: "3-wood" },
    { club_name: "5-iron" },
    { club_name: "7-iron" },
    { club_name: "Pitching Wedge" },
    { club_name: "Sand Wedge" },
    { club_name: "Putter" },
  ];

  it("returns exact match (same case)", () => {
    expect(matchClubToBag("Driver", bag)).toBe("Driver");
    expect(matchClubToBag("7-iron", bag)).toBe("7-iron");
  });

  it("returns case-insensitive match", () => {
    expect(matchClubToBag("driver", bag)).toBe("Driver");
    expect(matchClubToBag("PUTTER", bag)).toBe("Putter");
  });

  it("returns partial match when substring matches", () => {
    expect(matchClubToBag("pitching wedge", bag)).toBe("Pitching Wedge");
  });

  it("returns detected name when no match found in bag", () => {
    expect(matchClubToBag("4-hybrid", bag)).toBe("4-hybrid");
  });

  it("handles empty bag gracefully", () => {
    expect(matchClubToBag("Driver", [])).toBe("Driver");
  });
});
