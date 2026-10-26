import { t } from "./messages";

/** A selected cell range as read from Excel (see excelTable.ts). */
export type TableData = {
  /** Cell values: strings, numbers and booleans; "" for empty cells. */
  values: unknown[][];
  /** Cell values as displayed. */
  text: string[][];
  numberFormat: string[][];
  /** Worksheet row number (1-based) of the first row, for error messages. */
  firstRow: number;
  /** True when the workbook uses the 1904 date system (the add-in cannot tell, so omits it). */
  date1904?: boolean;
};

export type TableKind = "auto" | "flowchart" | "gantt" | "pie";

type Cell =
  | { kind: "empty"; text: "" }
  | { kind: "text"; text: string }
  | { kind: "number"; text: string; value: number }
  | { kind: "date"; text: string };

type Row = { number: number; cells: Cell[] };

const EMPTY: Cell = { kind: "empty", text: "" };
const MS_PER_DAY = 86_400_000;

/**
 * Builds Mermaid code from a table:
 * - flowchart: parent | child | (edge label)
 * - gantt: task | start date | end date or duration in days | (section)
 * - pie: label | value
 * "auto" picks gantt or pie when the second column holds dates or numbers.
 */
export function tableToMermaid(table: TableData, kind: TableKind): string {
  if ((table.values[0]?.length ?? 0) < 2) {
    throw new Error(t("tableTwoColumns"));
  }
  const rows = parseRows(table);
  if (rows.length === 0) {
    throw new Error(t("tableEmpty"));
  }

  switch (kind === "auto" ? detectKind(rows) : kind) {
    case "flowchart":
      return flowchart(rows);
    case "gantt":
      return gantt(rows);
    case "pie":
      return pie(rows);
  }
}

function parseRows(table: TableData): Row[] {
  const rows: Row[] = [];
  table.values.forEach((values, i) => {
    const cells = values.map((v, j) =>
      toCell(v, table.text[i]?.[j] ?? "", table.numberFormat[i]?.[j] ?? "", table.date1904 === true),
    );
    if (cells.some((c) => c.kind !== "empty")) {
      rows.push({ number: table.firstRow + i, cells });
    }
  });
  return rows;
}

function toCell(value: unknown, text: string, format: string, date1904: boolean): Cell {
  if (typeof value === "number") {
    if (isDateFormat(format)) {
      return { kind: "date", text: serialToIso(value, date1904) };
    }
    // Text is "####" when the column is too narrow to show the number.
    return { kind: "number", text: /^#+$/.test(text) || !text ? String(value) : text.trim(), value };
  }
  if (typeof value === "boolean") {
    return { kind: "text", text: text.trim() || String(value).toUpperCase() };
  }
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) {
    return EMPTY;
  }
  const iso = parseDateString(str);
  return iso ? { kind: "date", text: iso } : { kind: "text", text: str };
}

/** True for number formats that show a date, such as "yyyy/m/d" or "m月d日". */
function isDateFormat(format: string): boolean {
  // Ignore quoted text, escaped characters and [Red] / [$-ja-JP] sections.
  return /[ymd]/i.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));
}

/** Converts a serial date in Excel's 1900 (or 1904) date system to YYYY-MM-DD. */
function serialToIso(serial: number, date1904: boolean): string {
  const days = Math.floor(serial);
  if (date1904) {
    // Serial 0 is 1904-01-01.
    return new Date(Date.UTC(1904, 0, 1) + days * MS_PER_DAY).toISOString().slice(0, 10);
  }
  // Serial 1 is 1900-01-01, and serial 60 is the nonexistent 1900-02-29 that
  // Excel keeps for Lotus 1-2-3 compatibility.
  const epoch = Date.UTC(1899, 11, days < 60 ? 31 : 30);
  return new Date(epoch + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Parses text dates like "2026-10-01" or "2026/10/1" to YYYY-MM-DD. */
function parseDateString(str: string): string | undefined {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(str);
  if (!match) {
    return undefined;
  }
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

/** Gantt when the second column holds dates, pie for numbers, else flowchart. */
function detectKind(rows: Row[]): Exclude<TableKind, "auto"> {
  // Skip the first row, which may be a header.
  const sample = (rows.length > 1 ? rows.slice(1) : rows)
    .map((row) => cell(row, 1).kind)
    .filter((k) => k !== "empty");
  if (sample.length > 0 && sample.every((k) => k === "date")) {
    return "gantt";
  }
  if (sample.length > 0 && sample.every((k) => k === "number")) {
    return "pie";
  }
  return "flowchart";
}

function cell(row: Row, column: number): Cell {
  return row.cells[column] ?? EMPTY;
}

/** Drops the first row when its second column is not of the expected kind (a header). */
function dataRows(rows: Row[], expected: Cell["kind"]): Row[] {
  const data = cell(rows[0], 1).kind === expected ? rows : rows.slice(1);
  if (data.length === 0) {
    throw new Error(t("tableNoDataRows"));
  }
  return data;
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ");
}

function flowchart(rows: Row[]): string {
  const ids = new Map<string, string>();
  /** The node's ID, with its label the first time the node appears. */
  const node = (label: string) => {
    const id = ids.get(label);
    if (id) {
      return id;
    }
    const newId = `n${ids.size + 1}`;
    ids.set(label, newId);
    return `${newId}["${flowchartText(label)}"]`;
  };

  const lines = ["graph TD"];
  for (const row of rows) {
    const [from, to, label] = [0, 1, 2].map((i) => cell(row, i).text);
    if (from && to) {
      const arrow = label ? `-->|"${flowchartText(label)}"|` : "-->";
      lines.push(`    ${node(from)} ${arrow} ${node(to)}`);
    } else if (from || to) {
      lines.push(`    ${node(from || to)}`);
    }
  }
  return lines.join("\n");
}

function flowchartText(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/\r?\n/g, "<br>");
}

function gantt(rows: Row[]): string {
  const lines = ["gantt", "    dateFormat YYYY-MM-DD", "    inclusiveEndDates"];
  let section = "";
  for (const row of dataRows(rows, "date")) {
    const [task, start, end, sec] = [0, 1, 2, 3].map((i) => cell(row, i));
    if (!task.text) {
      throw new Error(t("tableTaskEmpty", { row: row.number }));
    }
    if (start.kind !== "date") {
      throw new Error(t("tableStartNotDate", { row: row.number }));
    }
    let finish: string;
    if (end.kind === "date") {
      finish = end.text;
    } else if (end.kind === "number" && end.value > 0) {
      finish = `${end.value}d`;
    } else {
      throw new Error(t("tableEndInvalid", { row: row.number }));
    }
    if (sec.text && sec.text !== section) {
      section = sec.text;
      lines.push(`    section ${oneLine(section)}`);
    }
    // A colon would end the task name, so use the full-width one.
    lines.push(`    ${oneLine(task.text).replace(/:/g, "：")} : ${start.text}, ${finish}`);
  }
  return lines.join("\n");
}

function pie(rows: Row[]): string {
  const lines = ["pie"];
  for (const row of dataRows(rows, "number")) {
    const [label, value] = [0, 1].map((i) => cell(row, i));
    if (value.kind !== "number") {
      throw new Error(t("tableValueNotNumber", { row: row.number }));
    }
    // Pie labels cannot contain double quotes.
    lines.push(`    "${oneLine(label.text).replace(/"/g, "'")}" : ${value.value}`);
  }
  return lines.join("\n");
}
