/** "Signed Jersey", "Signed Jersey and Wine", "A, B, and C" — for "Collect … at the desk". */
export function listTitles(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  try {
    return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(titles);
  } catch {
    return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  }
}
