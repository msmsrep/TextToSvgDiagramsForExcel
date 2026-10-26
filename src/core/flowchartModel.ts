import type { FlowchartData } from "./render";
import { apply, isDashed, parseColor, type Point, rootTransform } from "./svgUtil";
import { PX_TO_PT } from "./util";

/** Excel geometric shape types used for flowchart nodes (Excel.GeometricShapeType). */
export type GeometricShapeName =
  | "Rectangle"
  | "RoundRectangle"
  | "FlowChartTerminator"
  | "FlowChartPredefinedProcess"
  | "Can"
  | "Ellipse"
  | "Diamond"
  | "Hexagon"
  | "Parallelogram"
  | "Trapezoid"
  | "FlowChartManualOperation"
  | "FlowChartDocument";
/** Excel arrowhead styles used for edges (Excel.ArrowheadStyle). */
export type ArrowheadName = "None" | "Triangle" | "Oval" | "Diamond";

export type Box = { left: number; top: number; width: number; height: number };
/** Solid fill; transparency is 0 (opaque) to 1. Null means no fill. */
export type Fill = { color: string; transparency: number } | null;
/** Outline; null means no line. */
export type Line = { color: string; weight: number; dashStyle: "Solid" | "Dash" } | null;
export type Label = { text: string; size: number; color: string };

export type ShapeNode = {
  id: string;
  type: GeometricShapeName;
  box: Box;
  fill: Fill;
  line: Line;
  label: Label;
  /** Subgraph titles sit at the top; node labels are centered. */
  labelPosition: "Middle" | "Top";
};
export type ShapeEdge = {
  from: string;
  to: string;
  begin: Point;
  end: Point;
  beginArrow: ArrowheadName;
  endArrow: ArrowheadName;
  line: NonNullable<Line>;
  connectorType: "Straight" | "Elbow";
};
export type ShapeTextBox = { box: Box; fill: Fill; label: Label };
/** A flowchart as Excel shapes. Coordinates are in points from the diagram's top-left. */
export type ShapeModel = {
  /** Subgraphs first (outermost first) so they end up behind the nodes. */
  nodes: ShapeNode[];
  edges: ShapeEdge[];
  labels: ShapeTextBox[];
};

const SHAPE_TYPES: Record<string, GeometricShapeName> = {
  squareRect: "Rectangle",
  rect: "Rectangle",
  roundedRect: "RoundRectangle",
  rounded: "RoundRectangle",
  stadium: "FlowChartTerminator",
  subroutine: "FlowChartPredefinedProcess",
  "fr-rect": "FlowChartPredefinedProcess",
  cylinder: "Can",
  cyl: "Can",
  circle: "Ellipse",
  doublecircle: "Ellipse",
  "dbl-circ": "Ellipse",
  ellipse: "Ellipse",
  diamond: "Diamond",
  diam: "Diamond",
  hexagon: "Hexagon",
  hex: "Hexagon",
  lean_right: "Parallelogram",
  lean_left: "Parallelogram",
  "lean-r": "Parallelogram",
  "lean-l": "Parallelogram",
  trapezoid: "Trapezoid",
  "trap-b": "Trapezoid",
  inv_trapezoid: "FlowChartManualOperation",
  "trap-t": "FlowChartManualOperation",
  doc: "FlowChartDocument",
};

const ARROWHEADS: Record<string, ArrowheadName> = {
  arrow_point: "Triangle",
  arrow_circle: "Oval",
  // Excel has no cross arrowhead.
  arrow_cross: "Diamond",
};

const SHAPE_SELECTOR = "path, rect, circle, ellipse, polygon";

/**
 * Connection site directions (degrees counterclockwise from the top, in
 * box-relative units) measured in Excel for shapes whose sites are not spaced
 * evenly from the top. Other shapes start at the top and go counterclockwise.
 */
const SITE_ANGLES: Partial<Record<GeometricShapeName, number[]>> = {
  Can: [0, 0, 90, 180, 270],
  Hexagon: [270, 215, 145, 90, 35, 325],
  Parallelogram: [0, 351, 270, 171, 180, 90],
};

/**
 * Width of the area Excel lays text out in, for a shape of the given size
 * (from the preset shapes' text rectangles; text wraps beyond it).
 */
const TEXT_WIDTH: Partial<Record<GeometricShapeName, (w: number, h: number) => number>> = {
  Rectangle: (w) => w,
  Can: (w) => w,
  FlowChartDocument: (w) => w,
  RoundRectangle: (w, h) => w - 0.1 * Math.min(w, h),
  FlowChartTerminator: (w) => w * 0.9,
  FlowChartPredefinedProcess: (w) => w * 0.75,
  Ellipse: (w) => w * 0.7,
  Diamond: (w) => w * 0.5,
  Hexagon: (w, h) => w - 0.5 * Math.min(w, h),
  Parallelogram: (w, h) => w - 0.5 * Math.min(w, h),
  Trapezoid: (w, h) => w - 0.5 * Math.min(w, h),
  FlowChartManualOperation: (w, h) => w - 0.5 * Math.min(w, h),
};
// Excel's fonts run wider than the browser's, so labels need some slack.
const FONT_SLACK = 1.15;

/**
 * Returns the connection site of a shape of the given type nearest to
 * `point`, other than `exclude` (the other end of a self-loop).
 */
export function connectionSite(
  box: Box,
  point: Point,
  siteCount: number,
  type?: string,
  exclude?: number,
): number {
  const dx = (point.x - (box.left + box.width / 2)) / (box.width / 2 || 1);
  const dy = (point.y - (box.top + box.height / 2)) / (box.height / 2 || 1);
  const angle = (Math.atan2(-dx, -dy) * 180) / Math.PI;
  const measured = SITE_ANGLES[type as GeometricShapeName];
  const angles =
    measured?.length === siteCount
      ? measured
      : Array.from({ length: siteCount }, (_, i) => (360 / siteCount) * i);
  const distance = (a: number) => {
    const d = Math.abs(a - angle) % 360;
    return Math.min(d, 360 - d);
  };
  let best = -1;
  angles.forEach((a, i) => {
    if (i !== exclude && (best < 0 || distance(a) < distance(angles[best]))) best = i;
  });
  return Math.max(best, 0);
}

/**
 * Builds an Excel shape model from a rendered flowchart: geometry and styles
 * come from the SVG in the document, shape and arrow types from `data`.
 */
export function extractFlowchart(svgEl: SVGSVGElement, data: FlowchartData): ShapeModel {
  const toRoot = rootTransform(svgEl);

  /** Bounding box of an element in root SVG coordinates (px). */
  function boxOf(el: Element): Box {
    const b = (el as SVGGraphicsElement).getBBox();
    const m = toRoot(el);
    const corners = [
      apply(m, { x: b.x, y: b.y }),
      apply(m, { x: b.x + b.width, y: b.y }),
      apply(m, { x: b.x, y: b.y + b.height }),
      apply(m, { x: b.x + b.width, y: b.y + b.height }),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  const byId = new Map<string, Element>();
  svgEl.querySelectorAll("g.node, g.cluster").forEach((el) => byId.set(el.id, el));
  const findGroup = (id: string) => byId.get(`${svgEl.id}-${id}`) ?? byId.get(id);

  const nodes: ShapeNode[] = [];
  const clusters: ShapeNode[] = [];
  const labels: ShapeTextBox[] = [];
  for (const node of data.nodes) {
    if (node.isGroup) {
      const el = findGroup(node.id);
      const rect = el?.querySelector(":scope > rect");
      if (!el || !rect) continue;
      clusters.push({
        id: node.id,
        type: "Rectangle",
        box: boxOf(rect),
        ...shapeStyle(rect),
        label: labelOf(el.querySelector(".cluster-label")),
        labelPosition: "Top",
      });
      continue;
    }
    const el = findGroup(node.domId ?? node.id);
    const container = el?.querySelector(".label-container");
    if (!el || !container) continue;
    const styled = container.matches(SHAPE_SELECTOR)
      ? container
      : container.querySelector(SHAPE_SELECTOR) ?? container;
    const type = SHAPE_TYPES[node.shape ?? ""] ?? "Rectangle";
    const box = boxOf(container);
    const labelEl = el.querySelector(".label");
    const text = labelEl?.querySelector("text");
    let label = labelOf(labelEl);
    // Excel wraps text that is wider than the shape's text area (half the
    // width for a diamond), so such labels go in a text box over the shape.
    const textWidth = text ? boxOf(text).width * FONT_SLACK : 0;
    const area = (TEXT_WIDTH[type] ?? ((w: number) => w * 0.5))(box.width, box.height);
    if (label.text && textWidth > area) {
      const width = Math.max(box.width, textWidth * 1.2);
      labels.push({
        box: { left: box.left + (box.width - width) / 2, top: box.top, width, height: box.height },
        fill: null,
        label,
      });
      label = { ...label, text: "" };
    }
    nodes.push({ id: node.id, type, box, ...shapeStyle(styled), label, labelPosition: "Middle" });
  }
  const area = (n: ShapeNode) => n.box.width * n.box.height;
  clusters.sort((p, q) => area(q) - area(p));

  const paths = new Map<string, Element>();
  svgEl.querySelectorAll("path[data-edge]").forEach((el) => {
    paths.set(el.getAttribute("data-id") ?? "", el);
  });
  /** The path's points in root coordinates, or null when it is missing. */
  const pointsOf = (id: string): Point[] | null => {
    const path = paths.get(id);
    const encoded = path?.getAttribute("data-points");
    if (!path || !encoded) return null;
    const points = (JSON.parse(atob(encoded)) as Point[]).map((p) => apply(toRoot(path), p));
    return points.length >= 2 ? points : null;
  };
  const edges: ShapeEdge[] = [];
  const loops = new Set<string>();
  for (const edge of data.edges) {
    if (edge.pattern === "invisible") continue;
    // Mermaid draws a self-loop as paths "<id>-cyclic-special-1", "-mid" and
    // "-2" through two helper nodes, and only one loop per node.
    const selfLoop = edge.start === edge.end;
    if (selfLoop && loops.has(edge.start)) continue;
    const firstId = selfLoop ? `${edge.start}-cyclic-special-1` : edge.id;
    const first = pointsOf(firstId);
    const last = selfLoop ? pointsOf(`${edge.start}-cyclic-special-2`) : first;
    if (!first || !last) continue;
    if (selfLoop) loops.add(edge.start);
    const path = paths.get(firstId)!;
    const begin = first[0];
    const end = last[last.length - 1];
    const aligned = !selfLoop && (Math.abs(begin.x - end.x) < 1 || Math.abs(begin.y - end.y) < 1);
    edges.push({
      from: edge.start,
      to: edge.end,
      begin,
      end,
      beginArrow: ARROWHEADS[edge.arrowTypeStart ?? ""] ?? "None",
      endArrow: ARROWHEADS[edge.arrowTypeEnd ?? ""] ?? "None",
      line: lineOf(getComputedStyle(path)) ?? { color: "#333333", weight: 1, dashStyle: "Solid" },
      connectorType: aligned ? "Straight" : "Elbow",
    });
  }

  svgEl.querySelectorAll(".edgeLabel .label").forEach((el) => {
    const label = labelOf(el);
    if (!label.text) return;
    const background = el.querySelector("rect.background");
    labels.push({
      box: boxOf(background ?? el),
      fill: background ? fillOf(getComputedStyle(background)) : null,
      label,
    });
  });

  return normalize({ nodes: [...clusters, ...nodes], edges, labels });
}

function shapeStyle(el: Element): { fill: Fill; line: Line } {
  const style = getComputedStyle(el);
  return { fill: fillOf(style), line: lineOf(style) };
}

function fillOf(style: CSSStyleDeclaration): Fill {
  const color = parseColor(style.getPropertyValue("fill"));
  if (!color) return null;
  const opacity =
    num(style.getPropertyValue("fill-opacity"), 1) *
    num(style.getPropertyValue("opacity"), 1) *
    color.alpha;
  return { color: color.color, transparency: round(1 - opacity) };
}

function lineOf(style: CSSStyleDeclaration): Line {
  const color = parseColor(style.getPropertyValue("stroke"));
  const width = num(style.getPropertyValue("stroke-width"), 1);
  if (!color || width <= 0) return null;
  return {
    color: color.color,
    weight: round(width * PX_TO_PT),
    dashStyle: isDashed(style.getPropertyValue("stroke-dasharray")) ? "Dash" : "Solid",
  };
}

/** Label text (one line per mermaid row) and its font. */
function labelOf(el: Element | null): Label {
  const text = el?.querySelector("text");
  if (!text) {
    return { text: "", size: 12, color: "#333333" };
  }
  const rows = Array.from(text.querySelectorAll(".text-outer-tspan"), (r) => r.textContent ?? "");
  const style = getComputedStyle(text);
  return {
    text: (rows.length ? rows : [text.textContent ?? ""]).join("\n").trim(),
    size: round(num(style.getPropertyValue("font-size"), 16) * PX_TO_PT),
    color: parseColor(style.getPropertyValue("fill"))?.color ?? "#333333",
  };
}

/** Moves the diagram's top-left to 0,0 and converts px to pt. */
function normalize(model: ShapeModel): ShapeModel {
  const boxes = [...model.nodes.map((n) => n.box), ...model.labels.map((l) => l.box)];
  const points = [...model.edges.map((e) => e.begin), ...model.edges.map((e) => e.end)];
  const minX = Math.min(...boxes.map((b) => b.left), ...points.map((p) => p.x));
  const minY = Math.min(...boxes.map((b) => b.top), ...points.map((p) => p.y));
  const pt = (v: number, min = 0) => round((v - min) * PX_TO_PT);
  const box = (b: Box): Box => ({
    left: pt(b.left, minX),
    top: pt(b.top, minY),
    width: pt(b.width),
    height: pt(b.height),
  });
  const point = (p: Point): Point => ({ x: pt(p.x, minX), y: pt(p.y, minY) });

  return {
    nodes: model.nodes.map((n) => ({ ...n, box: box(n.box) })),
    edges: model.edges.map((e) => ({ ...e, begin: point(e.begin), end: point(e.end) })),
    labels: model.labels.map((l) => ({ ...l, box: box(l.box) })),
  };
}

function num(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Scales a shape model: positions, sizes, font sizes and line weights.
 * Excel still rounds line weights to whole points when inserting.
 */
export function scaleModel(model: ShapeModel, scale: number): ShapeModel {
  if (scale === 1) {
    return model;
  }
  const s = (v: number) => round(v * scale);
  const box = (b: Box): Box => ({ left: s(b.left), top: s(b.top), width: s(b.width), height: s(b.height) });
  const point = (p: Point): Point => ({ x: s(p.x), y: s(p.y) });
  const label = (l: Label): Label => ({ ...l, size: s(l.size) });
  const line = <T extends Line>(l: T): T => (l ? { ...l, weight: s(l.weight) } : l);
  return {
    nodes: model.nodes.map((n) => ({ ...n, box: box(n.box), label: label(n.label), line: line(n.line) })),
    edges: model.edges.map((e) => ({ ...e, begin: point(e.begin), end: point(e.end), line: line(e.line) })),
    labels: model.labels.map((t) => ({ ...t, box: box(t.box), label: label(t.label) })),
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
