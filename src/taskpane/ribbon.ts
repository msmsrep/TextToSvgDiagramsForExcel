import type { TableKind } from "../core/tableToMermaid";
import { TEMPLATES } from "../core/templates";

/** Formats offered by the ribbon's Insert as menu, as the format select's values. */
export const INSERT_FORMATS = ["png", "jpeg", "svg", "svg-office", "shapes"] as const;
export type InsertFormat = (typeof INSERT_FORMATS)[number];
/** Formats offered by the ribbon's Download menu; Shapes cannot be downloaded. */
export const DOWNLOAD_FORMATS = ["png", "jpeg", "svg", "svg-office"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];
const TABLE_KINDS: readonly TableKind[] = ["auto", "flowchart", "gantt", "pie"];

export type RibbonActions = {
  useTemplate(id: string): Promise<void>;
  generateFromCells(kind: TableKind): Promise<void>;
  insert(format: InsertFormat): Promise<void>;
  download(format: DownloadFormat): Promise<void>;
};

/** "svg-office" → "SvgOffice", for the manifest's FunctionName. */
const pascal = (value: string) =>
  value.replace(/(^|-)(\w)/g, (_, _dash, c: string) => c.toUpperCase());

/** The manifest's FunctionName for each ribbon menu item, mapped to its action. */
export function ribbonCommands(actions: RibbonActions): Record<string, () => Promise<void>> {
  const commands: Record<string, () => Promise<void>> = {};
  for (const { id } of TEMPLATES) {
    commands[`template${pascal(id)}`] = () => actions.useTemplate(id);
  }
  for (const kind of TABLE_KINDS) {
    commands[`cells${pascal(kind)}`] = () => actions.generateFromCells(kind);
  }
  for (const format of INSERT_FORMATS) {
    commands[`insert${pascal(format)}`] = () => actions.insert(format);
  }
  for (const format of DOWNLOAD_FORMATS) {
    commands[`download${pascal(format)}`] = () => actions.download(format);
  }
  return commands;
}

/**
 * Registers the ribbon's commands. They run in this page (the shared
 * runtime), so each one first shows the task pane, where its result or
 * error appears.
 */
export function registerRibbonCommands(actions: RibbonActions) {
  // Without a shared runtime (or outside Office) there are no commands to bind.
  if (typeof Office.actions?.associate !== "function") {
    return;
  }
  for (const [name, run] of Object.entries(ribbonCommands(actions))) {
    Office.actions.associate(name, async (event: Office.AddinCommands.Event) => {
      try {
        await Office.addin.showAsTaskpane();
      } catch {
        // The command still runs; its result shows when the pane is opened.
      }
      try {
        await run();
      } finally {
        event.completed();
      }
    });
  }
}
