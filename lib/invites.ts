import { randomInt } from "crypto";

export type InviteCode = {
  code: string;
  expiresAt?: string | null;
  source?: string | null;
  email?: string | null;
};

export const HANDICAP_RANGES = ["under-10", "10-18", "19-28", "29-plus", "no-idea"] as const;
export const WANTS = ["practice", "on-course", "both"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// No 0/O or 1/I/L — codes get read aloud and typed on phones
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

export function normalizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return cleaned || null;
}

export function generateInviteCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function findValidCode(
  codes: InviteCode[],
  code: string,
  now: Date = new Date()
): { valid: true; match: InviteCode } | { valid: false; reason: "invalid" | "expired" } {
  const match = codes.find(c => c.code.toUpperCase() === code.trim().toUpperCase());
  if (!match) return { valid: false, reason: "invalid" };
  if (match.expiresAt && new Date(match.expiresAt) < now) return { valid: false, reason: "expired" };
  return { valid: true, match };
}
