// Default club distances based on handicap, gender, and age bracket
// All distances in yards. Sources: USGA distance insights, Golf Digest averages, Shot Scope data.

export type AgeGroup = "under_30" | "30s" | "40s" | "50s" | "60_plus";
export type Gender = "male" | "female" | "other";

export const STANDARD_CLUBS = [
  { name: "Driver",         sortOrder: 1 },
  { name: "3-wood",         sortOrder: 2 },
  { name: "5-wood",         sortOrder: 3 },
  { name: "4-hybrid",       sortOrder: 4 },
  { name: "5-iron",         sortOrder: 5 },
  { name: "6-iron",         sortOrder: 6 },
  { name: "7-iron",         sortOrder: 7 },
  { name: "8-iron",         sortOrder: 8 },
  { name: "9-iron",         sortOrder: 9 },
  { name: "Pitching Wedge", sortOrder: 10 },
  { name: "Gap Wedge",      sortOrder: 11 },
  { name: "Sand Wedge",     sortOrder: 12 },
  { name: "Lob Wedge",      sortOrder: 13 },
];

// Base distances for male golfer, age 30s, by handicap bracket
const MALE_BASE: Record<string, number[]> = {
  // club            [scratch, 5, 10, 15, 20, 25, 30+]
  "Driver":          [255, 240, 230, 215, 200, 190, 178],
  "3-wood":          [235, 220, 210, 196, 182, 172, 161],
  "5-wood":          [218, 204, 194, 181, 168, 159, 149],
  "4-hybrid":        [210, 197, 187, 175, 162, 153, 144],
  "5-iron":          [195, 183, 173, 162, 150, 142, 133],
  "6-iron":          [184, 172, 163, 152, 141, 133, 125],
  "7-iron":          [172, 161, 153, 143, 132, 125, 117],
  "8-iron":          [158, 148, 140, 131, 121, 115, 107],
  "9-iron":          [143, 134, 127, 119, 110, 104, 97],
  "Pitching Wedge":  [128, 120, 114, 106, 98,  93,  87],
  "Gap Wedge":       [112, 105, 99,  93,  86,  81,  76],
  "Sand Wedge":      [95,  89,  84,  79,  73,  69,  64],
  "Lob Wedge":       [76,  71,  67,  63,  58,  55,  51],
};

// Female distances are roughly 75-80% of male base
const FEMALE_RATIO = 0.78;

// Age adjustment factors applied to base
const AGE_FACTOR: Record<AgeGroup, number> = {
  under_30: 1.04,
  "30s":    1.00,
  "40s":    0.96,
  "50s":    0.90,
  "60_plus": 0.82,
};

function handicapIndex(handicap: string): number {
  const h = parseFloat(handicap);
  if (isNaN(h)) return 20; // default for "casual", "beginner" etc.
  if (h <= 0)  return 0;
  if (h <= 5)  return 1;
  if (h <= 10) return 2;
  if (h <= 15) return 3;
  if (h <= 20) return 4;
  if (h <= 25) return 5;
  return 6;
}

export function getDefaultDistance(
  club: string,
  handicap: string,
  gender: Gender = "male",
  age: AgeGroup = "30s"
): number {
  const base = MALE_BASE[club];
  if (!base) return 0;

  const idx = handicapIndex(handicap);
  let distance = base[idx];

  if (gender === "female") {
    distance = Math.round(distance * FEMALE_RATIO);
  }

  distance = Math.round(distance * AGE_FACTOR[age]);
  return distance;
}

export function buildDefaultBasis(
  gender: Gender,
  age: AgeGroup,
  handicap: string
): string {
  const genderLabel = gender === "male" ? "male golfer" : gender === "female" ? "female golfer" : "golfer";
  const ageLabel: Record<AgeGroup, string> = {
    under_30: "under 30",
    "30s": "in your 30s",
    "40s": "in your 40s",
    "50s": "in your 50s",
    "60_plus": "60 or older",
  };
  const hNum = parseFloat(handicap);
  const hLabel = isNaN(hNum) ? handicap : `${hNum} handicap`;

  return `Estimated from typical distances for a ${genderLabel} ${ageLabel[age]} with a ${hLabel}`;
}

export function seedClubs(
  handicap: string,
  gender: Gender = "male",
  age: AgeGroup = "30s"
): Array<{
  club_name: string;
  expected_distance: number;
  distance_source: string;
  default_basis: string;
  sort_order: number;
}> {
  const basis = buildDefaultBasis(gender, age, handicap);
  return STANDARD_CLUBS.map(c => ({
    club_name: c.name,
    expected_distance: getDefaultDistance(c.name, handicap, gender, age),
    distance_source: "demographic_default",
    default_basis: basis,
    sort_order: c.sortOrder,
  }));
}
