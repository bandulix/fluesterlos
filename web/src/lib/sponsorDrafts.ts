/** A sponsor typed into an earlier item of the same (unsaved) new-event form. */
export type DraftSponsor = { name: string; logo: File | null; fromItem: number };

type DraftLike = { title: string; sponsorName: string; sponsorLogo: File | null };

/**
 * Sponsors from items *before* `idx` that will actually be created (they have a title), deduped by
 * name (case-insensitive). The logo is the one chosen on the earliest item that has one — that
 * upload creates the sponsor's logo, and later items with the same name reuse it on the server
 * (items are posted in order).
 */
export function draftSponsorsBefore(items: DraftLike[], idx: number): DraftSponsor[] {
  const byName = new Map<string, DraftSponsor>();
  items.slice(0, Math.max(0, idx)).forEach((it, i) => {
    const name = it.sponsorName.trim();
    if (!name || !it.title.trim()) return;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) byName.set(key, { name, logo: it.sponsorLogo, fromItem: i });
    else if (!prev.logo && it.sponsorLogo) byName.set(key, { ...prev, logo: it.sponsorLogo, fromItem: i });
  });
  return [...byName.values()];
}

export function findDraftSponsor(drafts: DraftSponsor[], name: string): DraftSponsor | undefined {
  const key = name.trim().toLowerCase();
  return key ? drafts.find((d) => d.name.toLowerCase() === key) : undefined;
}
