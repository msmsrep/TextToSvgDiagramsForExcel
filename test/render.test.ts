import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  mermaidAPI: { getDiagramFromText: vi.fn() },
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { getFlowchartData, initMermaid, renderMermaid } from "../src/core/render";

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.mermaidAPI.getDiagramFromText.mockReset();
  document.body.innerHTML = "";
});

describe("initMermaid", () => {
  it("disables auto rendering and HTML labels, and renders at natural size", () => {
    initMermaid();
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: "default",
      htmlLabels: false,
      flowchart: { useMaxWidth: false, htmlLabels: false },
    });
  });
});

describe("renderMermaid", () => {
  it("renders the code under the fixed graph ID and returns the SVG", async () => {
    mermaid.render.mockResolvedValue({ svg: "<svg>ok</svg>" });

    expect(await renderMermaid("graph TD\nA-->B")).toBe("<svg>ok</svg>");
    expect(mermaid.render).toHaveBeenCalledWith("mermaid-graph", "graph TD\nA-->B");
  });

  it("removes a leftover element with the graph ID before rendering", async () => {
    document.body.innerHTML = '<div id="mermaid-graph"></div>';
    mermaid.render.mockImplementation(async () => {
      expect(document.getElementById("mermaid-graph")).toBeNull();
      return { svg: "<svg/>" };
    });

    await renderMermaid("pie");
    expect(mermaid.render).toHaveBeenCalledOnce();
  });

  it("propagates render errors", async () => {
    mermaid.render.mockRejectedValue(new Error("Parse error on line 1"));
    await expect(renderMermaid("bad")).rejects.toThrow("Parse error on line 1");
  });
});

describe("getFlowchartData", () => {
  const nodes = [{ id: "A", shape: "squareRect", isGroup: false, domId: "flowchart-A-0" }];
  const edges = [{ id: "L_A_B_0", start: "A", end: "B" }];

  it.each(["flowchart-v2", "flowchart", "flowchart-elk"])("returns the nodes and edges of a %s diagram", async (type) => {
    const getData = vi.fn(() => ({ nodes, edges, config: {} }));
    mermaid.mermaidAPI.getDiagramFromText.mockResolvedValue({ type, db: { getData } });

    expect(await getFlowchartData("graph LR\nA-->B")).toEqual({ nodes, edges });
    expect(mermaid.mermaidAPI.getDiagramFromText).toHaveBeenCalledWith("graph LR\nA-->B");
  });

  it("returns null for other diagram types", async () => {
    mermaid.mermaidAPI.getDiagramFromText.mockResolvedValue({ type: "pie", db: {} });
    expect(await getFlowchartData("pie")).toBeNull();
  });

  it("propagates parse errors", async () => {
    mermaid.mermaidAPI.getDiagramFromText.mockRejectedValue(new Error("Parse error"));
    await expect(getFlowchartData("bad")).rejects.toThrow("Parse error");
  });
});
