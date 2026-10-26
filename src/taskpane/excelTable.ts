import type { TableData } from "../core/tableToMermaid";

// Keeps whole-sheet selections and huge tables from producing unreadable diagrams.
export const MAX_TABLE_ROWS = 500;

/** Reads the cells with values in the selected range. */
export function readSelection(): Promise<TableData> {
  return Excel.run(async (ctx) => {
    // Trims whole-column selections like A:C to the cells that have values.
    const range = ctx.workbook.getSelectedRange().getUsedRangeOrNullObject(true);
    range.load(["isNullObject", "rowCount", "rowIndex"]);
    try {
      await ctx.sync();
    } catch {
      // getSelectedRange fails while a shape or chart is selected.
      throw new Error("Select a cell range on the sheet.");
    }
    if (range.isNullObject) {
      throw new Error("The selection is empty.");
    }
    if (range.rowCount > MAX_TABLE_ROWS) {
      throw new Error(`The selection has more than ${MAX_TABLE_ROWS} rows.`);
    }

    range.load(["values", "text", "numberFormat"]);
    await ctx.sync();
    return {
      values: range.values,
      text: range.text,
      numberFormat: range.numberFormat,
      firstRow: range.rowIndex + 1,
    };
  });
}
