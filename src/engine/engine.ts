// The desktop app's rendering engine. It runs in WebView2, shows the preview
// and answers the app's JSON requests with the shared code (src/core).

import { errorSourceLine } from "../core/errorLine";
import { extractFlowchart, scaleModel } from "../core/flowchartModel";
import { serializeSvg, svgSize, svgToRaster } from "../core/image";
import { getLocale, type Locale, type MessageId, setLocale, t } from "../core/messages";
import { toOfficeSvg } from "../core/officeSvg";
import { getFlowchartData, initMermaid, renderMermaid } from "../core/render";
import { type TableData, type TableKind, tableToMermaid } from "../core/tableToMermaid";
import { TEMPLATES } from "../core/templates";
import { errorMessage } from "../core/util";

export type EngineRequest = { id: number; method: string; params?: Record<string, unknown> };
export type EngineErrorCode =
  | "render"
  | "stale"
  | "notRendered"
  | "changed"
  | "notFlowchart"
  | "table"
  | "badRequest"
  | "internal";
export type EngineError = { code: EngineErrorCode; message: string; line?: number };
export type EngineResponse = { id: number; result?: unknown; error?: EngineError };

/** The WebView2 side of the message channel (window.chrome.webview). */
export type WebViewHost = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
};

class Failure extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly line?: number,
  ) {
    super(message);
  }
}

const fail = (code: EngineErrorCode, id: MessageId): never => {
  throw new Failure(code, t(id));
};

/** The diagram shown in the preview: its render number, code and SVG element. */
type Shown = { seq: number; code: string; svgEl: SVGSVGElement };

export type Engine = { handle(request: EngineRequest): Promise<EngineResponse> };

export function createEngine(preview: HTMLElement): Engine {
  // The newest render requested; older ones finishing later are not shown.
  let latestSeq = 0;
  let shown: Shown | undefined;

  function showHint() {
    preview.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = t("previewHint", { menu: menuName() });
    preview.appendChild(hint);
  }

  /** The shown diagram, checking that it is the one the app last rendered. */
  function rendered(params: Record<string, unknown>): Shown {
    if (!shown) {
      return fail("notRendered", "pleaseRenderFirst");
    }
    if (params.seq !== shown.seq) {
      return fail("changed", "diagramChanged");
    }
    return shown;
  }

  const num = (value: unknown, fallback: number) => (typeof value === "number" && value > 0 ? value : fallback);

  const methods: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    async init(params) {
      setLocale(params.locale === "ja" ? "ja" : "en");
      initMermaid();
      if (!shown) showHint();
      return null;
    },

    async render(params) {
      const seq = Number(params.seq);
      latestSeq = Math.max(latestSeq, seq);
      // The editor's text: errors are mapped back to its lines.
      const source = String(params.code ?? "").replace(/\r\n?/g, "\n");
      const code = source.trim();
      let svg: string;
      try {
        svg = await renderMermaid(code);
      } catch (e) {
        if (seq < latestSeq) return fail("stale", "diagramChanged");
        shown = undefined;
        preview.replaceChildren();
        const message = errorMessage(e);
        throw new Failure("render", message, errorSourceLine(source, message));
      }
      if (seq < latestSeq) return fail("stale", "diagramChanged");
      preview.innerHTML = svg;
      const svgEl = preview.querySelector<SVGSVGElement>("svg");
      if (!svgEl) {
        shown = undefined;
        throw new Failure("render", t("pleaseRenderFirst"));
      }
      shown = { seq, code, svgEl };
      const { width, height } = svgSize(svgEl);
      return { seq, width: width || null, height: height || null };
    },

    async clear(params) {
      latestSeq = Math.max(latestSeq, Number(params.seq ?? 0));
      shown = undefined;
      showHint();
      return null;
    },

    async raster(params) {
      const { svgEl } = rendered(params);
      const format = params.format === "jpeg" ? "jpeg" : "png";
      return svgToRaster(svgEl, format, num(params.scale, 1));
    },

    async svg(params) {
      const { svgEl } = rendered(params);
      return { svg: serializeSvg(svgEl, num(params.scale, 1)) };
    },

    async officeSvg(params) {
      const { svgEl } = rendered(params);
      return { svg: toOfficeSvg(svgEl), ...svgSize(svgEl) };
    },

    async shapeModel(params) {
      const { svgEl, code } = rendered(params);
      const data = await getFlowchartData(code);
      if (!data) {
        return fail("notFlowchart", "shapesFlowchartOnly");
      }
      return scaleModel(extractFlowchart(svgEl, data), num(params.scale, 1));
    },

    async fromTable(params) {
      try {
        return { code: tableToMermaid(params.table as TableData, (params.kind ?? "auto") as TableKind) };
      } catch (e) {
        throw new Failure("table", errorMessage(e));
      }
    },

    async templates() {
      return TEMPLATES.map(({ id, label, code }) => ({ id, name: label, code }));
    },
  };

  return {
    async handle(request) {
      const method = methods[request?.method];
      try {
        if (!method) {
          throw new Failure("badRequest", `Unknown method: ${request?.method}`);
        }
        return { id: request.id, result: await method(request.params ?? {}) };
      } catch (e) {
        const error: EngineError =
          e instanceof Failure
            ? { code: e.code, message: e.message, ...(e.line !== undefined && { line: e.line }) }
            : { code: "internal", message: errorMessage(e) };
        return { id: request?.id, error };
      }
    },
  };
}

// Where the desktop app's menu offers templates, for the preview hint.
const MENU_NAMES: Record<Locale, string> = { en: "New > Template", ja: "[新規] > [テンプレート]" };
const menuName = () => MENU_NAMES[getLocale()];

/** Connects the engine to WebView2; requests are handled one at a time, in order. */
export function connect(host: WebViewHost, preview: HTMLElement): void {
  const engine = createEngine(preview);
  let queue = Promise.resolve();
  host.addEventListener("message", (e) => {
    const request = e.data as EngineRequest;
    // Rendering is queued anyway (one mermaid render at a time); queuing here
    // keeps responses in request order.
    queue = queue.then(async () => host.postMessage(await engine.handle(request)));
  });
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewHost };
  }
}

const host = typeof window !== "undefined" ? window.chrome?.webview : undefined;
const previewEl = typeof document !== "undefined" ? document.getElementById("preview") : null;
if (host && previewEl) {
  connect(host, previewEl);
}
