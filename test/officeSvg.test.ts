import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toOfficeSvg } from "../src/core/officeSvg";
import { stubSvgGeometry } from "./fakes/svgGeometry";

// Mermaid puts the <style> inside the <svg>, but jsdom only applies it outside.
const STYLE = `
<style>
  #s .node rect { fill: #ececff; stroke: #9370db; stroke-width: 1px; }
  #s text { fill: #333333; font-size: 16px; font-family: "trebuchet ms", verdana; }
  #s .marker { fill: #333333; stroke: #333333; }
  #s .flowchart-link { fill: none; stroke: #333333; stroke-width: 2px; }
  #s .faded { opacity: 0.5; }
</style>`;

// The viewBox starts at (-8, -8), so output coordinates are shifted by +8.
// Root user coordinates: g.root adds (10, 20) and the node another (5, 5).
const SVG = `
<svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 100 50" width="100%" style="max-width: 100px">
  <style>#s rect { fill: red; }</style>
  <defs>
    <marker id="s_pointEnd" class="marker" viewBox="0 0 10 10" refX="5" refY="5"
      markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
      <path class="marker" d="M 0 0 L 10 5 L 0 10 z"></path>
    </marker>
  </defs>
  <g class="root" transform="translate(10, 20)">
    <g class="node" transform="translate(5, 5)">
      <rect class="basic label-container" x="-4" y="-2" width="8" height="4"></rect>
      <g class="label">
        <rect></rect>
        <text y="-10.1" text-anchor="middle">
          <tspan class="text-outer-tspan" x="0" y="-0.1em" dy="1.1em" data-start="-3 4">Hi</tspan><tspan
            class="text-outer-tspan" x="0" y="1em" dy="1.1em" data-start="-6 20"><tspan
            style="font-weight: bold">Bold</tspan><tspan> text</tspan></tspan><tspan
            class="text-outer-tspan" data-start="0 0"></tspan>
        </text>
      </g>
    </g>
    <path class="flowchart-link" d="M 0 0 L 30 0" marker-end="url(#s_pointEnd)"></path>
    <path class="flowchart-link" style="stroke-dasharray: 1, 0" d="M 0 10 L 30 10"></path>
    <path class="flowchart-link" style="stroke-dasharray: 3px" d="M 0 20 L 30 20"></path>
    <g class="faded"><rect x="0" y="0" width="4" height="4" style="fill: rgba(232, 232, 232, 0.8)"></rect></g>
    <rect x="0" y="0" width="4" height="4" style="display: none; fill: red"></rect>
    <rect x="0" y="0" width="4" height="4" style="fill: none; stroke: none"></rect>
  </g>
</svg>`;

let out: SVGSVGElement;
/** Children of the single group that holds the drawing. */
let items: Element[];

/** Element attributes as a plain object, for readable comparisons. */
const attrs = (el: Element) => Object.fromEntries(Array.from(el.attributes, (a) => [a.name, a.value]));

beforeAll(() => stubSvgGeometry());

beforeEach(() => {
  document.body.innerHTML = STYLE + SVG;
  const result = toOfficeSvg(document.querySelector("svg")!);
  out = new DOMParser().parseFromString(result, "image/svg+xml").documentElement as unknown as SVGSVGElement;
  items = Array.from(out.firstElementChild?.children ?? []);
});

describe("toOfficeSvg", () => {
  it("sizes the root to the viewBox with its origin moved to 0,0", () => {
    expect(attrs(out)).toEqual({
      xmlns: "http://www.w3.org/2000/svg",
      width: "100",
      height: "50",
      viewBox: "0 0 100 50",
    });
  });

  it("flattens the drawing into one plain group in paint order", () => {
    expect(Array.from(out.children, (el) => el.tagName)).toEqual(["g"]);
    expect(out.firstElementChild!.attributes).toHaveLength(0);
    expect(items.map((el) => el.tagName)).toEqual([
      "rect", "text", "text", "path", "path", "path", "path", "rect",
    ]);
    expect(out.querySelector("style, defs, marker, g g, [class], [style]")).toBeNull();
  });

  it("inlines computed paint and replaces nested transforms with one translation", () => {
    expect(attrs(items[0])).toEqual({
      x: "-4",
      y: "-2",
      width: "8",
      height: "4",
      fill: "#ECECFF",
      stroke: "#9370DB",
      "stroke-width": "1",
      transform: "translate(23 33)",
    });
  });

  it("places each text line at its absolute baseline start without em offsets or anchors", () => {
    const [hi, bold] = [items[1], items[2]];
    expect(attrs(hi)).toEqual({
      x: "20",
      y: "37",
      "font-family": "trebuchet ms, verdana",
      "font-size": "16",
      fill: "#333333",
    });
    expect(hi.textContent).toBe("Hi");
    expect(attrs(bold)).toMatchObject({ x: "17", y: "53" });
    expect(Array.from(bold.children, (t) => [t.getAttribute("font-weight"), t.textContent])).toEqual([
      ["bold", "Bold"],
      [null, " text"],
    ]);
  });

  it("draws markers as shapes at the path end, scaled and centered on the reference point", () => {
    const [link, arrow] = [items[3], items[4]];
    expect(attrs(link)).toEqual({
      d: "M 0 0 L 30 0",
      fill: "none",
      stroke: "#333333",
      "stroke-width": "2",
      transform: "translate(18 28)",
    });
    expect(attrs(arrow)).toEqual({
      d: "M 0 0 L 10 5 L 0 10 z",
      fill: "#333333",
      stroke: "#333333",
      "stroke-width": "1",
      transform: "matrix(0.8 0 0 0.8 44 24)",
    });
  });

  it("drops gapless dash arrays and keeps real ones without units", () => {
    expect(items[5].hasAttribute("stroke-dasharray")).toBe(false);
    expect(items[6].getAttribute("stroke-dasharray")).toBe("3");
  });

  it("folds color alpha and ancestor opacity into fill-opacity", () => {
    expect(attrs(items[7])).toMatchObject({ fill: "#E8E8E8", "fill-opacity": "0.4", stroke: "none" });
  });

  it("takes the text color from the runs, as sequence diagrams color the tspan", () => {
    document.body.innerHTML = `${STYLE}
      <style>#s text.actor { fill: #ececff; } #s text.actor > tspan { fill: #000000; }</style>
      <svg id="s" viewBox="0 0 100 50">
        <text class="actor" x="20" y="10" data-start="10 15"><tspan>John</tspan><tspan style="fill: #ff0000"> Doe</tspan></text>
      </svg>`;
    const result = toOfficeSvg(document.querySelector("svg")!);
    const text = new DOMParser().parseFromString(result, "image/svg+xml").querySelector("text")!;

    expect(text.getAttribute("fill")).toBe("#000000");
    expect(Array.from(text.children, (t) => [t.getAttribute("fill"), t.textContent])).toEqual([
      [null, "John"],
      ["#FF0000", " Doe"],
    ]);
  });

  it("moves text on a central baseline to its alphabetic baseline", () => {
    // The character cell's top is at 9; a 12px ascent puts the alphabetic baseline at 21.
    document.body.innerHTML = `${STYLE}
      <svg id="s" viewBox="0 0 100 50">
        <text style="dominant-baseline: central" data-start="10 15" data-extent="10 9 8 16">John</text>
      </svg>`;
    const result = toOfficeSvg(document.querySelector("svg")!);
    const text = new DOMParser().parseFromString(result, "image/svg+xml").querySelector("text")!;

    expect(attrs(text)).toMatchObject({ x: "10", y: "21" });
    // The measuring element is removed.
    expect(document.querySelectorAll("text")).toHaveLength(1);
  });

  it("draws markers on lines", () => {
    // Sequence diagram messages are <line> elements with a marker.
    document.body.innerHTML = `${STYLE}
      <svg id="s" viewBox="0 0 100 50">
        <defs>
          <marker id="s-arrowhead" refX="7.9" refY="5" markerUnits="userSpaceOnUse"
            markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path class="marker" d="M -1 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
        <line class="flowchart-link" x1="0" y1="30" x2="40" y2="30" marker-end="url(#s-arrowhead)"></line>
      </svg>`;
    const result = toOfficeSvg(document.querySelector("svg")!);
    const drawn = Array.from(new DOMParser().parseFromString(result, "image/svg+xml").querySelector("g")!.children);

    expect(drawn.map((el) => el.tagName)).toEqual(["line", "path"]);
    expect(attrs(drawn[1])).toMatchObject({
      d: "M -1 0 L 10 5 L 0 10 z",
      fill: "#333333",
      transform: "translate(32.1 25)",
    });
  });

  it("falls back to the bounding box when there is no viewBox", () => {
    document.body.innerHTML = STYLE + '<svg id="s"><g class="node"><rect x="2" y="3" width="10" height="5"></rect></g></svg>';
    const result = toOfficeSvg(document.querySelector("svg")!);
    expect(result).toContain('viewBox="0 0 10 5"');
    expect(result).toContain('transform="translate(-2 -3)"');
  });
});
