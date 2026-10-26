import { describe, expect, it } from "vitest";
import { type TableData, type TableKind, tableToMermaid } from "../src/core/tableToMermaid";

/** A date cell: a serial number shown with a date format. */
type DateCell = { serial: number; format?: string };
/** A number cell whose displayed text differs from its value. */
type ShownCell = { value: number; text: string };
type CellInput = string | number | boolean | DateCell | ShownCell;

function table(rows: CellInput[][], firstRow = 1): TableData {
  const map = <T>(f: (c: CellInput) => T) => rows.map((r) => r.map(f));
  return {
    values: map((c) => (typeof c !== "object" ? c : "serial" in c ? c.serial : c.value)),
    text: map((c) => (typeof c !== "object" ? String(c) : "serial" in c ? "date" : c.text)),
    numberFormat: map((c) =>
      typeof c === "object" && "serial" in c ? (c.format ?? "yyyy/m/d") : "General"),
    firstRow,
  };
}

const gen = (rows: CellInput[][], kind: TableKind = "auto", firstRow?: number) =>
  tableToMermaid(table(rows, firstRow), kind);

// 2026-10-01 and 2026-10-05 in Excel's 1900 date system.
const OCT1 = { serial: 46296 };
const OCT5 = { serial: 46300 };

describe("tableToMermaid", () => {
  it("rejects a single column", () => {
    expect(() => gen([["A"], ["B"]])).toThrow("Select at least two columns.");
  });

  it("rejects a selection with only empty cells", () => {
    expect(() => gen([["", ""], ["", ""]])).toThrow("The selection is empty.");
  });

  describe("flowchart", () => {
    it("links parents to children, declaring each node once", () => {
      expect(gen([["A", "B"], ["A", "C"], ["B", "C"]])).toBe(
        [
          "graph TD",
          '    n1["A"] --> n2["B"]',
          '    n1 --> n3["C"]',
          "    n2 --> n3",
        ].join("\n"),
      );
    });

    it("uses the third column as the edge label", () => {
      expect(gen([["A", "B", "yes"], ["A", "C", ""]])).toBe(
        ['graph TD', '    n1["A"] -->|"yes"| n2["B"]', '    n1 --> n3["C"]'].join("\n"),
      );
    });

    it("adds a lone node when one side is empty and skips empty rows", () => {
      expect(gen([["A", ""], ["", "", ""], ["", "B"]])).toBe(
        ['graph TD', '    n1["A"]', '    n2["B"]'].join("\n"),
      );
    });

    it("escapes quotes and keeps line breaks", () => {
      expect(gen([['say "hi"', "line1\nline2"]])).toBe(
        ['graph TD', '    n1["say #quot;hi#quot;"] --> n2["line1<br>line2"]'].join("\n"),
      );
    });

    it("labels nodes with the displayed text of numbers and the ISO form of dates", () => {
      expect(gen([[{ value: 0.5, text: "50%" }, OCT1]], "flowchart")).toBe(
        ['graph TD', '    n1["50%"] --> n2["2026-10-01"]'].join("\n"),
      );
    });

    it("is chosen for text tables, keeping a header row as data", () => {
      expect(gen([["Parent", "Child"], ["A", "B"]])).toMatch(/^graph TD\n {4}n1\["Parent"\] --> n2\["Child"\]/);
    });
  });

  describe("gantt", () => {
    it("is chosen when the second column holds dates, skipping the header", () => {
      expect(gen([["Task", "Start", "End"], ["Design", OCT1, OCT5], ["Build", OCT5, 3]])).toBe(
        [
          "gantt",
          "    dateFormat YYYY-MM-DD",
          "    inclusiveEndDates",
          "    Design : 2026-10-01, 2026-10-05",
          "    Build : 2026-10-05, 3d",
        ].join("\n"),
      );
    });

    it("adds a section line whenever the fourth column changes", () => {
      const code = gen([
        ["A", OCT1, 1, "Phase 1"],
        ["B", OCT1, 1, "Phase 1"],
        ["C", OCT1, 1, "Phase 2"],
        ["D", OCT1, 1, ""],
      ]);
      expect(code.split("\n").slice(3)).toEqual([
        "    section Phase 1",
        "    A : 2026-10-01, 1d",
        "    B : 2026-10-01, 1d",
        "    section Phase 2",
        "    C : 2026-10-01, 1d",
        "    D : 2026-10-01, 1d",
      ]);
    });

    it("accepts dates typed as text", () => {
      expect(gen([["A", "2026/10/1", "2026-10-05"]])).toMatch(/A : 2026-10-01, 2026-10-05$/);
    });

    it("recognizes Japanese and locale-tagged date formats", () => {
      const code = gen([["A", { serial: 46296, format: 'm"月"d"日"' }, { serial: 46300, format: "[$-ja-JP]ggge年m月d日" }]]);
      expect(code).toMatch(/A : 2026-10-01, 2026-10-05$/);
    });

    it("handles dates before 1900-03-01, where Excel counts a nonexistent 1900-02-29", () => {
      expect(gen([["A", { serial: 1 }, { serial: 59 }], ["B", { serial: 61 }, 1]])).toMatch(
        /A : 1900-01-01, 1900-02-28\n {4}B : 1900-03-01, 1d$/,
      );
    });

    it("ignores the time of day", () => {
      expect(gen([["A", { serial: 46296.75 }, 1]])).toMatch(/A : 2026-10-01, 1d$/);
    });

    it("replaces colons in task names and joins lines", () => {
      expect(gen([["a:b\nc", OCT1, 1]])).toMatch(/ {4}a：b c : 2026-10-01, 1d$/);
    });

    it("reports rows with a missing task name, start or end using the sheet row number", () => {
      expect(() => gen([["A", OCT1, 1], ["", OCT1, 1]], "gantt", 5)).toThrow("Row 6: the task name is empty.");
      expect(() => gen([["A", OCT1, 1], ["B", "soon", 1]], "gantt", 5)).toThrow("Row 6: the start must be a date.");
      expect(() => gen([["A", OCT1, ""]], "gantt")).toThrow("Row 1: the end must be a date or a number of days.");
      expect(() => gen([["A", OCT1, 0]], "gantt")).toThrow("Row 1: the end must be a date or a number of days.");
    });

    it("reports a header without data rows", () => {
      expect(() => gen([["Task", "Start", "End"]], "gantt")).toThrow("The selection has no data rows.");
    });
  });

  describe("pie", () => {
    it("is chosen when the second column holds numbers, skipping the header", () => {
      expect(gen([["Item", "Value"], ["Dogs", 30], ["Cats", 12.5]])).toBe(
        ['pie', '    "Dogs" : 30', '    "Cats" : 12.5'].join("\n"),
      );
    });

    it("uses the raw value rather than the displayed text", () => {
      expect(gen([["A", { value: 0.25, text: "25%" }]])).toBe('pie\n    "A" : 0.25');
    });

    it("uses the raw value when the column is too narrow to show it", () => {
      expect(gen([[{ value: 12345, text: "####" }, 1]], "pie")).toBe('pie\n    "12345" : 1');
    });

    it("replaces double quotes in labels", () => {
      expect(gen([['"A"', 1]])).toBe("pie\n    \"'A'\" : 1");
    });

    it("reports non-numeric values when forced", () => {
      expect(() => gen([["A", 1], ["B", "x"]], "pie", 2)).toThrow("Row 3: the value must be a number.");
    });
  });
});
