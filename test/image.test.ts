import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { serializeSvg, svgSize, svgToDataUrl, svgToRaster } from "../src/core/image";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(viewBox?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  if (viewBox) svg.setAttribute("viewBox", viewBox);
  svg.appendChild(document.createElementNS(SVG_NS, "text")).textContent = "A & B";
  return svg;
}

/** Fake Image that "loads" asynchronously with a configurable natural size. */
class FakeImage {
  static naturalWidth = 0;
  static naturalHeight = 0;
  static fail = false;
  static lastSrc = "";

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = FakeImage.naturalWidth;
  naturalHeight = FakeImage.naturalHeight;

  set src(value: string) {
    FakeImage.lastSrc = value;
    queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
  }
}

let canvas: { width: number; height: number } | undefined;
let ctx2d: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
let toDataURL: MockInstance<HTMLCanvasElement["toDataURL"]>;

beforeEach(() => {
  FakeImage.naturalWidth = 0;
  FakeImage.naturalHeight = 0;
  FakeImage.fail = false;
  vi.stubGlobal("Image", FakeImage);

  ctx2d = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx2d as unknown as CanvasRenderingContext2D,
  );
  toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(function (this: HTMLCanvasElement, type?: string) {
      canvas = { width: this.width, height: this.height };
      return `data:${type};base64,ENCODED`;
    });
});

describe("serializeSvg / svgToDataUrl", () => {
  it("serializes the SVG element to markup", () => {
    const str = serializeSvg(makeSvg("0 0 10 20"));
    expect(str).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 10 20">/);
    expect(str).toContain("A &amp; B");
  });

  it("gives a scaled copy an explicit size and drops mermaid's max-width", () => {
    const svg = makeSvg("0 0 10 20");
    svg.setAttribute("width", "100%");
    svg.setAttribute("style", "max-width: 10px;");
    const str = serializeSvg(svg, 1.5);

    expect(str).toContain('width="15"');
    expect(str).toContain('height="30"');
    expect(str).not.toContain("max-width");
    expect(str).not.toContain("style=");
    expect(svg.getAttribute("width")).toBe("100%");
  });

  it("keeps other styles of a scaled copy", () => {
    const svg = makeSvg("0 0 10 20");
    svg.setAttribute("style", "max-width: 10px; background-color: white;");
    expect(serializeSvg(svg, 2)).toContain('style="background-color: white;"');
  });

  it("leaves the SVG as is at scale 1 or without a viewBox", () => {
    const svg = makeSvg("0 0 10 20");
    expect(serializeSvg(svg, 1)).toBe(serializeSvg(svg));
    expect(serializeSvg(makeSvg(), 2)).not.toContain("width=");
  });

  it("builds a percent-encoded SVG data URL", () => {
    const url = svgToDataUrl('<svg a="#">&</svg>');
    expect(url).toBe(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg a="#">&</svg>'),
    );
    expect(decodeURIComponent(url.split(",")[1])).toBe('<svg a="#">&</svg>');
  });
});

describe("svgToRaster", () => {
  it("loads the serialized SVG as a data URL", async () => {
    const svg = makeSvg("0 0 100 50");
    await svgToRaster(svg, "png");
    expect(FakeImage.lastSrc).toBe(svgToDataUrl(serializeSvg(svg)));
  });

  it("renders at 2x the viewBox size and reports the viewBox size", async () => {
    const result = await svgToRaster(makeSvg("0 0 100 50"), "png");

    expect(result).toEqual({ base64: "ENCODED", width: 100, height: 50 });
    expect(canvas).toEqual({ width: 200, height: 100 });
    expect(ctx2d.drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 200, 100);
  });

  it("scales the reported size and the resolution together", async () => {
    const result = await svgToRaster(makeSvg("0 0 100 50"), "png", 1.5);

    expect(result).toEqual({ base64: "ENCODED", width: 150, height: 75 });
    expect(canvas).toEqual({ width: 300, height: 150 });
  });

  it("keeps a scaled-up canvas within 4096x4096 pixels", async () => {
    const result = await svgToRaster(makeSvg("0 0 2000 2000"), "png", 2);

    expect(result).toMatchObject({ width: 4000, height: 4000 });
    expect(canvas).toEqual({ width: 4096, height: 4096 });
  });

  it("prefers the viewBox over the image's natural size", async () => {
    FakeImage.naturalWidth = 999;
    FakeImage.naturalHeight = 999;
    const result = await svgToRaster(makeSvg("0 0 100 50"), "png");
    expect(result).toMatchObject({ width: 100, height: 50 });
  });

  it("falls back to the natural size when there is no viewBox", async () => {
    FakeImage.naturalWidth = 300;
    FakeImage.naturalHeight = 150;
    const result = await svgToRaster(makeSvg(), "png");

    expect(result).toMatchObject({ width: 300, height: 150 });
    expect(canvas).toEqual({ width: 600, height: 300 });
  });

  it("falls back to 800x600 when neither a viewBox nor a natural size is available", async () => {
    const result = await svgToRaster(makeSvg(), "png");

    expect(result).toMatchObject({ width: 800, height: 600 });
    expect(canvas).toEqual({ width: 1600, height: 1200 });
  });

  it("falls back per dimension when the viewBox has a zero size", async () => {
    FakeImage.naturalWidth = 300;
    FakeImage.naturalHeight = 150;
    const result = await svgToRaster(makeSvg("0 0 0 0"), "png");
    expect(result).toMatchObject({ width: 300, height: 150 });
  });

  it("lowers the scale so the canvas stays within 4096x4096 pixels", async () => {
    const result = await svgToRaster(makeSvg("0 0 4000 4000"), "png");

    expect(result).toMatchObject({ width: 4000, height: 4000 });
    expect(canvas).toEqual({ width: 4096, height: 4096 });
  });

  it("keeps a wide diagram's canvas area within the limit", async () => {
    await svgToRaster(makeSvg("0 0 10000 1000"), "png");

    expect(canvas!.width * canvas!.height).toBeLessThanOrEqual(4096 * 4096);
    expect(canvas!.width / canvas!.height).toBeCloseTo(10, 1);
  });

  it("keeps at least a 1x1 canvas", async () => {
    await svgToRaster(makeSvg("0 0 0.1 0.1"), "png");
    expect(canvas).toEqual({ width: 1, height: 1 });
  });

  it("exports PNG with a transparent background", async () => {
    await svgToRaster(makeSvg("0 0 100 50"), "png");

    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(ctx2d.fillRect).not.toHaveBeenCalled();
  });

  it("exports JPEG at quality 0.92 on a white background", async () => {
    let fillStyleAtFill = "";
    ctx2d.fillRect.mockImplementation(() => (fillStyleAtFill = ctx2d.fillStyle));
    await svgToRaster(makeSvg("0 0 100 50"), "jpeg");

    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.92);
    expect(ctx2d.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(fillStyleAtFill).toBe("#ffffff");
    expect(ctx2d.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx2d.drawImage.mock.invocationCallOrder[0],
    );
  });

  it("rejects when the SVG image fails to load", async () => {
    FakeImage.fail = true;
    await expect(svgToRaster(makeSvg("0 0 100 50"), "png")).rejects.toThrow(
      "Failed to load SVG image.",
    );
  });
});

describe("svgSize", () => {
  it("returns the viewBox size", () => {
    expect(svgSize(makeSvg("5 5 100 50"))).toEqual({ width: 100, height: 50 });
  });

  it("returns 0 x 0 without a viewBox", () => {
    expect(svgSize(makeSvg())).toEqual({ width: 0, height: 0 });
  });
});
