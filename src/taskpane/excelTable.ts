import { t } from "../core/messages";
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
      throw new Error(t("selectCellRange"));
    }
    if (range.isNullObject) {
      throw new Error(t("tableEmpty"));
    }
    if (range.rowCount > MAX_TABLE_ROWS) {
      throw new Error(t("selectionTooManyRows", { max: MAX_TABLE_ROWS }));
    }

    range.load(["values", "text", "numberFormat"]);
    // Office.js has no released property for the date system, but DATE(1904,1,1)
    // is serial 0 only in the 1904 system (1462 in the 1900 system).
    const epoch = ctx.workbook.functions.date(1904, 1, 1);
    epoch.load("value");
    await ctx.sync();
    return {
      values: range.values,
      text: range.text,
      numberFormat: range.numberFormat,
      firstRow: range.rowIndex + 1,
      date1904: epoch.value === 0,
    };
  });
}
