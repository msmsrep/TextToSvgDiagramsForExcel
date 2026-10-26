import {
  apply,
  isDashed,
  type Matrix,
  multiply,
  parseColor,
  rootTransform,
  rotate,
  scale,
  translate,
} from "./svgUtil";

const SVG_NS = "http://www.w3.org/2000/svg";
// Containers whose content is not drawn directly (markers are drawn per edge).
const SKIPPED = new Set(["defs", "marker", "style", "title", "desc", "clippath", "mask", "symbol", "foreignobject"]);
// Geometry attributes copied as is for each drawable element.
const GEOMETRY: Record<string, string[]> = {
  rect: ["x", "y", "width", "height", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  polygon: ["points"],
  polyline: ["points"],
  path: ["d"],
  line: ["x1", "y1", "x2", "y2"],
};
// Elements that can carry markers (sequence diagram messages are lines).
const MARKED = new Set(["path", "line", "polyline"]);

/**
 * Rewrites a rendered SVG into a flat form that Excel's "Convert to Shape"
 * handles well: one group of shapes with no CSS, no nested transforms, no
 * markers, and text placed by absolute baseline positions instead of em
 * offsets and text-anchor. Reads computed styles and geometry, so `svgEl`
 * must be in the document.
 */
export function toOfficeSvg(svgEl: SVGSVGElement): string {
  const vb = (svgEl.getAttribute("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const [x, y, width, height] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : boxValues(svgEl.getBBox());
  const origin = { x, y };

  const out = document.createElementNS(SVG_NS, "svg");
  out.setAttribute("width", fmt(width));
  out.setAttribute("height", fmt(height));
  out.setAttribute("viewBox", `0 0 ${fmt(width)} ${fmt(height)}`);

  // A single untransformed group, so "Convert to Shape" yields one group
  // instead of dozens of loose shapes.
  const group = document.createElementNS(SVG_NS, "g");
  const toRoot = rootTransform(svgEl);
  // Root user coordinates with the viewBox origin moved to 0,0.
  const toOut = (el: Element) => multiply(translate(-origin.x, -origin.y), toRoot(el));
  const markers = new Map<string, SVGMarkerElement>();
  svgEl.querySelectorAll("marker").forEach((m) => markers.set(m.id, m as SVGMarkerElement));

  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();
      if (SKIPPED.has(tag) || !isVisible(el)) continue;
      if (tag === "text") {
        group.append(...textElements(el as SVGTextElement, toOut(el)));
      } else if (GEOMETRY[tag]) {
        const shape = shapeElement(el, tag, toOut(el));
        if (shape) group.appendChild(shape);
        if (MARKED.has(tag)) {
          group.append(...markerElements(el as SVGGeometryElement, toOut(el), markers));
        }
      } else {
        walk(el);
      }
    }
  };
  walk(svgEl);
  out.appendChild(group);

  return new XMLSerializer().serializeToString(out);
}

function boxValues(box: DOMRect): number[] {
  return [box.x, box.y, box.width, box.height];
}

function isVisible(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.getPropertyValue("display") !== "none" && style.getPropertyValue("visibility") !== "hidden";
}

/** Copies a shape's geometry with its own transform and computed paint. */
function shapeElement(el: Element, tag: string, m: Matrix): Element | null {
  if (tag === "rect" && !(Number(el.getAttribute("width")) > 0 && Number(el.getAttribute("height")) > 0)) {
    return null;
  }
  const paint = paintAttributes(el);
  if (!paint) return null;
  const shape = document.createElementNS(SVG_NS, tag);
  for (const name of GEOMETRY[tag]) {
    const value = el.getAttribute(name);
    if (value !== null) shape.setAttribute(name, value);
  }
  setAttributes(shape, paint);
  setTransform(shape, m);
  return shape;
}

/** Fill and stroke from the computed style; null when nothing is painted. */
function paintAttributes(el: Element): Record<string, string> | null {
  const style = getComputedStyle(el);
  const fill = parseColor(style.getPropertyValue("fill"));
  const stroke = parseColor(style.getPropertyValue("stroke"));
  const strokeWidth = parseFloat(style.getPropertyValue("stroke-width"));
  const hasStroke = !!stroke && !(strokeWidth <= 0);
  if (!fill && !hasStroke) return null;

  const opacity = inheritedOpacity(el);
  const attrs: Record<string, string> = { fill: fill?.color ?? "none" };
  const fillOpacity = (fill?.alpha ?? 1) * num(style.getPropertyValue("fill-opacity"), 1) * opacity;
  if (fill && fillOpacity < 1) attrs["fill-opacity"] = fmt(fillOpacity);
  if (hasStroke) {
    attrs.stroke = stroke!.color;
    attrs["stroke-width"] = fmt(Number.isFinite(strokeWidth) ? strokeWidth : 1);
    const strokeOpacity = stroke!.alpha * num(style.getPropertyValue("stroke-opacity"), 1) * opacity;
    if (strokeOpacity < 1) attrs["stroke-opacity"] = fmt(strokeOpacity);
    const dasharray = style.getPropertyValue("stroke-dasharray");
    if (isDashed(dasharray)) {
      attrs["stroke-dasharray"] = dasharray.split(/[\s,]+/).map(parseFloat).map(fmt).join(" ");
    }
  } else {
    attrs.stroke = "none";
  }
  return attrs;
}

/** Product of the opacity of the element and its ancestors (opacity is not inherited). */
function inheritedOpacity(el: Element): number {
  let opacity = 1;
  for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
    opacity *= num(getComputedStyle(e).getPropertyValue("opacity"), 1);
  }
  return opacity;
}

/**
 * One <text> per line, positioned at the line's first character baseline
 * (mermaid lines are tspans offset with em units and centered by text-anchor).
 */
function textElements(text: SVGTextElement, m: Matrix): Element[] {
  const rows = text.querySelectorAll<SVGTSpanElement>(".text-outer-tspan");
  const lines: SVGTextContentElement[] = rows.length ? Array.from(rows) : [text];
  const style = getComputedStyle(text);
  const result: Element[] = [];

  for (const line of lines) {
    if (!line.textContent?.trim() || line.getNumberOfChars() === 0) continue;
    const runs = line.children.length ? Array.from(line.children) : [line];
    // The color comes from the runs: sequence diagrams color the <tspan> and
    // leave the box color on the <text>.
    const fill = paintOf(runs.find((r) => r.textContent?.trim()) ?? line);
    const start = line.getStartPositionOfChar(0);
    const p = apply(m, { x: start.x, y: baselineY(text, line, start.y) });
    const el = document.createElementNS(SVG_NS, "text");
    setAttributes(el, {
      x: fmt(p.x),
      y: fmt(p.y),
      "font-family": style.getPropertyValue("font-family").replace(/["']/g, ""),
      "font-size": fmt(num(style.getPropertyValue("font-size"), 16) * Math.hypot(m.a, m.b)),
      ...fill,
    });
    appendRuns(el, line, fill);
    result.push(el);
  }
  return result;
}

const ALPHABETIC = new Set(["", "auto", "alphabetic", "baseline"]);

/**
 * The line's alphabetic baseline. The start position is on the line's
 * alignment baseline, which sequence diagrams set to "central"; the output has
 * no baseline settings, so the text would move up by half its height.
 */
function baselineY(text: SVGTextElement, line: SVGTextContentElement, startY: number): number {
  const shifted = [text, line].some((el) => {
    const style = getComputedStyle(el);
    return ["dominant-baseline", "alignment-baseline"].some((name) => !ALPHABETIC.has(style.getPropertyValue(name)));
  });
  if (!shifted) return startY;
  // The ascent: how far the character cell's top is above an alphabetic baseline.
  const font = getComputedStyle(line);
  const probe = document.createElementNS(SVG_NS, "text");
  probe.setAttribute(
    "style",
    ["font-family", "font-size", "font-weight", "font-style"]
      .map((name) => `${name}: ${font.getPropertyValue(name)}; `)
      .join("") + "dominant-baseline: alphabetic; alignment-baseline: alphabetic",
  );
  probe.textContent = line.textContent;
  text.parentNode!.insertBefore(probe, text);
  try {
    return line.getExtentOfChar(0).y - probe.getExtentOfChar(0).y;
  } finally {
    probe.remove();
  }
}

/** Text fill (and opacity) attributes from the element's computed style. */
function paintOf(el: Element): Record<string, string> {
  const fill = parseColor(getComputedStyle(el).getPropertyValue("fill"));
  const attrs: Record<string, string> = { fill: fill?.color ?? "#000000" };
  if (fill && fill.alpha < 1) attrs["fill-opacity"] = fmt(fill.alpha);
  return attrs;
}

/**
 * Copies the line's text, keeping bold/italic runs and runs colored unlike
 * the line as unpositioned tspans.
 */
function appendRuns(target: Element, line: Element, lineFill: Record<string, string>) {
  const runs = Array.from(line.children);
  if (runs.length === 0) {
    target.textContent = line.textContent;
    return;
  }
  for (const run of runs) {
    const style = getComputedStyle(run);
    const tspan = document.createElementNS(SVG_NS, "tspan");
    const weight = style.getPropertyValue("font-weight");
    const fontStyle = style.getPropertyValue("font-style");
    if (weight === "bold" || Number(weight) >= 600) tspan.setAttribute("font-weight", "bold");
    if (fontStyle === "italic") tspan.setAttribute("font-style", "italic");
    const fill = paintOf(run);
    if (fill.fill !== lineFill.fill || fill["fill-opacity"] !== lineFill["fill-opacity"]) {
      setAttributes(tspan, fill);
    }
    tspan.textContent = run.textContent;
    target.appendChild(tspan);
  }
}

/** Draws the path's start/end markers as plain shapes. */
function markerElements(path: SVGGeometryElement, m: Matrix, markers: Map<string, SVGMarkerElement>): Element[] {
  const result: Element[] = [];
  const length = path.getTotalLength();
  for (const end of ["start", "end"] as const) {
    const id = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(path.getAttribute(`marker-${end}`) ?? "")?.[1];
    const marker = id ? markers.get(id) : undefined;
    if (!marker || !(length > 0)) continue;

    const [at, toward] =
      end === "end"
        ? [path.getPointAtLength(length), path.getPointAtLength(Math.max(0, length - 1))]
        : [path.getPointAtLength(0), path.getPointAtLength(Math.min(length, 1))];
    // Direction of travel along the path at this end.
    let angle = end === "end"
      ? Math.atan2(at.y - toward.y, at.x - toward.x)
      : Math.atan2(toward.y - at.y, toward.x - at.x);
    const orient = marker.getAttribute("orient") ?? "0";
    if (orient === "auto-start-reverse" && end === "start") {
      angle += Math.PI;
    } else if (orient !== "auto" && orient !== "auto-start-reverse") {
      angle = (parseFloat(orient) || 0) * (Math.PI / 180);
    }

    const markerMatrix = multiply(m, multiply(translate(at.x, at.y), multiply(rotate(angle), markerContentTransform(path, marker))));
    for (const child of Array.from(marker.querySelectorAll("*"))) {
      const tag = child.tagName.toLowerCase();
      if (!GEOMETRY[tag]) continue;
      const shape = shapeElement(child, tag, multiply(markerMatrix, ownTransform(child)));
      if (shape) result.push(shape);
    }
  }
  return result;
}

/** Marker viewBox to path coordinates, with the marker's reference point at the origin. */
function markerContentTransform(path: Element, marker: SVGMarkerElement): Matrix {
  const width = num(marker.getAttribute("markerWidth") ?? "", 3);
  const height = num(marker.getAttribute("markerHeight") ?? "", 3);
  const box = (marker.getAttribute("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const [vw, vh] = box.length === 4 ? [box[2], box[3]] : [width, height];
  const units =
    marker.getAttribute("markerUnits") === "userSpaceOnUse"
      ? 1
      : num(getComputedStyle(path).getPropertyValue("stroke-width"), 1);
  const sx = (width / (vw || width)) * units;
  const sy = (height / (vh || height)) * units;
  const refX = num(marker.getAttribute("refX") ?? "", 0);
  const refY = num(marker.getAttribute("refY") ?? "", 0);
  // A viewBox point v lands at (v - ref) * scale, so the ref point is the origin.
  return multiply(scale(sx, sy), translate(-refX, -refY));
}

/** The element's own transform attribute (marker content is outside the CTM chain). */
function ownTransform(el: Element): Matrix {
  const list = (el as SVGGraphicsElement).transform?.baseVal;
  const consolidated = list && list.numberOfItems > 0 ? list.consolidate() : null;
  return consolidated ? (consolidated.matrix as Matrix) : translate(0, 0);
}

function setTransform(el: Element, m: Matrix) {
  const isTranslation =
    Math.abs(m.a - 1) < 1e-9 && Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && Math.abs(m.d - 1) < 1e-9;
  if (isTranslation) {
    if (Math.abs(m.e) > 1e-9 || Math.abs(m.f) > 1e-9) {
      el.setAttribute("transform", `translate(${fmt(m.e)} ${fmt(m.f)})`);
    }
  } else {
    el.setAttribute("transform", `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(fmt).join(" ")})`);
  }
}

function setAttributes(el: Element, attrs: Record<string, string>) {
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
}

function num(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Number with at most 3 decimals and no trailing zeros. */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
