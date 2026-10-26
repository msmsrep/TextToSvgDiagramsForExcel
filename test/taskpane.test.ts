import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramItem } from "../src/taskpane/excelShapes";
import { TEMPLATES } from "../src/taskpane/templates";

const m = vi.hoisted(() => ({
  listDiagrams: vi.fn(),
  onSheetActivated: vi.fn(),
  watchDiagramSelection: vi.fn(),
  isSvgInsertSupported: vi.fn(),
  insertImageShape: vi.fn(),
  insertSvgShape: vi.fn(),
  insertNativeShapes: vi.fn(),
  getDiagramWidth: vi.fn(),
  initMermaid: vi.fn(),
  renderMermaid: vi.fn(),
  getFlowchartData: vi.fn(),
  svgToRaster: vi.fn(),
  toOfficeSvg: vi.fn(),
  extractFlowchart: vi.fn(),
  readSelection: vi.fn(),
}));

vi.mock("../src/taskpane/excelShapes", () => ({
  listDiagrams: m.listDiagrams,
  onSheetActivated: m.onSheetActivated,
  watchDiagramSelection: m.watchDiagramSelection,
  isSvgInsertSupported: m.isSvgInsertSupported,
  insertImageShape: m.insertImageShape,
  insertSvgShape: m.insertSvgShape,
  insertNativeShapes: m.insertNativeShapes,
  getDiagramWidth: m.getDiagramWidth,
}));
vi.mock("../src/taskpane/excelTable", () => ({ readSelection: m.readSelection }));
vi.mock("../src/taskpane/render", () => ({
  initMermaid: m.initMermaid,
  renderMermaid: m.renderMermaid,
  getFlowchartData: m.getFlowchartData,
}));
vi.mock("../src/taskpane/officeSvg", () => ({ toOfficeSvg: m.toOfficeSvg }));
vi.mock("../src/taskpane/flowchartModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/taskpane/flowchartModel")>()),
  extractFlowchart: m.extractFlowchart,
}));
vi.mock("../src/taskpane/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/taskpane/image")>()),
  svgToRaster: m.svgToRaster,
}));

const HTML = readFileSync(join(__dirname, "../src/taskpane/taskpane.html"), "utf8");
const INITIAL_CODE = `graph LR
    A[Start] --> B{Condition}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`;
const SVG = '<svg id="mermaid-graph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>A</text></svg>';
const RASTER = { base64: "B64", width: 10, height: 10 };
const OFFICE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
const FLOW_DATA = { nodes: [{ id: "A", isGroup: false }], edges: [] };
const SHAPE_MODEL = { nodes: [], edges: [], labels: [] };
const DIAGRAMS: DiagramItem[] = [
  { id: "id-1", name: "Diagram 1", altTextDescription: "graph TD\nX-->Y" },
  { id: "id-2", name: "Diagram 2", altTextDescription: "pie\n\"a\": 1" },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = () => $<HTMLTextAreaElement>("mermaid-input");
const preview = () => $<HTMLDivElement>("preview");
const errorText = () => $<HTMLDivElement>("error").textContent;
const insertBtn = () => $<HTMLButtonElement>("insert-btn");
const downloadBtn = () => $<HTMLButtonElement>("download-btn");
const diagramSelect = () => $<HTMLSelectElement>("sheet-diagram-select");
const formatSelect = () => $<HTMLSelectElement>("format-select");
const tableKindSelect = () => $<HTMLSelectElement>("table-kind-select");
const generateBtn = () => $<HTMLButtonElement>("generate-btn");
const templateSelect = () => $<HTMLSelectElement>("template-select");
const templateBtn = () => $<HTMLButtonElement>("template-btn");
const loadConfirm = () => $<HTMLDivElement>("load-confirm");
const loadConfirmText = () => $<HTMLSpanElement>("load-confirm-text").textContent;
const replaceBtn = () => $<HTMLButtonElement>("load-confirm-replace");
const keepBtn = () => $<HTMLButtonElement>("load-confirm-keep");
const errorHighlightLine = () =>
  $<HTMLDivElement>("input-backdrop").querySelector(".error-line")?.textContent;
const optionLabels = () => Array.from(diagramSelect().options, (o) => [o.value, o.textContent]);

/** Lets pending promise chains (mocked async calls) settle. */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function type(code: string) {
  input().value = code;
  input().dispatchEvent(new Event("input"));
}

function selectDiagram(id: string) {
  diagramSelect().value = id;
  diagramSelect().dispatchEvent(new Event("change"));
}

/** Selects a shape on the sheet through the handler last given to watchDiagramSelection. */
async function selectShape(id: string) {
  const handler = m.watchDiagramSelection.mock.lastCall![1] as (id: string) => void;
  handler(id);
  await flush();
}

function activateSheet() {
  (m.onSheetActivated.mock.calls[0][0] as () => void)();
}

function setFormat(format: "png" | "jpeg" | "svg" | "svg-office" | "shapes") {
  formatSelect().value = format;
  formatSelect().dispatchEvent(new Event("change"));
}

async function click(button: HTMLButtonElement) {
  button.click();
  await flush();
}

/** Loads taskpane.html and runs taskpane.ts as if Office had just become ready. */
async function start() {
  document.documentElement.innerHTML = HTML.replace(/^[\s\S]*?<html[^>]*>|<\/html>[\s\S]*$/g, "");
  vi.stubGlobal("Office", { onReady: (cb: () => void) => cb() });
  vi.resetModules();
  await import("../src/taskpane/taskpane");
  await flush();
}

let downloads: Array<{ href: string; download: string }>;

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(m)) fn.mockReset();
  m.listDiagrams.mockResolvedValue([]);
  m.onSheetActivated.mockResolvedValue(undefined);
  m.watchDiagramSelection.mockResolvedValue(undefined);
  m.isSvgInsertSupported.mockReturnValue(true);
  m.renderMermaid.mockResolvedValue(SVG);
  m.svgToRaster.mockResolvedValue(RASTER);
  m.insertImageShape.mockResolvedValue("new-id");
  m.insertSvgShape.mockResolvedValue("new-svg-id");
  m.insertNativeShapes.mockResolvedValue("new-group-id");
  // The 10px-wide test SVG is 7.5pt, so keeping the size means a scale of 1.
  m.getDiagramWidth.mockResolvedValue(7.5);
  m.toOfficeSvg.mockReturnValue(OFFICE_SVG);
  m.getFlowchartData.mockResolvedValue(FLOW_DATA);
  m.extractFlowchart.mockReturnValue(SHAPE_MODEL);

  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startup", () => {
  it("initializes mermaid and renders the sample code", async () => {
    await start();

    expect(m.initMermaid).toHaveBeenCalledOnce();
    expect(m.initMermaid.mock.invocationCallOrder[0]).toBeLessThan(
      m.renderMermaid.mock.invocationCallOrder[0],
    );
    expect(m.renderMermaid).toHaveBeenCalledWith(INITIAL_CODE);
    expect(preview().querySelector("svg")).not.toBeNull();
    expect(insertBtn().disabled).toBe(false);
    expect(downloadBtn().disabled).toBe(false);
    expect(errorText()).toBe("");
  });

  it("loads the sheet diagram list and listens for sheet activation", async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();

    expect(optionLabels()).toEqual([
      ["", "(No diagram selected)"],
      ["id-1", "Diagram 1"],
      ["id-2", "Diagram 2"],
    ]);
    expect(diagramSelect().value).toBe("");
    expect(m.onSheetActivated).toHaveBeenCalledOnce();
  });

  it("keeps working when registering the sheet activation handler fails", async () => {
    m.onSheetActivated.mockRejectedValue(new Error("no events"));
    await start();
    expect(errorText()).toBe("");
    expect(insertBtn().disabled).toBe(false);
  });
});

describe("preview", () => {
  beforeEach(start);

  it("renders 250ms after the last input", async () => {
    m.renderMermaid.mockClear();
    type("graph TD\nA");
    await vi.advanceTimersByTimeAsync(200);
    type("graph TD\nA-->B");
    await vi.advanceTimersByTimeAsync(249);
    expect(m.renderMermaid).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(m.renderMermaid).toHaveBeenCalledOnce();
    expect(m.renderMermaid).toHaveBeenCalledWith("graph TD\nA-->B");
  });

  it("trims the code before rendering", async () => {
    type("\n  pie  \n");
    await vi.advanceTimersByTimeAsync(250);
    expect(m.renderMermaid).toHaveBeenLastCalledWith("pie");
  });

  it("shows the hint and disables the actions when the input is empty", async () => {
    m.renderMermaid.mockClear();
    type("   \n ");
    await vi.advanceTimersByTimeAsync(250);

    expect(m.renderMermaid).not.toHaveBeenCalled();
    expect(preview().textContent).toBe("Type Mermaid code");
    expect(insertBtn().disabled).toBe(true);
    expect(downloadBtn().disabled).toBe(true);
  });

  it("shows render errors, clears the preview and keeps the actions disabled", async () => {
    m.renderMermaid.mockRejectedValue(new Error("Parse error"));
    type("bad");
    await vi.advanceTimersByTimeAsync(250);

    expect(errorText()).toBe("Render error: Parse error");
    expect(preview().innerHTML).toBe("");
    expect(insertBtn().disabled).toBe(true);
    expect(downloadBtn().disabled).toBe(true);
  });

  it("highlights the error line and offers to go to it", async () => {
    m.renderMermaid.mockRejectedValue(new Error("Parse error on line 2:\n...\nExpecting 'ID'"));
    type("\ngraph TD\n%% note\nA--> -->");
    await vi.advanceTimersByTimeAsync(250);

    expect(errorHighlightLine()).toBe("A--> -->");
    const goTo = $<HTMLDivElement>("error").querySelector("button")!;
    expect(goTo.textContent).toBe("Go to line 4");
    goTo.click();
    expect(input().selectionStart).toBe(18);
  });

  it("does not highlight errors without a line", async () => {
    m.renderMermaid.mockRejectedValue(new Error("No diagram type detected"));
    type("bad");
    await vi.advanceTimersByTimeAsync(250);
    expect(errorHighlightLine()).toBeUndefined();
    expect($<HTMLDivElement>("error").querySelector("button")).toBeNull();
  });

  it.each([
    ["a successful render", "graph TD\nA-->B"],
    ["emptying the input", ""],
  ])("clears the error highlight on %s", async (_, code) => {
    m.renderMermaid.mockRejectedValueOnce(new Error("Parse error on line 1:"));
    type("bad");
    await vi.advanceTimersByTimeAsync(250);
    expect(errorHighlightLine()).toBe("bad");

    type(code);
    await vi.advanceTimersByTimeAsync(250);
    expect(errorHighlightLine()).toBeUndefined();
  });

  it("clears the previous error on the next render", async () => {
    m.renderMermaid.mockRejectedValueOnce("oops");
    type("bad");
    await vi.advanceTimersByTimeAsync(250);
    expect(errorText()).toBe("Render error: oops");

    type("good");
    await vi.advanceTimersByTimeAsync(250);
    expect(errorText()).toBe("");
    expect(insertBtn().disabled).toBe(false);
  });

  it("disables the actions while a render is in progress", async () => {
    const pending = deferred<string>();
    m.renderMermaid.mockReturnValue(pending.promise);
    type("graph TD\nA-->B");
    await vi.advanceTimersByTimeAsync(250);
    expect(insertBtn().disabled).toBe(true);

    pending.resolve(SVG);
    await flush();
    expect(insertBtn().disabled).toBe(false);
  });

  it("disables the actions as soon as the input changes", async () => {
    expect(insertBtn().disabled).toBe(false);
    type("graph TD\nA-->B");
    expect(insertBtn().disabled).toBe(true);
    expect(downloadBtn().disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(250);
    expect(insertBtn().disabled).toBe(false);
  });

  it("discards a render in progress when the input changes", async () => {
    const pending = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(pending.promise);
    type("old");
    await vi.advanceTimersByTimeAsync(250);
    type("newer");
    pending.resolve("<svg><text>old</text></svg>");
    await flush();

    expect(preview().textContent).not.toBe("old");
    expect(insertBtn().disabled).toBe(true);
  });

  it("discards a stale render result that finishes after a newer one", async () => {
    const first = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(first.promise).mockResolvedValueOnce("<svg><text>new</text></svg>");

    type("old");
    await vi.advanceTimersByTimeAsync(250);
    type("new");
    await vi.advanceTimersByTimeAsync(250);
    first.resolve("<svg><text>old</text></svg>");
    await flush();

    expect(preview().textContent).toBe("new");
  });

  it("discards a stale render error", async () => {
    const first = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(first.promise).mockResolvedValueOnce(SVG);

    type("old");
    await vi.advanceTimersByTimeAsync(250);
    type("new");
    await vi.advanceTimersByTimeAsync(250);
    first.reject(new Error("late failure"));
    await flush();

    expect(errorText()).toBe("");
    expect(preview().querySelector("svg")).not.toBeNull();
  });

  it("discards a pending render when the input is cleared", async () => {
    const first = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(first.promise);

    type("old");
    await vi.advanceTimersByTimeAsync(250);
    type("");
    await vi.advanceTimersByTimeAsync(250);
    first.resolve(SVG);
    await flush();

    expect(preview().textContent).toBe("Type Mermaid code");
    expect(insertBtn().disabled).toBe(true);
  });
});

describe("sheet diagram dropdown", () => {
  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();
  });

  it("loads the selected diagram's code into the input and renders it immediately", async () => {
    m.renderMermaid.mockClear();
    selectDiagram("id-2");
    await flush();

    expect(input().value).toBe("pie\n\"a\": 1");
    expect(m.renderMermaid).toHaveBeenCalledWith("pie\n\"a\": 1");
  });

  it("leaves the input alone when '(No diagram selected)' is chosen", async () => {
    selectDiagram("id-1");
    await flush();
    m.renderMermaid.mockClear();
    input().value = "edited";

    selectDiagram("");
    await flush();
    expect(input().value).toBe("edited");
    expect(m.renderMermaid).not.toHaveBeenCalled();
  });

  it("reloads the list on focus, keeping the selection when it still exists", async () => {
    selectDiagram("id-2");
    await flush();
    m.listDiagrams.mockResolvedValue([
      DIAGRAMS[1],
      { id: "id-3", name: "Diagram 3", altTextDescription: "" },
    ]);

    diagramSelect().dispatchEvent(new Event("focus"));
    await flush();

    expect(optionLabels()).toEqual([
      ["", "(No diagram selected)"],
      ["id-2", "Diagram 2"],
      ["id-3", "Diagram 3"],
    ]);
    expect(diagramSelect().value).toBe("id-2");
  });

  it("falls back to '(No diagram selected)' when the selected diagram is gone", async () => {
    selectDiagram("id-1");
    await flush();
    m.listDiagrams.mockResolvedValue([DIAGRAMS[1]]);

    diagramSelect().dispatchEvent(new Event("focus"));
    await flush();
    expect(diagramSelect().value).toBe("");
  });

  it("empties the list without showing an error when loading fails", async () => {
    m.listDiagrams.mockRejectedValue(new Error("Excel busy"));

    diagramSelect().dispatchEvent(new Event("focus"));
    await flush();
    expect(optionLabels()).toEqual([["", "(No diagram selected)"]]);
    expect(errorText()).toBe("");
  });

  it("reloads the list without a selection when another sheet is activated", async () => {
    selectDiagram("id-1");
    await flush();
    m.listDiagrams.mockResolvedValue([{ id: "id-9", name: "Other sheet", altTextDescription: "pie" }]);

    activateSheet();
    await flush();
    expect(optionLabels()).toEqual([["", "(No diagram selected)"], ["id-9", "Other sheet"]]);
    expect(diagramSelect().value).toBe("");
    expect(m.watchDiagramSelection).toHaveBeenLastCalledWith(["id-9"], expect.any(Function));
  });

  it("asks before replacing unsaved code and keeps the current diagram until confirmed", async () => {
    selectDiagram("id-1");
    await flush();
    type("graph TD\nX-->Z");
    selectDiagram("id-2");
    await flush();

    expect(loadConfirm().hidden).toBe(false);
    expect(diagramSelect().value).toBe("id-1");
    expect(input().value).toBe("graph TD\nX-->Z");

    await click(replaceBtn());
    expect(loadConfirm().hidden).toBe(true);
    expect(diagramSelect().value).toBe("id-2");
    expect(input().value).toBe("pie\n\"a\": 1");
  });
});

describe("selecting a diagram on the sheet", () => {
  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();
  });

  it("watches the listed diagrams", () => {
    expect(m.watchDiagramSelection).toHaveBeenCalledWith(["id-1", "id-2"], expect.any(Function));
  });

  it("re-watches the diagrams whenever the list is reloaded", async () => {
    m.listDiagrams.mockResolvedValue([DIAGRAMS[1]]);
    diagramSelect().dispatchEvent(new Event("focus"));
    await flush();
    expect(m.watchDiagramSelection).toHaveBeenLastCalledWith(["id-2"], expect.any(Function));
  });

  it("loads the selected diagram when the editor has no unsaved code", async () => {
    m.renderMermaid.mockClear();
    await selectShape("id-2");

    expect(loadConfirm().hidden).toBe(true);
    expect(diagramSelect().value).toBe("id-2");
    expect(input().value).toBe("pie\n\"a\": 1");
    expect(m.renderMermaid).toHaveBeenCalledWith("pie\n\"a\": 1");
  });

  it("loads another diagram without asking after loading one", async () => {
    await selectShape("id-1");
    await selectShape("id-2");
    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("pie\n\"a\": 1");
  });

  it("loads without asking when the editor is empty", async () => {
    type("");
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("graph TD\nX-->Y");
  });

  it("asks before replacing unsaved code", async () => {
    type("edited");
    await selectShape("id-1");

    expect(loadConfirm().hidden).toBe(false);
    expect(loadConfirmText()).toContain('"Diagram 1"');
    expect(input().value).toBe("edited");
    expect(diagramSelect().value).toBe("");
  });

  it("loads the diagram when Replace is clicked", async () => {
    type("edited");
    await selectShape("id-1");
    await click(replaceBtn());

    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("graph TD\nX-->Y");
    expect(diagramSelect().value).toBe("id-1");
    await click(insertBtn());
    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, "graph TD\nX-->Y", "id-1");
  });

  it("keeps the code and the current diagram when Keep is clicked", async () => {
    type("edited");
    await vi.advanceTimersByTimeAsync(250);
    await selectShape("id-1");
    await click(keepBtn());

    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("edited");
    expect(diagramSelect().value).toBe("");
    await click(insertBtn());
    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, "edited", undefined);
  });

  it("asks about the last selected diagram when several are selected", async () => {
    type("edited");
    await selectShape("id-1");
    await selectShape("id-2");
    await click(replaceBtn());
    expect(input().value).toBe("pie\n\"a\": 1");
  });

  it("keeps edits when the diagram being edited is selected", async () => {
    await selectShape("id-1");
    type("graph TD\nX-->Z");
    await selectShape("id-1");

    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("graph TD\nX-->Z");
  });

  it("cancels the question when the diagram being edited is selected again", async () => {
    await selectShape("id-1");
    type("graph TD\nX-->Z");
    await selectShape("id-2");
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("graph TD\nX-->Z");
  });

  it("does not ask when the editor already holds the diagram's code", async () => {
    type("graph TD\nX-->Y");
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(true);
    expect(diagramSelect().value).toBe("id-1");
  });

  it("does not ask after the code was inserted", async () => {
    type("graph TD\nA-->B");
    await vi.advanceTimersByTimeAsync(250);
    await click(insertBtn());
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(true);
    expect(input().value).toBe("graph TD\nX-->Y");
  });

  it("asks before replacing generated code", async () => {
    m.readSelection.mockResolvedValue({
      values: [["A", "B"]], text: [["A", "B"]], numberFormat: [["General", "General"]], firstRow: 1,
    });
    await click(generateBtn());
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(false);
  });

  it("cancels a pending render of typed code when loading", async () => {
    type("typed");
    await selectShape("id-1");
    await click(replaceBtn());
    m.renderMermaid.mockClear();
    await vi.advanceTimersByTimeAsync(250);
    expect(m.renderMermaid).not.toHaveBeenCalled();
  });

  it("hides the question when another sheet is activated", async () => {
    type("edited");
    await selectShape("id-1");
    activateSheet();
    expect(loadConfirm().hidden).toBe(true);
  });

  it("ignores shapes that are not in the list", async () => {
    await selectShape("unknown");
    expect(diagramSelect().value).toBe("");
    expect(loadConfirm().hidden).toBe(true);
  });

  it("keeps working when watching the diagrams fails", async () => {
    m.watchDiagramSelection.mockRejectedValue(new Error("no events"));
    await start();
    expect(optionLabels()).toHaveLength(3);
    expect(errorText()).toBe("");
  });
});

describe("template", () => {
  const SEQUENCE = TEMPLATES.find((t) => t.id === "sequence")!;

  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();
  });

  it("lists every template", () => {
    expect(Array.from(templateSelect().options, (o) => [o.value, o.textContent])).toEqual(
      TEMPLATES.map((t) => [t.id, t.label]),
    );
  });

  it("puts the chosen template in the input and renders it immediately", async () => {
    m.renderMermaid.mockClear();
    templateSelect().value = "sequence";
    await click(templateBtn());

    expect(input().value).toBe(SEQUENCE.code);
    expect(m.renderMermaid).toHaveBeenCalledOnce();
    expect(m.renderMermaid).toHaveBeenCalledWith(SEQUENCE.code);
    expect(insertBtn().disabled).toBe(false);
  });

  it("clears the sheet diagram selection so the code is inserted as a new diagram", async () => {
    selectDiagram("id-1");
    await flush();
    templateSelect().value = "sequence";
    await click(templateBtn());

    expect(diagramSelect().value).toBe("");
    await click(insertBtn());
    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, SEQUENCE.code, undefined);
  });

  it("asks before replacing the template code", async () => {
    await click(templateBtn());
    await selectShape("id-1");
    expect(loadConfirm().hidden).toBe(false);
  });

  it("cancels a pending render of typed code", async () => {
    type("typed");
    await click(templateBtn());
    m.renderMermaid.mockClear();
    await vi.advanceTimersByTimeAsync(250);
    expect(m.renderMermaid).not.toHaveBeenCalled();
  });
});

describe("code from selected cells", () => {
  const TABLE = { values: [["A", "B"]], text: [["A", "B"]], numberFormat: [["General", "General"]], firstRow: 1 };
  const CODE = 'graph TD\n    n1["A"] --> n2["B"]';

  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    m.readSelection.mockResolvedValue(TABLE);
    await start();
  });

  it("puts the generated code in the input and renders it immediately", async () => {
    m.renderMermaid.mockClear();
    await click(generateBtn());

    expect(input().value).toBe(CODE);
    expect(m.renderMermaid).toHaveBeenCalledOnce();
    expect(m.renderMermaid).toHaveBeenCalledWith(CODE);
    expect(insertBtn().disabled).toBe(false);
  });

  it("generates the chosen diagram type", async () => {
    m.readSelection.mockResolvedValue({ ...TABLE, values: [["Item", "Value"], ["A", 3]] });
    tableKindSelect().value = "pie";
    await click(generateBtn());
    expect(input().value).toBe('pie\n    "A" : 3');
  });

  it("clears the sheet diagram selection so the code is inserted as a new diagram", async () => {
    selectDiagram("id-1");
    await flush();
    await click(generateBtn());

    expect(diagramSelect().value).toBe("");
    await click(insertBtn());
    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, CODE, undefined);
  });

  it("cancels a pending render of typed code", async () => {
    type("typed");
    await click(generateBtn());
    m.renderMermaid.mockClear();
    await vi.advanceTimersByTimeAsync(250);
    expect(m.renderMermaid).not.toHaveBeenCalled();
  });

  it("reports read failures and leaves the input alone", async () => {
    m.readSelection.mockRejectedValue(new Error("Select a cell range on the sheet."));
    type("mine");
    await click(generateBtn());

    expect(errorText()).toBe("Generate error: Select a cell range on the sheet.");
    expect(input().value).toBe("mine");
  });
});

describe("insert", () => {
  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();
  });

  it.each(["png", "jpeg"] as const)("inserts a %s image of the preview with the trimmed code", async (format) => {
    setFormat(format);
    input().value = "  graph TD\nA-->B \n";
    await click(insertBtn());

    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), format, 1);
    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, "graph TD\nA-->B", undefined);
    expect(m.insertSvgShape).not.toHaveBeenCalled();
    expect(errorText()).toBe("");
  });

  it("replaces the selected sheet diagram", async () => {
    selectDiagram("id-1");
    await flush();
    await click(insertBtn());

    expect(m.insertImageShape).toHaveBeenCalledWith(RASTER, "graph TD\nX-->Y", "id-1");
  });

  it("reloads the list and selects the inserted shape", async () => {
    m.listDiagrams.mockResolvedValue([...DIAGRAMS, { id: "new-id", name: "New", altTextDescription: "" }]);
    await click(insertBtn());

    expect(diagramSelect().value).toBe("new-id");
  });

  it("inserts the serialized SVG when SVG is selected and supported", async () => {
    setFormat("svg");
    selectDiagram("id-2");
    await flush();
    await click(insertBtn());

    const svg = new XMLSerializer().serializeToString(preview().querySelector("svg")!);
    expect(m.insertSvgShape).toHaveBeenCalledWith({ svg, width: 10, height: 10 }, "pie\n\"a\": 1", "id-2");
    expect(m.svgToRaster).not.toHaveBeenCalled();
  });

  it("refuses SVG insertion when ImageCoercion 1.2 is unsupported", async () => {
    setFormat("svg");
    m.isSvgInsertSupported.mockReturnValue(false);
    await click(insertBtn());

    expect(m.insertSvgShape).not.toHaveBeenCalled();
    expect(errorText()).toBe(
      "Insert error: SVG insertion is not supported in this version of Excel. Use PNG or JPEG.",
    );
  });

  it("inserts the shape-conversion SVG through the SVG path", async () => {
    setFormat("svg-office");
    selectDiagram("id-2");
    await flush();
    await click(insertBtn());

    expect(m.toOfficeSvg).toHaveBeenCalledWith(preview().querySelector("svg"));
    expect(m.insertSvgShape).toHaveBeenCalledWith(
      { svg: OFFICE_SVG, width: 10, height: 10 },
      "pie\n\"a\": 1",
      "id-2",
    );
  });

  it("refuses shape-conversion SVG insertion when ImageCoercion 1.2 is unsupported", async () => {
    setFormat("svg-office");
    m.isSvgInsertSupported.mockReturnValue(false);
    await click(insertBtn());

    expect(m.insertSvgShape).not.toHaveBeenCalled();
    expect(errorText()).toContain("SVG insertion is not supported");
  });

  it("inserts native shapes built from the flowchart data and the preview", async () => {
    setFormat("shapes");
    selectDiagram("id-1");
    await flush();
    await click(insertBtn());

    expect(m.getFlowchartData).toHaveBeenCalledWith("graph TD\nX-->Y");
    expect(m.extractFlowchart).toHaveBeenCalledWith(preview().querySelector("svg"), FLOW_DATA);
    expect(m.insertNativeShapes).toHaveBeenCalledWith(SHAPE_MODEL, "graph TD\nX-->Y", "id-1");
    expect(m.insertSvgShape).not.toHaveBeenCalled();
    expect(m.insertImageShape).not.toHaveBeenCalled();
  });

  it("refuses native shapes for diagrams other than flowcharts", async () => {
    setFormat("shapes");
    m.getFlowchartData.mockResolvedValue(null);
    await click(insertBtn());

    expect(m.insertNativeShapes).not.toHaveBeenCalled();
    expect(errorText()).toBe("Insert error: Shapes format supports flowcharts only.");
  });

  it("reports insertion failures", async () => {
    m.insertImageShape.mockRejectedValue(new Error("Selected diagram no longer exists."));
    await click(insertBtn());

    expect(errorText()).toBe("Insert error: Selected diagram no longer exists.");
    expect(m.listDiagrams).toHaveBeenCalledTimes(1);
  });

  it("clears the previous error when clicked again", async () => {
    m.insertImageShape.mockRejectedValueOnce(new Error("fail"));
    await click(insertBtn());
    expect(errorText()).toBe("Insert error: fail");

    await click(insertBtn());
    expect(errorText()).toBe("");
  });

  it("asks to render first when the preview has no SVG", async () => {
    m.renderMermaid.mockResolvedValue("<p>no svg</p>");
    type("graph TD");
    await vi.advanceTimersByTimeAsync(250);
    await click(insertBtn());

    expect(errorText()).toBe("Please render first");
    expect(m.insertImageShape).not.toHaveBeenCalled();
  });
});

describe("download", () => {
  beforeEach(start);

  it("downloads PNG as diagram.png", async () => {
    await click(downloadBtn());

    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "png", 1);
    expect(downloads).toEqual([{ href: "data:image/png;base64,B64", download: "diagram.png" }]);
  });

  it("downloads JPEG as diagram.jpg", async () => {
    setFormat("jpeg");
    await click(downloadBtn());

    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "jpeg", 1);
    expect(downloads).toEqual([{ href: "data:image/jpeg;base64,B64", download: "diagram.jpg" }]);
  });

  it("downloads SVG as diagram.svg without rasterizing", async () => {
    setFormat("svg");
    await click(downloadBtn());

    const svg = new XMLSerializer().serializeToString(preview().querySelector("svg")!);
    expect(downloads).toEqual([
      { href: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), download: "diagram.svg" },
    ]);
    expect(m.svgToRaster).not.toHaveBeenCalled();
  });

  it("downloads the shape-conversion SVG as diagram.svg", async () => {
    setFormat("svg-office");
    await click(downloadBtn());

    expect(m.toOfficeSvg).toHaveBeenCalledWith(preview().querySelector("svg"));
    expect(downloads).toEqual([
      { href: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(OFFICE_SVG), download: "diagram.svg" },
    ]);
  });

  it("disables download for the Shapes format and re-enables it for other formats", async () => {
    setFormat("shapes");
    expect(downloadBtn().disabled).toBe(true);
    expect(insertBtn().disabled).toBe(false);

    setFormat("png");
    expect(downloadBtn().disabled).toBe(false);
  });

  it("keeps download disabled for the Shapes format after rendering", async () => {
    setFormat("shapes");
    type("graph TD\nA-->B");
    await vi.advanceTimersByTimeAsync(250);

    expect(insertBtn().disabled).toBe(false);
    expect(downloadBtn().disabled).toBe(true);
  });

  it("keeps the actions disabled when switching formats without a rendered preview", async () => {
    type("");
    await vi.advanceTimersByTimeAsync(250);
    setFormat("svg");

    expect(insertBtn().disabled).toBe(true);
    expect(downloadBtn().disabled).toBe(true);
  });

  it("does not touch Excel", async () => {
    await click(downloadBtn());
    expect(m.insertImageShape).not.toHaveBeenCalled();
    expect(m.insertSvgShape).not.toHaveBeenCalled();
  });

  it("reports conversion failures", async () => {
    m.svgToRaster.mockRejectedValue(new Error("Failed to load SVG image."));
    await click(downloadBtn());

    expect(errorText()).toBe("Download error: Failed to load SVG image.");
    expect(downloads).toEqual([]);
  });

  it("asks to render first when the preview has no SVG", async () => {
    m.renderMermaid.mockResolvedValue("<p>no svg</p>");
    type("graph TD");
    await vi.advanceTimersByTimeAsync(250);
    await click(downloadBtn());

    expect(errorText()).toBe("Please render first");
    expect(downloads).toEqual([]);
  });
});

describe("output size", () => {
  const sizeSelect = () => $<HTMLSelectElement>("size-select");
  const sizeWidth = () => $<HTMLInputElement>("size-width");
  const keepSize = () => $<HTMLInputElement>("keep-size");

  function setSize(value: string) {
    sizeSelect().value = value;
    sizeSelect().dispatchEvent(new Event("change"));
  }

  beforeEach(async () => {
    m.listDiagrams.mockResolvedValue(DIAGRAMS);
    await start();
  });

  it("starts at 100% with Keep current size checked but disabled without a diagram", () => {
    expect(sizeSelect().value).toBe("1");
    expect(sizeWidth().hidden).toBe(true);
    expect(keepSize().checked).toBe(true);
    expect(keepSize().disabled).toBe(true);
  });

  it("enables Keep current size while a diagram is being replaced", async () => {
    selectDiagram("id-1");
    await flush();
    expect(keepSize().disabled).toBe(false);

    selectDiagram("");
    expect(keepSize().disabled).toBe(true);
  });

  it("fixes the size of SVG (for shape conversion)", async () => {
    selectDiagram("id-1");
    await flush();
    setFormat("svg-office");
    expect(sizeSelect().disabled).toBe(true);
    expect(keepSize().disabled).toBe(true);

    setFormat("png");
    expect(sizeSelect().disabled).toBe(false);
    expect(keepSize().disabled).toBe(false);
  });

  it("shows the width box, starting at the diagram's actual width", () => {
    setSize("width");
    expect(sizeWidth().hidden).toBe(false);
    expect(sizeWidth().value).toBe("8");

    sizeWidth().value = "30";
    setSize("2");
    setSize("width");
    expect(sizeWidth().value).toBe("30");
  });

  it.each(["png", "jpeg"] as const)("inserts and downloads %s at the chosen scale", async (format) => {
    setFormat(format);
    setSize("1.5");
    await click(insertBtn());
    await click(downloadBtn());

    expect(m.svgToRaster).toHaveBeenNthCalledWith(1, preview().querySelector("svg"), format, 1.5);
    expect(m.svgToRaster).toHaveBeenNthCalledWith(2, preview().querySelector("svg"), format, 1.5);
  });

  it("inserts at the entered width", async () => {
    setSize("width");
    sizeWidth().value = "15";
    await click(insertBtn());
    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "png", 2);
  });

  it("reports an invalid width", async () => {
    setSize("width");
    sizeWidth().value = "0";
    await click(insertBtn());
    expect(errorText()).toBe("Insert error: Enter a width greater than 0.");
    expect(m.insertImageShape).not.toHaveBeenCalled();
  });

  it("scales the SVG shape and the downloaded SVG", async () => {
    setFormat("svg");
    setSize("2");
    await click(insertBtn());
    await click(downloadBtn());

    expect(m.insertSvgShape.mock.calls[0][0]).toMatchObject({ width: 20, height: 20 });
    const svg = decodeURIComponent(downloads[0].href.split(",")[1]);
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
  });

  it("scales the native shapes", async () => {
    m.extractFlowchart.mockReturnValue({
      nodes: [], labels: [],
      edges: [{
        from: "A", to: "B", begin: { x: 1, y: 2 }, end: { x: 3, y: 4 },
        beginArrow: "None", endArrow: "Triangle",
        line: { color: "#333333", weight: 1, dashStyle: "Solid" }, connectorType: "Straight",
      }],
    });
    setFormat("shapes");
    setSize("0.5");
    await click(insertBtn());

    expect(m.insertNativeShapes.mock.calls[0][0].edges[0]).toMatchObject({
      begin: { x: 0.5, y: 1 }, end: { x: 1.5, y: 2 }, line: { weight: 0.5 },
    });
  });

  it("keeps the replaced diagram's width, ignoring Size", async () => {
    m.getDiagramWidth.mockResolvedValue(30);
    selectDiagram("id-1");
    await flush();
    setSize("0.5");
    await click(insertBtn());

    expect(m.getDiagramWidth).toHaveBeenCalledWith("id-1");
    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "png", 4);
  });

  it("uses Size when replacing with Keep current size unchecked", async () => {
    selectDiagram("id-1");
    await flush();
    keepSize().checked = false;
    setSize("0.5");
    await click(insertBtn());

    expect(m.getDiagramWidth).not.toHaveBeenCalled();
    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "png", 0.5);
  });

  it("downloads at the chosen size even while replacing", async () => {
    m.getDiagramWidth.mockResolvedValue(30);
    selectDiagram("id-1");
    await flush();
    setSize("0.5");
    await click(downloadBtn());

    expect(m.getDiagramWidth).not.toHaveBeenCalled();
    expect(m.svgToRaster).toHaveBeenCalledWith(preview().querySelector("svg"), "png", 0.5);
  });

  it("inserts SVG (for shape conversion) at the actual size", async () => {
    selectDiagram("id-1");
    await flush();
    setSize("2");
    setFormat("svg-office");
    await click(insertBtn());

    expect(m.getDiagramWidth).not.toHaveBeenCalled();
    expect(m.insertSvgShape.mock.calls[0][0]).toMatchObject({ width: 10, height: 10 });
  });

  it("reports when the diagram's size is unknown", async () => {
    m.renderMermaid.mockResolvedValue('<svg id="mermaid-graph" xmlns="http://www.w3.org/2000/svg"></svg>');
    type("graph TD");
    await vi.advanceTimersByTimeAsync(250);
    setSize("width");
    sizeWidth().value = "100";
    await click(insertBtn());
    expect(errorText()).toBe("Insert error: The diagram's size is unknown.");
  });
});