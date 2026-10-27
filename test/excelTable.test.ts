import { beforeEach, describe, expect, it } from "vitest";
import { MAX_TABLE_ROWS, readSelection } from "../src/taskpane/excelTable";
import { createFakeOffice, type FakeOffice } from "./fakes/office";

let fake: FakeOffice;

beforeEach(() => {
  fake = createFakeOffice();
  fake.install();
});

describe("readSelection", () => {
  it("returns the values, text and formats with the 1-based first row", async () => {
    fake.setSelection({
      values: [["A", 1]],
      text: [["A", "1.0"]],
      numberFormat: [["General", "0.0"]],
      rowIndex: 4,
    });

    expect(await readSelection()).toEqual({
      values: [["A", 1]],
      text: [["A", "1.0"]],
      numberFormat: [["General", "0.0"]],
      firstRow: 5,
      date1904: false,
    });
  });

  it("tells when the workbook uses the 1904 date system", async () => {
    fake.setSelection({ values: [["A", 0]], text: [["A", "1904/1/1"]], numberFormat: [["General", "yyyy/m/d"]], rowIndex: 0 });
    fake.setDate1904(true);
    expect((await readSelection()).date1904).toBe(true);
  });

  it("reports an empty selection", async () => {
    fake.setSelection(null);
    await expect(readSelection()).rejects.toThrow("The selection is empty.");
  });

  it("asks for a cell range when a shape is selected", async () => {
    fake.setSelection("shape");
    await expect(readSelection()).rejects.toThrow("Select a cell range on the sheet.");
  });

  it("rejects selections with too many rows before loading their values", async () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ["A", "B"]);
    fake.setSelection({ values: rows, text: rows, numberFormat: rows, rowIndex: 0 });

    await expect(readSelection()).rejects.toThrow(`The selection has more than ${MAX_TABLE_ROWS} rows.`);
    expect(fake.syncCount).toBe(1);
  });

  it("accepts exactly the maximum number of rows", async () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS }, () => ["A", "B"]);
    fake.setSelection({ values: rows, text: rows, numberFormat: rows, rowIndex: 0 });
    expect((await readSelection()).values).toHaveLength(MAX_TABLE_ROWS);
  });
});
