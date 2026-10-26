import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectionSite, extractFlowchart, type ShapeModel, scaleModel } from "../src/core/flowchartModel";
import type { FlowchartData } from "../src/core/render";
import connectionSiteFixture from "./fixtures/connectionSite.json";
import { stubSvgGeometry } from "./fakes/svgGeometry";

const points = (...p: Array<[number, number]>) => btoa(JSON.stringify(p.map(([x, y]) => ({ x, y }))));

// Mirrors mermaid's flowchart SVG: subgraph S holds A; A -> B ("Yes"), B -.-> C, C ~~~ A.
// g.root is shifted by 10px, so the diagram's top-left is the cluster at (10, 0).
// Mermaid puts the <style> inside the <svg>, but jsdom only applies it outside.
const STYLE = `
<style>
  #g1 .node rect, #g1 .node polygon { fill: #ececff; stroke: #9370db; stroke-width: 1px; }
  #g1 .cluster rect { fill: #ffffde; stroke: #aaaa33; stroke-width: 1px; }
  #g1 .flowchart-link { fill: none; stroke: #333333; stroke-width: 2px; }
  #g1 text { fill: #333; font-size: 16px; }
  #g1 .edgeLabel rect { fill: rgba(232, 232, 232, 0.8); opacity: 0.5; }
</style>`;
const SVG = `
<svg id="g1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">
  <g class="root" transform="translate(10, 0)">
    <g class="clusters">
      <g class="cluster" id="g1-S">
        <rect x="0" y="0" width="200" height="100"></rect>
        <g class="cluster-label" transform="translate(80, 0)">
          <text><tspan class="text-outer-tspan"><tspan>Group</tspan><tspan> one</tspan></tspan></text>
        </g>
      </g>
    </g>
    <g class="edgePaths">
      <path class="flowchart-link" style="stroke-dasharray: 1, 0" data-edge="true" data-id="L_A_B_0" data-points="${points([60, 50], [80, 50], [100, 50])}"></path>
      <path class="flowchart-link" style="stroke-dasharray: 3px" data-edge="true" data-id="L_B_C_0" data-points="${points([140, 40], [200, 45], [220, 50])}"></path>
      <path data-edge="true" data-id="L_C_A_0" data-points="${points([220, 50], [60, 50])}"></path>
    </g>
    <g class="edgeLabels">
      <g class="edgeLabel" transform="translate(70, 50)">
        <g class="label" data-id="L_A_B_0">
          <g><rect class="background" x="-10" y="-8" width="20" height="16"></rect>
          <text><tspan class="text-outer-tspan">Yes</tspan></text></g>
        </g>
      </g>
      <g class="edgeLabel"><g class="label" data-id="L_B_C_0"><text><tspan class="text-outer-tspan"></tspan></text></g></g>
    </g>
    <g class="nodes">
      <g class="node default" id="g1-flowchart-A-0" transform="translate(40, 50)">
        <rect class="basic label-container" x="-20" y="-10" width="40" height="20"></rect>
        <g class="label"><text>
          <tspan class="text-outer-tspan">Line 1</tspan><tspan class="text-outer-tspan">Line 2</tspan>
        </text></g>
      </g>
      <g class="node default" id="g1-flowchart-B-1" transform="translate(120, 50)">
        <polygon class="label-container" points="20,0 40,-20 20,-40 0,-20" transform="translate(-20, 20)"></polygon>
        <g class="label"><text><tspan class="text-outer-tspan">B</tspan></text></g>
      </g>
      <g class="node default" id="g1-flowchart-C-2" transform="translate(250, 50)">
        <g class="basic label-container outer-path">
          <path data-bbox="-30 -10 60 20" style="fill: rgb(255, 0, 0); stroke: none"></path>
        </g>
        <g class="label"><text><tspan class="text-outer-tspan">C</tspan></text></g>
      </g>
    </g>
  </g>
</svg>`;

const DATA: FlowchartData = {
  nodes: [
    { id: "S", shape: "rect", isGroup: true },
    { id: "A", shape: "squareRect", isGroup: false, domId: "flowchart-A-0" },
    { id: "B", shape: "diamond", isGroup: false, domId: "flowchart-B-1" },
    { id: "C", shape: "stadium", isGroup: false, domId: "flowchart-C-2" },
    { id: "D", shape: "squareRect", isGroup: false, domId: "flowchart-D-3" },
  ],
  edges: [
    { id: "L_A_B_0", start: "A", end: "B", arrowTypeStart: "none", arrowTypeEnd: "arrow_point", pattern: "normal" },
    { id: "L_B_C_0", start: "B", end: "C", arrowTypeStart: "arrow_circle", arrowTypeEnd: "arrow_cross", pattern: "dotted" },
    { id: "L_C_A_0", start: "C", end: "A", arrowTypeStart: "none", arrowTypeEnd: "none", pattern: "invisible" },
  ],
};

const NODE_STYLE = {
  fill: { color: "#ECECFF", transparency: 0 },
  line: { color: "#9370DB", weight: 0.75, dashStyle: "Solid" },
};

let svg: SVGSVGElement;

beforeAll(() => stubSvgGeometry());

beforeEach(() => {
  document.body.innerHTML = STYLE + SVG;
  svg = document.querySelector("svg")!;
});

describe("extractFlowchart", () => {
  it("returns subgraphs before nodes, in points from the diagram's top-left", () => {
    const { nodes } = extractFlowchart(svg, DATA);

    expect(nodes).toEqual([
      {
        id: "S",
        type: "Rectangle",
        box: { left: 0, top: 0, width: 150, height: 75 },
        fill: { color: "#FFFFDE", transparency: 0 },
        line: { color: "#AAAA33", weight: 0.75, dashStyle: "Solid" },
        label: { text: "Group one", size: 12, color: "#333333" },
        labelPosition: "Top",
      },
      {
        id: "A",
        type: "Rectangle",
        box: { left: 15, top: 30, width: 30, height: 15 },
        ...NODE_STYLE,
        label: { text: "Line 1\nLine 2", size: 12, color: "#333333" },
        labelPosition: "Middle",
      },
      {
        id: "B",
        type: "Diamond",
        box: { left: 75, top: 22.5, width: 30, height: 30 },
        ...NODE_STYLE,
        label: { text: "B", size: 12, color: "#333333" },
        labelPosition: "Middle",
      },
      {
        id: "C",
        type: "FlowChartTerminator",
        box: { left: 165, top: 30, width: 45, height: 15 },
        fill: { color: "#FF0000", transparency: 0 },
        line: null,
        label: { text: "C", size: 12, color: "#333333" },
        labelPosition: "Middle",
      },
    ]);
  });

  it("orders nested subgraphs from the outermost", () => {
    svg.querySelector(".clusters")!.insertAdjacentHTML(
      "beforeend",
      '<g class="cluster" id="g1-T"><rect x="20" y="20" width="50" height="50"></rect></g>',
    );
    const data = { ...DATA, nodes: [{ id: "T", isGroup: true }, ...DATA.nodes] };

    expect(extractFlowchart(svg, data).nodes.slice(0, 2).map((n) => n.id)).toEqual(["S", "T"]);
  });

  it("falls back to a rectangle for shapes Excel has no counterpart for", () => {
    const data = { ...DATA, nodes: [{ ...DATA.nodes[1], shape: "bow-rect" }] };
    expect(extractFlowchart(svg, data).nodes[0].type).toBe("Rectangle");
  });

  it("returns edges with their end points, arrowheads, line style and connector type", () => {
    const { edges } = extractFlowchart(svg, DATA);

    expect(edges).toEqual([
      {
        from: "A",
        to: "B",
        begin: { x: 45, y: 37.5 },
        end: { x: 75, y: 37.5 },
        beginArrow: "None",
        endArrow: "Triangle",
        line: { color: "#333333", weight: 1.5, dashStyle: "Solid" },
        connectorType: "Straight",
      },
      {
        from: "B",
        to: "C",
        begin: { x: 105, y: 30 },
        end: { x: 165, y: 37.5 },
        beginArrow: "Oval",
        endArrow: "Diamond",
        line: { color: "#333333", weight: 1.5, dashStyle: "Dash" },
        connectorType: "Elbow",
      },
    ]);
  });

  it("joins the helper paths of a self-loop into one elbow edge, once per node", () => {
    // Mermaid draws A --> A as A -> helper -> helper -> A.
    svg.querySelector(".edgePaths")!.insertAdjacentHTML(
      "beforeend",
      `<path class="flowchart-link" data-edge="true" data-id="A-cyclic-special-1" data-points="${points([50, 60], [50, 80])}"></path>
      <path class="flowchart-link" data-edge="true" data-id="A-cyclic-special-mid" data-points="${points([50, 80], [70, 80])}"></path>
      <path class="flowchart-link" data-edge="true" data-id="A-cyclic-special-2" data-points="${points([70, 80], [60, 60])}"></path>`,
    );
    const loop = { id: "L_A_A_0", start: "A", end: "A", arrowTypeStart: "none", arrowTypeEnd: "arrow_point", pattern: "normal" };
    const data = { ...DATA, edges: [loop, { ...loop, id: "L_A_A_1" }] };

    expect(extractFlowchart(svg, data).edges).toEqual([
      {
        from: "A",
        to: "A",
        begin: { x: 37.5, y: 45 },
        end: { x: 45, y: 45 },
        beginArrow: "None",
        endArrow: "Triangle",
        line: { color: "#333333", weight: 1.5, dashStyle: "Solid" },
        connectorType: "Elbow",
      },
    ]);
  });

  it("returns non-empty edge labels as text boxes with their background", () => {
    expect(extractFlowchart(svg, DATA).labels).toEqual([
      {
        box: { left: 45, top: 31.5, width: 15, height: 12 },
        fill: { color: "#E8E8E8", transparency: 0.6 },
        label: { text: "Yes", size: 12, color: "#333333" },
      },
    ]);
  });

  it("moves a label wider than the shape's text area into a text box over the shape", () => {
    // 28px * 1.15 slack exceeds half of the 40px diamond; A's 30px fits its 40px rectangle.
    svg.querySelector('[id="g1-flowchart-B-1"] text')!.setAttribute("data-bbox", "-14 -8 28 16");
    svg.querySelector('[id="g1-flowchart-A-0"] text')!.setAttribute("data-bbox", "-15 -8 30 16");
    const { nodes, labels } = extractFlowchart(svg, DATA);

    expect(nodes.find((n) => n.id === "B")!.label.text).toBe("");
    expect(nodes.find((n) => n.id === "A")!.label.text).toBe("Line 1\nLine 2");
    // Covers B (75..105pt): at least as wide as the shape, centered on it.
    expect(labels).toContainEqual({
      box: { left: 75, top: 22.5, width: 30, height: 30 },
      fill: null,
      label: { text: "B", size: 12, color: "#333333" },
    });
  });

  it("finds nodes whose group id is not prefixed with the SVG id", () => {
    svg.querySelector('[id="g1-flowchart-A-0"]')!.id = "flowchart-A-0";
    expect(extractFlowchart(svg, DATA).nodes.map((n) => n.id)).toContain("A");
  });
});

describe("connectionSite", () => {
  // The same cases run against the desktop app's C# port (ConnectionSite.cs).
  it.each(connectionSiteFixture.cases)("$name", (c) => {
    expect(connectionSite(c.box, c.point, c.siteCount, c.type, c.exclude)).toBe(c.expected);
  });
});

describe("scaleModel", () => {
  const model: ShapeModel = {
    nodes: [{
      id: "A", type: "Rectangle", box: { left: 1, top: 2, width: 30, height: 10 },
      fill: { color: "#ECECFF", transparency: 0 },
      line: { color: "#9370DB", weight: 0.75, dashStyle: "Solid" },
      label: { text: "A", size: 12, color: "#333333" }, labelPosition: "Middle",
    }, {
      id: "B", type: "Rectangle", box: { left: 0, top: 0, width: 3, height: 3 },
      fill: null, line: null, label: { text: "", size: 12, color: "#333333" }, labelPosition: "Top",
    }],
    edges: [{
      from: "A", to: "B", begin: { x: 10, y: 20 }, end: { x: 1, y: 1 },
      beginArrow: "None", endArrow: "Triangle",
      line: { color: "#333333", weight: 1.5, dashStyle: "Dash" }, connectorType: "Elbow",
    }],
    labels: [{ box: { left: 4, top: 5, width: 6, height: 7 }, fill: null, label: { text: "yes", size: 9, color: "#000" } }],
  };

  it("scales positions, sizes, font sizes and line weights", () => {
    const scaled = scaleModel(model, 1.5);

    expect(scaled.nodes[0]).toMatchObject({
      box: { left: 1.5, top: 3, width: 45, height: 15 },
      line: { weight: 1.13 },
      label: { size: 18 },
      fill: { color: "#ECECFF" },
    });
    expect(scaled.nodes[1].line).toBeNull();
    expect(scaled.edges[0]).toMatchObject({
      begin: { x: 15, y: 30 }, end: { x: 1.5, y: 1.5 }, line: { weight: 2.25, dashStyle: "Dash" },
    });
    expect(scaled.labels[0]).toMatchObject({ box: { left: 6, top: 7.5, width: 9, height: 10.5 }, label: { size: 13.5 } });
  });

  it("does not change the original model", () => {
    scaleModel(model, 2);
    expect(model.nodes[0].box.width).toBe(30);
  });

  it("returns the model as is at scale 1", () => {
    expect(scaleModel(model, 1)).toBe(model);
  });
});