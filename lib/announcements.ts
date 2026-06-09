/**
 * Announcements — prompt-building helpers.
 *
 * Kept in lib/ so they can be unit-tested independently of the Next.js
 * API route that uses them.
 */

export type AnnouncementItem = {
  id: string;
  version: string;
  title: string;
  summary: string;
  detail: string;
};

/**
 * Build the system-prompt block that instructs Frankie to mention new
 * features to a returning user.  Returns an empty string when there are
 * no unread announcements (caller should filter it out of the prompt).
 */
export function buildAnnouncementsBlock(
  announcements: AnnouncementItem[],
  firstName: string
): string {
  if (announcements.length === 0) return "";

  const items = announcements.map(a => `- ${a.title}: ${a.summary}`).join("\n");

  return `NEW FEATURES TO MENTION:
There are ${announcements.length} new thing${announcements.length > 1 ? "s" : ""} in the app since ${firstName} last visited. Work them into your opening naturally — don't lead with a news bulletin. After your warm greeting, mention it conversationally:

"Oh — a few things have changed since you were last here. [1–2 sentence natural summary]. Want me to walk you through any of them?"

Keep it light and brief — you're mentioning it, not presenting a changelog. If they say yes, you can give more detail from the details below.

What's new:
${items}

Full details (for when they ask):
${announcements.map(a => `${a.title} (${a.version}): ${a.detail}`).join("\n\n")}

After you deliver this, don't bring it up again — it's a one-time welcome-back note.`;
}
