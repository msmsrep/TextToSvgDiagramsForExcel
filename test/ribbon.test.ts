import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DOWNLOAD_FORMATS, INSERT_FORMATS, ribbonCommands } from "../src/taskpane/ribbon";
import { TEMPLATES } from "../src/core/templates";
import { MESSAGES } from "../src/core/messages";

const MANIFEST = readFileSync(join(__dirname, "../manifest.xml"), "utf8");

function noopActions() {
  return {
    useTemplate: vi.fn().mockResolvedValue(undefined),
    generateFromCells: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
  };
}

/** The labels of a ribbon menu's items, in order. */
function menuLabels(menuId: string): string[] {
  const start = MANIFEST.indexOf(`<Control xsi:type="Menu" id="${menuId}">`);
  const menu = MANIFEST.slice(start, MANIFEST.indexOf("</Control>", start));
  const strings = new Map(
    Array.from(MANIFEST.matchAll(/<bt:String id="([^"]+)" DefaultValue="([^"]*)"/g), ([, id, value]) => [id, value]),
  );
  return Array.from(menu.matchAll(/<Item id="[^"]+">\s*<Label resid="([^"]+)"/g), ([, resid]) => strings.get(resid)!);
}

describe("ribbon commands", () => {
  it("match the manifest's function names one to one", () => {
    const inManifest = Array.from(MANIFEST.matchAll(/<FunctionName>([^<]+)<\/FunctionName>/g), (x) => x[1]);
    expect([...inManifest].sort()).toEqual(Object.keys(ribbonCommands(noopActions())).sort());
  });

  it("list every template in the Template menu, in order", () => {
    expect(menuLabels("TemplateMenu")).toEqual(TEMPLATES.map((t) => t.label));
  });

  it("offer the same formats as the task pane's format select", () => {
    const html = readFileSync(join(__dirname, "../src/taskpane/taskpane.html"), "utf8");
    const select = html.match(/<select id="format-select"[\s\S]*?<\/select>/)![0];
    const options = Array.from(select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g), ([, v, label]) => [v, label]);

    expect(options.map(([v]) => v)).toEqual([...INSERT_FORMATS]);
    expect(menuLabels("InsertMenu")).toEqual(options.map(([, label]) => label));
    expect(menuLabels("DownloadMenu")).toEqual(
      options.filter(([v]) => (DOWNLOAD_FORMATS as readonly string[]).includes(v)).map(([, label]) => label),
    );
  });

  it("have Japanese text, except for diagram type and file format names", () => {
    const ids = Array.from(MANIFEST.matchAll(/<bt:String id="([^"]+)"/g), ([, id]) => id);
    const translated = new Set(
      Array.from(MANIFEST.matchAll(/<bt:String id="([^"]+)" DefaultValue="[^"]*">\s*<bt:Override Locale="ja-JP"/g), ([, id]) => id),
    );
    const english = /^(Template\.\w+|Cells\.(flowchart|gantt|pie)|(Insert|Download)\.(png|jpeg|svg))\.Label$/;
    expect(ids.filter((id) => !translated.has(id) && !english.test(id))).toEqual([]);
    expect(ids.filter((id) => translated.has(id) && english.test(id))).toEqual([]);
  });

  it("are labeled in Japanese as in the task pane", () => {
    const ja = new Map(
      Array.from(
        MANIFEST.matchAll(/<bt:String id="([^"]+)" DefaultValue="[^"]*">\s*<bt:Override Locale="ja-JP" Value="([^"]*)"/g),
        ([, id, value]) => [id, value],
      ),
    );
    expect(ja.get("Insert.svgOffice.Label")).toBe(MESSAGES.ja.formatSvgOffice);
    expect(ja.get("Insert.shapes.Label")).toBe(MESSAGES.ja.formatShapes);
    expect(ja.get("Download.svgOffice.Label")).toBe(MESSAGES.ja.formatSvgOffice);
    // The preview hint points at the Template menu on the Diagrams tab.
    expect(MESSAGES.ja.ribbonTemplateMenu).toBe(`リボンの [${ja.get("Tab.Label")}] > [${ja.get("Template.Label")}]`);
  });

  it("run the action with their argument", async () => {
    const actions = noopActions();
    const commands = ribbonCommands(actions);

    await commands.templateEr();
    await commands.cellsGantt();
    await commands.insertSvgOffice();
    await commands.downloadPng();

    expect(actions.useTemplate).toHaveBeenCalledWith("er");
    expect(actions.generateFromCells).toHaveBeenCalledWith("gantt");
    expect(actions.insert).toHaveBeenCalledWith("svg-office");
    expect(actions.download).toHaveBeenCalledWith("png");
  });

  it("are declared for the shared runtime in the manifest", () => {
    expect(MANIFEST).toContain('<Set Name="SharedRuntime" MinVersion="1.1"/>');
    expect(MANIFEST).toContain('<Runtime resid="Taskpane.Url" lifetime="long"/>');
    expect(MANIFEST).toContain('<FunctionFile resid="Taskpane.Url"/>');
  });
});
