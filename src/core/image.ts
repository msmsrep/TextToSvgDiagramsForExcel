import { t } from "./messages";

// Raster output is rendered at this multiple of the SVG size for sharper images.
const RASTER_SCALE = 2;
// Upper bound on canvas area; larger diagrams are rendered at a lower scale.
const MAX_CANVAS_PIXELS = 4096 * 4096;
const JPEG_QUALITY = 0.92;

export type RasterFormat = "png" | "jpeg";
export type ImageFormat = RasterFormat | "svg";
/** Base64 image (without data: prefix) and its display size in CSS pixels. */
export type RasterImage = { base64: string; width: number; height: number };
/** SVG markup and its display size in CSS pixels (0 when unknown). */
export type SvgImage = { svg: string; width: number; height: number };

/**
 * Serializes the SVG. With a scale other than 1, the copy gets an explicit
 * width and height of its viewBox size times the scale (and loses mermaid's
 * max-width), so viewers show it at that size.
 */
export function serializeSvg(svgEl: SVGSVGElement, scale = 1): string {
  const { width, height } = svgSize(svgEl);
  if (scale === 1 || width === 0) {
    return new XMLSerializer().serializeToString(svgEl);
  }
  const copy = svgEl.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", String(width * scale));
  copy.setAttribute("height", String(height * scale));
  copy.style.removeProperty("max-width");
  if (copy.getAttribute("style") === "") {
    copy.removeAttribute("style");
  }
  return new XMLSerializer().serializeToString(copy);
}

/** The SVG's size in CSS pixels from its viewBox, or 0 x 0 when it has none. */
export function svgSize(svgEl: SVGSVGElement): { width: number; height: number } {
  const vb = svgEl.viewBox?.baseVal;
  return vb && vb.width > 0 && vb.height > 0
    ? { width: vb.width, height: vb.height }
    : { width: 0, height: 0 };
}

export function svgToDataUrl(svgStr: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t("svgLoadFailed")));
    img.src = src;
  });
}

/**
 * Converts an SVG element to a PNG or JPEG via Canvas. The image is `scale`
 * times the SVG size and rendered at RASTER_SCALE times that (reduced for
 * very large diagrams). JPEG gets a white background since it does not
 * support transparency.
 */
export async function svgToRaster(
  svgEl: SVGSVGElement,
  format: RasterFormat,
  scale = 1,
): Promise<RasterImage> {
  const img = await loadImage(svgToDataUrl(serializeSvg(svgEl)));

  const vb = svgEl.viewBox?.baseVal;
  const w = (vb && vb.width > 0 ? vb.width : img.naturalWidth) || 800;
  const h = (vb && vb.height > 0 ? vb.height : img.naturalHeight) || 600;
  const pixelScale = Math.min(RASTER_SCALE * scale, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * pixelScale));
  canvas.height = Math.max(1, Math.round(h * pixelScale));
  const ctx2d = canvas.getContext("2d")!;
  if (format === "jpeg") {
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);

  const dataUrl =
    format === "jpeg"
      ? canvas.toDataURL("image/jpeg", JPEG_QUALITY)
      : canvas.toDataURL("image/png");
  return { base64: dataUrl.split(",")[1], width: w * scale, height: h * scale };
}
