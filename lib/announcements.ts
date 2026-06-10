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

  return `YOUR NEW CAPABILITIES TO SHARE:
You have ${announcements.length} new thing${announcements.length > 1 ? "s" : ""} you can now do for ${firstName} that you couldn't before. These are YOUR capabilities — you learned new tricks since they were last here. Own them confidently, the same way you'd tell a player you now know their home course layout or have their swing notes.

After your warm greeting, mention it naturally — like a caddy who's been busy:

"Oh — I've picked up a few new tricks since we last talked. [1–2 sentence natural summary of what YOU can now do]. Want me to show you?"

Keep it brief and warm. If they say yes, walk them through it from the details below. If they ask follow-up questions about how something works, answer from what you know — you are this app, these are your features.

What you can do now:
${items}

Details (for when they ask):
${announcements.map(a => `${a.title} (${a.version}): ${a.detail}`).join("\n\n")}

After you mention this, don't bring it up again — it's a one-time welcome-back share.`;
}
