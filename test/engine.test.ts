import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  initMermaid: vi.fn(),
  renderMermaid: vi.fn(),
  getFlowchartData: vi.fn(),
  svgToRaster: vi.fn(),
  toOfficeSvg: vi.fn(),
  extractFlowchart: vi.fn(),
}));
vi.mock("../src/core/render", () => ({
  initMermaid: m.initMermaid,
  renderMermaid: m.renderMermaid,
  getFlowchartData: m.getFlowchartData,
}));
vi.mock("../src/core/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/image")>()),
  svgToRaster: m.svgToRaster,
}));
vi.mock("../src/core/officeSvg", () => ({ toOfficeSvg: m.toOfficeSvg }));
vi.mock("../src/core/flowchartModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/flowchartModel")>()),
  extractFlowchart: m.extractFlowchart,
}));

import { connect, createEngine, type Engine, type EngineResponse, type WebViewHost } from "../src/engine/engine";
import { setLocale } from "../src/core/messages";
import { TEMPLATES } from "../src/core/templates";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-graph" viewBox="0 0 120 40"><text>A</text></svg>';

let preview: HTMLDivElement;
let engine: Engine;
let nextId = 1;

const call = (method: string, params?: Record<string, unknown>) => engine.handle({ id: nextId++, method, params });

/** A promise with its resolve/reject exposed, for renders that finish out of order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  setLocale("en");
  document.body.innerHTML = '<div id="preview"></div>';
  preview = document.getElementById("preview") as HTMLDivElement;
  engine = createEngine(preview);
});

describe("init", () => {
  it("initializes mermaid and shows the hint in the chosen language", async () => {
    expect(await call("init", { locale: "ja" })).toMatchObject({ result: null });
    expect(m.initMermaid).toHaveBeenCalled();
    expect(preview.textContent).toBe("Mermaid のコードを入力するか、[新規] > [テンプレート] から始めてください");
  });

  it("falls back to English for other locales", async () => {
    await call("init", { locale: "fr" });
    expect(preview.textContent).toBe("Type Mermaid code, or start from New > Template");
  });
});

describe("render", () => {
  it("shows the SVG and returns its size", async () => {
    m.renderMermaid.mockResolvedValue(SVG);
    const res = await call("render", { code: "  graph LR\r\n A-->B  ", seq: 1 });

    expect(m.renderMermaid).toHaveBeenCalledWith("graph LR\n A-->B");
    expect(res.result).toEqual({ seq: 1, width: 120, height: 40 });
    expect(preview.querySelector("svg")).not.toBeNull();
  });

  it("returns null sizes when the SVG has no viewBox", async () => {
    m.renderMermaid.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await call("render", { code: "pie", seq: 1 })).result).toEqual({ seq: 1, width: null, height: null });
  });

  it("returns a render error with the editor line it points at, and clears the preview", async () => {
    m.renderMermaid.mockResolvedValueOnce(SVG).mockRejectedValueOnce(new Error("Parse error on line 2:\n..."));
    await call("render", { code: "graph LR", seq: 1 });
    const res = await call("render", { code: "\ngraph LR\n  A--", seq: 2 });

    expect(res.error).toEqual({ code: "render", message: "Parse error on line 2:\n...", line: 2 });
    expect(preview.innerHTML).toBe("");
    // Nothing is shown, so outputs fail.
    expect((await call("svg", { seq: 1 })).error?.code).toBe("notRendered");
  });

  it("leaves out the line when the error has none", async () => {
    m.renderMermaid.mockRejectedValue(new Error("No diagram type detected"));
    expect((await call("render", { code: "x", seq: 1 })).error).toEqual({
      code: "render",
      message: "No diagram type detected",
    });
  });

  it("does not show a render that finishes after a newer one was requested", async () => {
    const first = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(first.promise).mockResolvedValueOnce(SVG.replace(">A<", ">B<"));

    const older = call("render", { code: "graph LR\nA", seq: 1 });
    const newer = await call("render", { code: "graph LR\nB", seq: 2 });
    first.resolve(SVG);

    expect((await older).error?.code).toBe("stale");
    expect(newer.result).toMatchObject({ seq: 2 });
    expect(preview.textContent).toBe("B");
  });

  it("does not report a stale render's error", async () => {
    const first = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(first.promise).mockResolvedValueOnce(SVG);

    const older = call("render", { code: "bad", seq: 1 });
    await call("render", { code: "graph LR", seq: 2 });
    first.reject(new Error("Parse error on line 1:"));

    expect((await older).error?.code).toBe("stale");
    expect(preview.querySelector("svg")).not.toBeNull();
  });
});

describe("clear", () => {
  it("shows the hint and forgets the diagram", async () => {
    m.renderMermaid.mockResolvedValue(SVG);
    await call("render", { code: "graph LR", seq: 1 });
    await call("clear", { seq: 2 });

    expect(preview.querySelector(".hint")).not.toBeNull();
    expect((await call("svg", { seq: 1 })).error).toEqual({ code: "notRendered", message: "Please render first" });
  });
});

describe("outputs", () => {
  beforeEach(async () => {
    m.renderMermaid.mockResolvedValue(SVG);
    await call("render", { code: "graph LR\nA", seq: 3 });
  });

  it("rejects requests for a diagram other than the one shown", async () => {
    expect((await call("raster", { seq: 2, format: "png", scale: 1 })).error).toEqual({
      code: "changed",
      message: "Diagram changed. Try again.",
    });
  });

  it("localizes the engine's own errors", async () => {
    setLocale("ja");
    expect((await call("svg", { seq: 9 })).error?.message).toBe("図が変わりました。もう一度実行してください。");
  });

  it("rasterizes the shown SVG at the given scale", async () => {
    m.svgToRaster.mockResolvedValue({ base64: "QUJD", width: 240, height: 80 });
    const res = await call("raster", { seq: 3, format: "jpeg", scale: 2 });

    expect(res.result).toEqual({ base64: "QUJD", width: 240, height: 80 });
    expect(m.svgToRaster).toHaveBeenCalledWith(preview.querySelector("svg"), "jpeg", 2);
  });

  it("serializes the SVG, scaled when asked", async () => {
    const res = await call("svg", { seq: 3, scale: 2 });
    const svg = (res.result as { svg: string }).svg;
    expect(svg).toContain('width="240"');
    expect(svg).toContain('height="80"');
  });

  it("returns the SVG for shape conversion with its size", async () => {
    m.toOfficeSvg.mockReturnValue("<svg>office</svg>");
    expect((await call("officeSvg", { seq: 3 })).result).toEqual({ svg: "<svg>office</svg>", width: 120, height: 40 });
  });

  it("builds the shape model from the shown code, scaled", async () => {
    const data = { nodes: [], edges: [] };
    const model = {
      nodes: [{ id: "A", type: "Rectangle", box: { left: 0, top: 0, width: 10, height: 10 }, fill: null, line: null, label: { text: "A", size: 12, color: "#333333" }, labelPosition: "Middle" }],
      edges: [],
      labels: [],
    };
    m.getFlowchartData.mockResolvedValue(data);
    m.extractFlowchart.mockReturnValue(model);

    const res = await call("shapeModel", { seq: 3, scale: 2 });

    expect(m.getFlowchartData).toHaveBeenCalledWith("graph LR\nA");
    expect(res.result).toMatchObject({ nodes: [{ box: { width: 20, height: 20 }, label: { size: 24 } }] });
  });

  it("rejects shapes for diagrams other than flowcharts", async () => {
    m.getFlowchartData.mockResolvedValue(null);
    expect((await call("shapeModel", { seq: 3, scale: 1 })).error).toEqual({
      code: "notFlowchart",
      message: "Shapes format supports flowcharts only.",
    });
  });
});

describe("fromTable", () => {
  it("builds code from a table", async () => {
    const table = { values: [["A", "B"]], text: [["A", "B"]], numberFormat: [["", ""]], firstRow: 1 };
    expect((await call("fromTable", { table, kind: "flowchart" })).result).toEqual({
      code: 'graph TD\n    n1["A"] --> n2["B"]',
    });
  });

  it("uses the 1904 date system when the workbook does", async () => {
    const table = {
      values: [["Task", 0, 1]],
      text: [["Task", "", "1"]],
      numberFormat: [["General", "yyyy-mm-dd", "General"]],
      firstRow: 1,
      date1904: true,
    };
    expect(((await call("fromTable", { table, kind: "gantt" })).result as { code: string }).code).toContain(
      "Task : 1904-01-01, 1d",
    );
  });

  it("returns table errors in the chosen language", async () => {
    setLocale("ja");
    const table = { values: [["A"]], text: [["A"]], numberFormat: [[""]], firstRow: 1 };
    expect((await call("fromTable", { table, kind: "auto" })).error).toEqual({
      code: "table",
      message: "2 列以上を選択してください。",
    });
  });
});

describe("templates", () => {
  it("lists the templates", async () => {
    expect((await call("templates")).result).toEqual(TEMPLATES.map((t) => ({ id: t.id, name: t.label, code: t.code })));
  });
});

describe("requests", () => {
  it("rejects unknown methods", async () => {
    expect(await engine.handle({ id: 5, method: "nope" })).toEqual({
      id: 5,
      error: { code: "badRequest", message: "Unknown method: nope" },
    });
  });

  it("reports unexpected failures as internal errors", async () => {
    m.renderMermaid.mockResolvedValue(SVG);
    await call("render", { code: "graph LR", seq: 1 });
    m.svgToRaster.mockRejectedValue(new Error("canvas exploded"));
    expect((await call("raster", { seq: 1, format: "png" })).error).toEqual({
      code: "internal",
      message: "canvas exploded",
    });
  });
});

describe("connect", () => {
  it("answers WebView2 messages in request order", async () => {
    let listener!: (e: { data: unknown }) => void;
    const posted: EngineResponse[] = [];
    const host: WebViewHost = {
      postMessage: (message) => posted.push(message as EngineResponse),
      addEventListener: (_type, l) => (listener = l),
    };
    connect(host, preview);
    const slow = deferred<string>();
    m.renderMermaid.mockReturnValueOnce(slow.promise);

    listener({ data: { id: 1, method: "render", params: { code: "graph LR", seq: 1 } } });
    listener({ data: { id: 2, method: "templates" } });
    slow.resolve(SVG);
    await vi.waitFor(() => expect(posted).toHaveLength(2));

    expect(posted.map((r) => r.id)).toEqual([1, 2]);
  });
});
