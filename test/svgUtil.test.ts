import { describe, expect, it } from "vitest";
import { apply, invert, isDashed, multiply, parseColor, rotate, scale, translate } from "../src/core/svgUtil";

describe("parseColor", () => {
  it.each([
    ["#abc", { color: "#AABBCC", alpha: 1 }],
    ["#9370db", { color: "#9370DB", alpha: 1 }],
    ["rgb(236, 236, 255)", { color: "#ECECFF", alpha: 1 }],
    ["rgba(232, 232, 232, 0.8)", { color: "#E8E8E8", alpha: 0.8 }],
  ])("parses %s", (value, expected) => {
    expect(parseColor(value)).toEqual(expected);
  });

  it.each(["none", "rgba(0, 0, 0, 0)", "url(#gradient)", ""])("returns null for %s", (value) => {
    expect(parseColor(value)).toBeNull();
  });
});

describe("isDashed", () => {
  it.each(["3px", "2, 2", "5 0 3", "8,8"])("treats %s as dashed", (value) => {
    expect(isDashed(value)).toBe(true);
  });

  it.each(["none", "", "0", "1, 0", "0 0", "1px, 0px"])("treats %s as solid", (value) => {
    expect(isDashed(value)).toBe(false);
  });
});

describe("matrix helpers", () => {
  const close = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });

  it("applies matrices right to left", () => {
    const m = multiply(translate(10, 20), multiply(rotate(Math.PI / 2), scale(2)));
    expect(close(apply(m, { x: 1, y: 0 }))).toEqual({ x: 10, y: 22 });
  });

  it("inverts a matrix", () => {
    const m = multiply(translate(3, -4), multiply(rotate(0.3), scale(2, 0.5)));
    expect(close(apply(multiply(invert(m), m), { x: 7, y: 9 }))).toEqual({ x: 7, y: 9 });
  });
});
