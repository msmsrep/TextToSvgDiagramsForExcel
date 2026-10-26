import { afterEach, describe, expect, it } from "vitest";
import { getLocale, MESSAGES, setLocale, t, toLocale } from "../src/core/messages";

afterEach(() => setLocale("en"));

describe("messages", () => {
  it("has the same IDs and placeholders in English and Japanese", () => {
    expect(Object.keys(MESSAGES.ja).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const [id, text] of Object.entries(MESSAGES.en)) {
      expect(placeholders(MESSAGES.ja[id as keyof typeof MESSAGES.en]), id).toEqual(placeholders(text));
    }
  });

  it("uses English until another locale is set", () => {
    expect(getLocale()).toBe("en");
    expect(t("pleaseRenderFirst")).toBe("Please render first");
    setLocale("ja");
    expect(t("pleaseRenderFirst")).toBe("先に図を描画してください");
  });

  it("fills in placeholders and leaves unknown ones", () => {
    expect(t("tableTaskEmpty", { row: 7 })).toBe("Row 7: the task name is empty.");
    expect(t("tableTaskEmpty")).toBe("Row {row}: the task name is empty.");
  });

  it.each([
    ["ja-JP", "ja"],
    ["ja", "ja"],
    ["en-US", "en"],
    ["fr-FR", "en"],
    [undefined, "en"],
  ])("maps %s to %s", (language, locale) => {
    expect(toLocale(language)).toBe(locale);
  });
});
