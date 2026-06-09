import { describe, it, expect } from "vitest";
import {
  haversineYards,
  isGpsReliable,
  assessShotDistance,
  calculateExpectedDistance,
} from "../../lib/gps";

// ---------------------------------------------------------------------------
// haversineYards
// ---------------------------------------------------------------------------

describe("haversineYards", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineYards(40.0, -74.0, 40.0, -74.0)).toBe(0);
  });

  it("returns roughly 109 yards for ~100 metres north", () => {
    // 0.001° of latitude ≈ 111 metres ≈ 121 yards
    const yards = haversineYards(40.0, -74.0, 40.001, -74.0);
    expect(yards).toBeGreaterThan(100);
    expect(yards).toBeLessThan(140);
  });

  it("calculates a known 150-yard distance within ±5 yards", () => {
    // 150 yards ≈ 137.16 metres ≈ 0.001234° latitude
    const yards = haversineYards(40.0, -74.0, 40.001234, -74.0);
    expect(yards).toBeGreaterThanOrEqual(145);
    expect(yards).toBeLessThanOrEqual(155);
  });

  it("is symmetric (A→B equals B→A)", () => {
    const ab = haversineYards(40.0, -74.0, 40.005, -73.995);
    const ba = haversineYards(40.005, -73.995, 40.0, -74.0);
    expect(ab).toBe(ba);
  });

  it("returns an integer (rounds the result)", () => {
    const yards = haversineYards(40.0, -74.0, 40.002, -74.001);
    expect(Number.isInteger(yards)).toBe(true);
  });

  it("handles negative latitudes (southern hemisphere)", () => {
    const yards = haversineYards(-33.0, 151.0, -33.001, 151.0);
    expect(yards).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isGpsReliable
// ---------------------------------------------------------------------------

describe("isGpsReliable", () => {
  it("returns true for tight accuracy on a long shot", () => {
    expect(isGpsReliable(5, 200)).toBe(true); // 5m accuracy, 200-yard shot
  });

  it("returns false when accuracy exceeds 20 metres regardless of distance", () => {
    expect(isGpsReliable(25, 300)).toBe(false);
  });

  it("returns false when accuracy radius > 40% of measured distance", () => {
    // accuracyYards = 10m * 1.09361 ≈ 10.9 yards; 40% of 20 yards = 8 yards → unreliable
    expect(isGpsReliable(10, 20)).toBe(false);
  });

  it("returns true right at a comfortable accuracy for a mid-iron", () => {
    // 15m accuracy on 150-yard shot: 15 * 1.09361 ≈ 16.4 yards; 40% of 150 = 60 yards → reliable
    expect(isGpsReliable(15, 150)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assessShotDistance
// ---------------------------------------------------------------------------

describe("assessShotDistance", () => {
  it("returns no baseline when expected is 0", () => {
    const r = assessShotDistance(150, 0);
    expect(r.label).toBe("no baseline");
    expect(r.isOutlier).toBe(false);
  });

  it("marks a shot at exactly expected as on-target", () => {
    const r = assessShotDistance(150, 150);
    expect(r.label).toBe("right on expected");
    expect(r.isOutlier).toBe(false);
    expect(r.isShort).toBe(false);
    expect(r.isLong).toBe(false);
  });

  it("marks a shot within ±15% as on-target", () => {
    expect(assessShotDistance(140, 150).isOutlier).toBe(false); // 93%
    expect(assessShotDistance(160, 150).isOutlier).toBe(false); // 107%
  });

  it("flags a significantly short shot (< 65%) as an outlier", () => {
    const r = assessShotDistance(90, 150); // 60%
    expect(r.isOutlier).toBe(true);
    expect(r.isShort).toBe(true);
    expect(r.isLong).toBe(false);
    expect(r.label).toMatch(/shorter than expected/);
  });

  it("flags a significantly long shot (> 130%) as an outlier", () => {
    const r = assessShotDistance(210, 150); // 140%
    expect(r.isOutlier).toBe(true);
    expect(r.isLong).toBe(true);
    expect(r.isShort).toBe(false);
    expect(r.label).toMatch(/longer than expected/);
  });

  it("marks a moderately short shot (65–85%) as short but not outlier", () => {
    const r = assessShotDistance(120, 150); // 80%
    expect(r.isOutlier).toBe(false);
    expect(r.isShort).toBe(true);
  });

  it("marks a moderately long shot (115–130%) as long but not outlier", () => {
    const r = assessShotDistance(180, 150); // 120%
    expect(r.isOutlier).toBe(false);
    expect(r.isLong).toBe(true);
  });

  it("includes the percentage delta in the label for large outliers", () => {
    const r = assessShotDistance(60, 150); // 40% — 60% shorter
    expect(r.label).toMatch(/60%/);
  });
});

// ---------------------------------------------------------------------------
// calculateExpectedDistance
// ---------------------------------------------------------------------------

describe("calculateExpectedDistance", () => {
  const shot = (d: number, mishit = false) => ({ distance_yards: d, is_mishit: mishit });

  it("returns null for empty array", () => {
    expect(calculateExpectedDistance([])).toBeNull();
  });

  it("returns null when all shots are mishits", () => {
    expect(calculateExpectedDistance([shot(100, true), shot(80, true)])).toBeNull();
  });

  it("returns null when all distances are ≤ 10 yards (putts etc.)", () => {
    expect(calculateExpectedDistance([shot(5), shot(8), shot(10)])).toBeNull();
  });

  it("averages cleanly for 1–3 valid shots", () => {
    expect(calculateExpectedDistance([shot(150), shot(160)])).toBe(155);
    expect(calculateExpectedDistance([shot(150)])).toBe(150);
  });

  it("excludes mishit shots from the average", () => {
    const shots = [shot(150), shot(155), shot(40, true), shot(160)];
    const result = calculateExpectedDistance(shots);
    // Should average ~155 without the 40-yard mishit
    expect(result).toBeGreaterThan(148);
    expect(result).toBeLessThan(162);
  });

  it("trims outliers at the top and bottom with enough shots", () => {
    // 10 shots: outliers at 50 (low) and 300 (high), core around 150
    const shots = [
      shot(50), shot(140), shot(145), shot(148), shot(150),
      shot(152), shot(155), shot(158), shot(160), shot(300),
    ];
    const result = calculateExpectedDistance(shots);
    // Trimmed median should be around 150–158, not skewed by 50 or 300
    expect(result).toBeGreaterThan(140);
    expect(result).toBeLessThan(165);
  });

  it("returns an integer", () => {
    const shots = [shot(149), shot(151), shot(153)];
    expect(Number.isInteger(calculateExpectedDistance(shots)!)).toBe(true);
  });
});
