// Geometry and color helpers shared by the SVG-to-shape conversions.

export type Point = { x: number; y: number };
/** 2D affine matrix with the same fields as DOMMatrix / SVGMatrix. */
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function translate(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scale(x: number, y = x): Matrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotate(radians: number): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/**
 * Returns a function giving each element's transform to the root <svg>'s
 * user coordinates, including all ancestor and own transforms.
 */
export function rootTransform(svgEl: SVGSVGElement): (el: Element) => Matrix {
  const rootInverse = invert(svgEl.getScreenCTM() as Matrix);
  return (el) => multiply(rootInverse, (el as SVGGraphicsElement).getScreenCTM() as Matrix);
}

/**
 * Whether a computed stroke-dasharray leaves gaps. Mermaid uses "1, 0" or
 * "0" for solid lines; an odd-length list repeats to make pairs, as in SVG.
 */
export function isDashed(dasharray: string): boolean {
  const values = dasharray.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  const pairs = values.length % 2 ? [...values, ...values] : values;
  return pairs.some((d, i) => i % 2 === 1 && d > 0);
}

/** Parses a computed CSS color into #RRGGBB and alpha; null for none/transparent. */
export function parseColor(value: string): { color: string; alpha: number } | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return { color: "#" + h.toUpperCase(), alpha: 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (!rgb) {
    return null;
  }
  const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (a === 0) {
    return null;
  }
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
  return { color: `#${toHex(r)}${toHex(g)}${toHex(b)}`, alpha: a };
}
