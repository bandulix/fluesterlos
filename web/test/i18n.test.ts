import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { en, type StringKey } from "../src/i18n/en";
import { th } from "../src/i18n/th";
import { de } from "../src/i18n/de";
import { detectLanguage, language, setLanguage, t } from "../src/i18n";

const keys = Object.keys(en) as StringKey[];

describe("guest languages", () => {
  afterEach(() => setLanguage("en"));

  it("has every English key in Thai and German, and no extras", () => {
    expect(Object.keys(th).sort()).toEqual([...keys].sort());
    expect(Object.keys(de).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(th[key].trim(), key).not.toBe("");
      expect(de[key].trim(), key).not.toBe("");
      const placeholders = en[key].match(/\{(\w+)\}/g) ?? [];
      for (const token of placeholders) {
        expect(th[key], key).toContain(token);
        expect(de[key], key).toContain(token);
      }
    }
  });

  it("detects Thai and German from the browser language and keeps English otherwise", () => {
    expect(detectLanguage("th-TH")).toBe("th");
    expect(detectLanguage("th")).toBe("th");
    expect(detectLanguage("de-AT")).toBe("de");
    expect(detectLanguage("de")).toBe("de");
    expect(detectLanguage("en-GB")).toBe("en");
    expect(detectLanguage("fr-FR")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage(null)).toBe("en");
  });

  it("keeps German formal, and the donor tab is one short word", () => {
    expect(de["cat.donors"]).toBe("Rangliste");
    expect(de["cat.donors"]).not.toMatch(/[\s-]/);
    expect(de["cat.donors"].length).toBeLessThanOrEqual(9);
    expect(de["donate.topTitle"]).toBe("Großspender");
    expect(de["paddle.who"]).toContain("Bieternummer");
    expect(de["bid.topBid"]).toBe("Höchstgebot");
    expect(de["max.title"]).toBe("Maximalgebot");
    expect(de["bid.winningBid"]).toBe("Zuschlag");
    expect(de["bid.yours"]).toBe("Ihr Los ✓");
    for (const [key, value] of Object.entries(de)) {
      expect(value, key).not.toMatch(/\b(du|dein|deine|deinen|deinem|deiner|dir|dich|euch|euer|eure)\b/);
    }
  });

  it("does not print the event code twice on the host card", () => {
    const card = readFileSync(new URL("../src/pages/HostEventCard.tsx", import.meta.url), "utf8");
    const room = readFileSync(new URL("../src/pages/HostControlRoom.tsx", import.meta.url), "utf8");
    const paddle = readFileSync(new URL("../src/pages/PaddleHost.tsx", import.meta.url), "utf8");
    expect(card).not.toMatch(/Code:\s*<code>/);
    expect(room).toContain("Event code");
    expect(room).not.toMatch(/\bt\(/);
    expect(paddle).not.toMatch(/\bt\(/);
    expect(paddle).toContain('translate("en"');
  });

  it("switches the active table", () => {
    setLanguage("de");
    expect(language()).toBe("de");
    expect(t("join.start")).toBe(de["join.start"]);
    setLanguage("th");
    expect(t("join.start")).toBe(th["join.start"]);
    setLanguage("nope");
    expect(language()).toBe("en");
    expect(t("join.start")).toBe(en["join.start"]);
  });
});
