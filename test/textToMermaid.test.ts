import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/core/messages";
import { textToMermaid, wrap } from "../src/core/textToMermaid";

const lines = (...l: string[]) => l.join("\n");

beforeEach(() => setLocale("en"));

describe("textToMermaid", () => {
  it("rejects empty text", () => {
    expect(() => textToMermaid("  \n \n")).toThrow("Enter some text.");
  });

  describe("steps", () => {
    it("links sentences in order, dropping joining words and periods", () => {
      expect(textToMermaid("まず申請書を作成します。次に、上長が承認します。最後に経理が支払います。")).toBe(
        lines(
          "graph TD",
          '    n1["申請書を作成します"] --> n2["上長が承認します"]',
          '    n2 --> n3["経理が支払います"]',
        ),
      );
    });

    it("uses one step per line and strips numbering", () => {
      expect(textToMermaid("1. Open the form\n2. Fill it in\n3. Submit")).toBe(
        lines("graph TD", '    n1["Open the form"] --> n2["Fill it in"]', '    n2 --> n3["Submit"]'),
      );
    });

    it("splits a single sentence at commas into plain-form steps", () => {
      expect(textToMermaid("申請書を作成し、上長が承認し、経理が支払う。")).toBe(
        lines(
          "graph TD",
          '    n1["申請書を作成する"] --> n2["上長が承認する"]',
          '    n2 --> n3["経理が支払う"]',
        ),
      );
    });

    it("keeps repeated steps as separate nodes", () => {
      expect(textToMermaid("確認\n修正\n確認")).toBe(
        lines("graph TD", '    n1["確認"] --> n2["修正"]', '    n2 --> n3["確認"]'),
      );
    });

    it("makes a lone node from one step", () => {
      expect(textToMermaid("ひとつだけ")).toBe(lines("graph TD", '    n1["ひとつだけ"]'));
    });

    it("wraps long labels and escapes quotes", () => {
      expect(textToMermaid('受け付けた "注文" の内容を在庫システムと照合する')).toBe(
        lines("graph TD", '    n1["受け付けた #quot;注文#quot;<br>の内容を在庫システムと照合する"]'),
      );
    });
  });

  describe("arrows", () => {
    it("chains nodes and shares nodes with the same label", () => {
      expect(textToMermaid("受付 → 審査 → 承認\n審査 -> 差し戻し")).toBe(
        lines(
          "graph TD",
          '    n1["受付"] --> n2["審査"] --> n3["承認"]',
          '    n2 --> n4["差し戻し"]',
        ),
      );
    });

    it("labels an edge after a colon", () => {
      expect(textToMermaid("審査 → 承認 : OK\n審査 → 差し戻し：NG\n単独")).toBe(
        lines(
          "graph TD",
          '    n1["審査"] -->|"OK"| n2["承認"]',
          '    n1 -->|"NG"| n3["差し戻し"]',
          '    n4["単独"]',
        ),
      );
    });
  });

  describe("indented list", () => {
    it("points each item to its children", () => {
      const text = lines("- 会社", "  - 営業部", "    - 第一課", "  - 開発部", "- 関連会社");
      expect(textToMermaid(text)).toBe(
        lines(
          "graph TD",
          '    n1["会社"]',
          '    n1 --> n2["営業部"]',
          '    n2 --> n3["第一課"]',
          '    n1 --> n4["開発部"]',
          '    n5["関連会社"]',
        ),
      );
    });

    it("treats tabs and full-width spaces as indentation", () => {
      expect(textToMermaid("親\n\t子\n　　子2")).toBe(
        lines("graph TD", '    n1["親"]', '    n1 --> n2["子"]', '    n1 --> n3["子2"]'),
      );
    });
  });

  describe("sequence", () => {
    it("detects Japanese messages and dashes replies", () => {
      expect(textToMermaid("顧客が店員に注文する\n店員から厨房へ注文を伝える\n店員が顧客に料理を返す")).toBe(
        lines(
          "sequenceDiagram",
          "    participant P1 as 顧客",
          "    participant P2 as 店員",
          "    participant P3 as 厨房",
          "    P1->>P2: 注文する",
          "    P2->>P3: 注文を伝える",
          "    P2-->>P1: 料理を返す",
        ),
      );
    });

    it("detects arrow messages and escapes ; and #", () => {
      expect(textToMermaid("Browser -> Server: GET /a; b\nServer -> Browser: 200 #1")).toBe(
        lines(
          "sequenceDiagram",
          "    participant P1 as Browser",
          "    participant P2 as Server",
          "    P1->>P2: GET /a#59; b",
          "    P2->>P1: 200 #35;1",
        ),
      );
    });

    it("needs two or more lines and every line a message in auto", () => {
      expect(textToMermaid("顧客が店員に注文する")).toMatch(/^graph TD/);
      expect(textToMermaid("顧客が店員に注文する\n料理を作る")).toMatch(/^graph TD/);
    });

    it("does not take a step with an object or a condition for a message", () => {
      expect(textToMermaid("申請者が申請書を経理に出す\n注文が確定したら倉庫に連絡する")).toMatch(/^graph TD/);
    });

    it("reports the first line that is not a message when sequence is chosen", () => {
      expect(() => textToMermaid("A -> B: hi\n\nhello", "sequence")).toThrow(
        'Line 3: write a message as "A -> B: message".',
      );
    });

    it("can be turned off by choosing flowchart", () => {
      expect(textToMermaid("A -> B: hi\nB -> A: ok", "flowchart")).toBe(
        lines("graph TD", '    n1["A"] -->|"hi"| n2["B"]', '    n2 -->|"ok"| n1'),
      );
    });
  });
});

describe("wrap", () => {
  it("leaves short text alone", () => {
    expect(wrap("short")).toEqual(["short"]);
  });

  it("counts half-width characters as half", () => {
    expect(wrap("a".repeat(32))).toEqual(["a".repeat(32)]);
    expect(wrap("a".repeat(33))).toEqual(["a".repeat(32), "a"]);
  });

  it("breaks after a space when there is one", () => {
    expect(wrap("aaaa bbbb cccc", 4)).toEqual(["aaaa", "bbbb", "cccc"]);
  });
});
