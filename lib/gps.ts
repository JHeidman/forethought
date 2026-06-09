// GPS utilities for on-course shot tracking

export type GpsPosition = {
  lat: number;
  lon: number;
  accuracyMeters: number;
};

/**
 * Calculate distance between two GPS coordinates using the Haversine formula.
 * Returns distance in yards.
 */
export function haversineYards(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = R * c;
  return Math.round(meters * 1.09361); // meters → yards
}

/**
 * Whether GPS accuracy is reliable enough to trust a distance measurement.
 * If accuracy radius > half the measured distance, the reading is suspect.
 */
export function isGpsReliable(accuracyMeters: number, distanceYards: number): boolean {
  const accuracyYards = accuracyMeters * 1.09361;
  return accuracyYards < distanceYards * 0.4 && accuracyMeters < 20;
}

/**
 * Assess a measured shot distance against expected distance.
 * Returns a descriptor and whether it's a notable outlier.
 */
export function assessShotDistance(
  measuredYards: number,
  expectedYards: number
): { label: string; isOutlier: boolean; isShort: boolean; isLong: boolean } {
  if (expectedYards <= 0) return { label: "no baseline", isOutlier: false, isShort: false, isLong: false };

  const ratio = measuredYards / expectedYards;

  if (ratio < 0.65) return { label: `${Math.round((1 - ratio) * 100)}% shorter than expected`, isOutlier: true, isShort: true, isLong: false };
  if (ratio < 0.85) return { label: "a bit shorter than usual", isOutlier: false, isShort: true, isLong: false };
  if (ratio <= 1.15) return { label: "right on expected", isOutlier: false, isShort: false, isLong: false };
  if (ratio <= 1.30) return { label: "a bit longer than usual", isOutlier: false, isShort: false, isLong: true };
  return { label: `${Math.round((ratio - 1) * 100)}% longer than expected`, isOutlier: true, isShort: false, isLong: true };
}

/**
 * Calculate a player's reliable expected distance for a club from shot history.
 * Uses a trimmed median: excludes confirmed mishits and statistical outliers.
 */
export function calculateExpectedDistance(
  shots: Array<{ distance_yards: number; is_mishit: boolean }>
): number | null {
  const valid = shots
    .filter(s => !s.is_mishit && s.distance_yards > 10)
    .map(s => s.distance_yards)
    .sort((a, b) => a - b);

  if (valid.length === 0) return null;
  if (valid.length <= 3) return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);

  // Trim top and bottom 15% to remove outliers
  const trimCount = Math.floor(valid.length * 0.15);
  const trimmed = valid.slice(trimCount, valid.length - trimCount);
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}
