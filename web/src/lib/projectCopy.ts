import { t, translate, type Lang, type StringKey } from "../i18n";

/** Demo school copy. A name typed in the host desk has no key and is shown as entered. */
const TITLE: Record<string, StringKey> = {
  school: "project.seed.school.title",
  roof: "project.seed.roof.title",
  shell: "project.seed.shell.title",
  windows: "project.seed.windows.title",
  furniture: "project.seed.furniture.title",
  washrooms: "project.seed.washrooms.title",
  electrics: "project.seed.electrics.title",
};

const DESCRIPTION: Record<string, StringKey> = {
  school: "project.seed.school.description",
  roof: "project.seed.roof.description",
  shell: "project.seed.shell.description",
  windows: "project.seed.windows.description",
  furniture: "project.seed.furniture.description",
  washrooms: "project.seed.washrooms.description",
  electrics: "project.seed.electrics.description",
};

export function seedText(
  copyKey: string | null | undefined,
  field: "title" | "description",
  fallback: string,
  lang?: Lang,
): string {
  const key = copyKey ? (field === "title" ? TITLE : DESCRIPTION)[copyKey] : undefined;
  if (!key) return fallback;
  return lang ? translate(lang, key) : t(key);
}
