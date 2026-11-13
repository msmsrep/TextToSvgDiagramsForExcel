import {
  type DiagramItem,
  getDiagramWidth,
  insertImageShape,
  insertNativeShapes,
  insertSvgShape,
  isSvgInsertSupported,
  listDiagrams,
  onSheetActivated,
  watchDiagramSelection,
} from "./excelShapes";
import { errorSourceLine } from "../core/errorLine";
import { readSelection } from "./excelTable";
import { extractFlowchart, scaleModel } from "../core/flowchartModel";
import { type ImageFormat, serializeSvg, svgSize, svgToDataUrl, svgToRaster } from "../core/image";
import { initLineHighlight } from "./lineHighlight";
import { setLocale, t, toLocale } from "../core/messages";
import { toOfficeSvg } from "../core/officeSvg";
import { getFlowchartData, initMermaid, renderMermaid } from "../core/render";
import { registerRibbonCommands } from "./ribbon";
import { initSplitter } from "./splitter";
import { type TableKind, tableToMermaid } from "../core/tableToMermaid";
import { TEMPLATES } from "../core/templates";
import { errorMessage, PX_TO_PT } from "../core/util";
import { byId, localize } from "./dom";

const RENDER_DEBOUNCE_MS = 250;
const FILE_EXTENSIONS: Record<ImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  svg: "svg",
};

/**
 * Image formats, plus "svg-office" (SVG simplified for Excel's Convert to
 * Shape) and "shapes" (native Excel shapes; flowcharts only, no download).
 */
type OutputFormat = ImageFormat | "svg-office" | "shapes";

Office.onReady(() => {
  // Office's display language, not the browser's, so the pane matches the ribbon.
  const locale = toLocale(Office.context?.displayLanguage);
  setLocale(locale);
  document.documentElement.lang = locale;
  localize(document);
  initMermaid();

  const input = byId<HTMLTextAreaElement>("mermaid-input");
  const inputBackdrop = byId<HTMLDivElement>("input-backdrop");
  const splitter = byId<HTMLDivElement>("splitter");
  const preview = byId<HTMLDivElement>("preview");
  const errDiv = byId<HTMLDivElement>("error");
  const insertBtn = byId<HTMLButtonElement>("insert-btn");
  const downloadBtn = byId<HTMLButtonElement>("download-btn");
  const diagramSelect = byId<HTMLSelectElement>("sheet-diagram-select");
  const formatSelect = byId<HTMLSelectElement>("format-select");
  const sizeSelect = byId<HTMLSelectElement>("size-select");
  const sizeWidth = byId<HTMLInputElement>("size-width");
  const keepSize = byId<HTMLInputElement>("keep-size");
  const loadConfirm = byId<HTMLDivElement>("load-confirm");
  const loadConfirmText = byId<HTMLSpanElement>("load-confirm-text");
  const loadConfirmReplace = byId<HTMLButtonElement>("load-confirm-replace");
  const loadConfirmKeep = byId<HTMLButtonElement>("load-confirm-keep");

  let renderDebounceTimer: number | undefined;
  let renderRequestId = 0;
  let diagramItems: DiagramItem[] = [];
  let actionsEnabled = false;
  // The diagram the editor holds; the dropdown shows it and Insert replaces it.
  let currentDiagramId = "";
  // Code last loaded from or inserted into a diagram (or the initial sample).
  // Anything else in the editor is unsaved and asks before being replaced.
  let savedCode = input.value.trim();
  let pendingLoad: DiagramItem | undefined;
  // An insert or download in progress; pressing again (or a ribbon command)
  // meanwhile would insert twice or replace a diagram already replaced.
  let busy = false;

  const selectedFormat = () => formatSelect.value as OutputFormat;

  function setActionsEnabled(enabled: boolean) {
    actionsEnabled = enabled;
    insertBtn.disabled = !enabled;
    downloadBtn.disabled = !enabled || selectedFormat() === "shapes";
  }

  formatSelect.addEventListener("change", () => {
    setActionsEnabled(actionsEnabled);
    updateSizeControls();
  });

  // ── Output size ────────────────────────────────────────────────────────────
  // "SVG (for shape conversion)" stays at the actual size: Convert to Shape
  // scales the shapes with the picture but keeps the font sizes.
  const isFixedSize = () => selectedFormat() === "svg-office";

  function updateSizeControls() {
    const fixed = isFixedSize();
    sizeSelect.disabled = fixed;
    sizeWidth.hidden = sizeSelect.value !== "width";
    sizeWidth.disabled = fixed;
    keepSize.disabled = fixed || currentDiagramId === "";
  }

  /** The diagram's actual width in points, from the preview SVG's viewBox. */
  function actualWidthPt(svgEl: SVGSVGElement): number {
    const { width } = svgSize(svgEl);
    if (width === 0) {
      throw new Error(t("sizeUnknown"));
    }
    return width * PX_TO_PT;
  }

  /** The scale chosen in Size, relative to the diagram's actual size. */
  function chosenScale(svgEl: SVGSVGElement): number {
    if (isFixedSize()) {
      return 1;
    }
    if (sizeSelect.value !== "width") {
      return Number(sizeSelect.value);
    }
    const width = Number(sizeWidth.value);
    if (!(width > 0)) {
      throw new Error(t("enterWidth"));
    }
    return width / actualWidthPt(svgEl);
  }

  /** The scale for inserting; Keep current size matches the replaced diagram's width. */
  async function insertScale(svgEl: SVGSVGElement, replaceId?: string): Promise<number> {
    if (replaceId && !keepSize.disabled && keepSize.checked) {
      return (await getDiagramWidth(replaceId)) / actualWidthPt(svgEl);
    }
    return chosenScale(svgEl);
  }

  sizeSelect.addEventListener("change", () => {
    // Start the width at the diagram's actual width.
    const svgEl = preview.querySelector<SVGSVGElement>("svg");
    if (sizeSelect.value === "width" && sizeWidth.value === "" && svgEl) {
      const width = svgSize(svgEl).width;
      if (width > 0) {
        sizeWidth.value = String(Math.round(width * PX_TO_PT));
      }
    }
    updateSizeControls();
  });

  // ── Sheet diagram dropdown ─────────────────────────────────────────────────
  function setCurrentDiagram(id: string) {
    currentDiagramId = diagramItems.some((item) => item.id === id) ? id : "";
    diagramSelect.value = currentDiagramId;
    updateSizeControls();
  }

  function updateDiagramOptions(items: DiagramItem[], selectedId = "") {
    diagramItems = items;
    diagramSelect.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t("noDiagramSelected");
    diagramSelect.appendChild(defaultOption);

    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      diagramSelect.appendChild(option);
    }

    setCurrentDiagram(selectedId);
  }

  async function refreshDiagramOptions(selectedId = currentDiagramId) {
    try {
      updateDiagramOptions(await listDiagrams(), selectedId);
    } catch {
      // Ignore load failures so the main render/insert flow remains available.
      updateDiagramOptions([], "");
    }
    try {
      await watchDiagramSelection(diagramItems.map((item) => item.id), onDiagramSelected);
    } catch {
      // Without the events, the dropdown still loads diagrams.
    }
  }

  function loadDiagram(item: DiagramItem) {
    hideLoadConfirm();
    setCurrentDiagram(item.id);
    input.value = item.altTextDescription;
    savedCode = item.altTextDescription.trim();
    window.clearTimeout(renderDebounceTimer);
    void renderPreview();
  }

  /** Loads a diagram, first asking when that would discard unsaved code. */
  function requestLoad(item: DiagramItem) {
    const code = input.value.trim();
    if (code === "" || code === savedCode || code === item.altTextDescription.trim()) {
      loadDiagram(item);
      return;
    }
    pendingLoad = item;
    loadConfirmText.textContent = t("loadConfirm", { name: item.name });
    loadConfirm.hidden = false;
  }

  function hideLoadConfirm() {
    pendingLoad = undefined;
    loadConfirm.hidden = true;
  }

  function onDiagramSelected(id: string) {
    // Selecting the diagram being edited (e.g. to see it) keeps the edits.
    if (id === currentDiagramId) {
      hideLoadConfirm();
      return;
    }
    const item = diagramItems.find((d) => d.id === id);
    if (item) {
      requestLoad(item);
    }
  }

  loadConfirmReplace.addEventListener("click", () => {
    if (pendingLoad) {
      loadDiagram(pendingLoad);
    }
  });
  loadConfirmKeep.addEventListener("click", hideLoadConfirm);

  diagramSelect.addEventListener("focus", () => {
    void refreshDiagramOptions();
  });

  diagramSelect.addEventListener("change", () => {
    const selected = diagramItems.find((item) => item.id === diagramSelect.value);
    if (!selected) {
      // "(No diagram selected)": insert as a new diagram, keeping the code.
      hideLoadConfirm();
      setCurrentDiagram("");
      return;
    }
    // Stay on the current diagram until the load actually happens.
    diagramSelect.value = currentDiagramId;
    requestLoad(selected);
  });

  // Reload the list (and the selection events) for the newly active sheet.
  onSheetActivated(() => {
    hideLoadConfirm();
    void refreshDiagramOptions("");
  }).catch(() => {/* ignore */});

  // ── Preview ────────────────────────────────────────────────────────────────
  const errorHighlight = initLineHighlight(input, inputBackdrop);

  /** Shows a render error, highlighting the line it points at when there is one. */
  function showRenderError(source: string, message: string) {
    errDiv.textContent = t("renderError", { message });
    const line = errorSourceLine(source, message);
    if (line === undefined) {
      errorHighlight.clear();
      return;
    }
    errorHighlight.show(line);
    const goTo = document.createElement("button");
    goTo.className = "link-btn";
    goTo.textContent = t("goToLine", { line: line + 1 });
    goTo.addEventListener("click", () => errorHighlight.goTo(line));
    errDiv.append(" ", goTo);
  }

  function showHint() {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = t("previewHint", { menu: t("ribbonTemplateMenu") });
    preview.replaceChildren(hint);
  }

  async function renderPreview() {
    const requestId = ++renderRequestId;
    errDiv.textContent = "";
    setActionsEnabled(false);

    const source = input.value;
    const code = source.trim();
    if (!code) {
      errorHighlight.clear();
      showHint();
      return;
    }

    try {
      const svg = await renderMermaid(code);
      if (requestId !== renderRequestId) return;
      errorHighlight.clear();
      preview.innerHTML = svg;
      setActionsEnabled(true);
    } catch (e) {
      if (requestId !== renderRequestId) return;
      preview.innerHTML = "";
      showRenderError(source, errorMessage(e));
    }
  }

  input.addEventListener("input", () => {
    // The preview no longer matches the code: block insert/download until the
    // next render, and discard any render already in progress.
    renderRequestId++;
    setActionsEnabled(false);
    window.clearTimeout(renderDebounceTimer);
    renderDebounceTimer = window.setTimeout(() => {
      void renderPreview();
    }, RENDER_DEBOUNCE_MS);
  });

  initSplitter(splitter, input, preview);

  // ── New code (template / selected cells) ───────────────────────────────────
  /** Puts new code in the editor and renders it right away. */
  async function startNewDiagram(code: string) {
    input.value = code;
    // The new code is a new diagram, so don't replace the selected one.
    hideLoadConfirm();
    setCurrentDiagram("");
    window.clearTimeout(renderDebounceTimer);
    await renderPreview();
  }

  async function useTemplate(id: string) {
    const template = TEMPLATES.find((t) => t.id === id);
    if (template) {
      errDiv.textContent = "";
      await startNewDiagram(template.code);
    }
  }

  async function generateFromCells(kind: TableKind) {
    errDiv.textContent = "";
    let code: string;
    try {
      code = tableToMermaid(await readSelection(), kind);
    } catch (e) {
      errDiv.textContent = t("generateError", { message: errorMessage(e) });
      return;
    }
    await startNewDiagram(code);
  }

  // ── Insert / Download ──────────────────────────────────────────────────────
  /**
   * Runs an action on the rendered SVG and reports any failure. Code typed
   * since the last render (or still rendering) is rendered first. A second
   * action while one runs (including its render) is ignored.
   */
  async function withRenderedSvg(
    errorId: "insertError" | "downloadError",
    action: (svgEl: SVGSVGElement) => Promise<void>,
  ) {
    if (busy) {
      return;
    }
    busy = true;
    try {
      if (actionsEnabled) {
        errDiv.textContent = "";
      } else {
        window.clearTimeout(renderDebounceTimer);
        await renderPreview();
      }
      const svgEl = preview.querySelector<SVGSVGElement>("svg");
      if (!svgEl) {
        // Keep a render error, which tells more than this.
        errDiv.textContent ||= t("pleaseRenderFirst");
        return;
      }
      try {
        await action(svgEl);
      } catch (e) {
        errDiv.textContent = t(errorId, { message: errorMessage(e) });
      }
    } finally {
      busy = false;
    }
  }

  /** Shows the format used from the ribbon, so Size and the buttons follow it. */
  function setFormat(format: OutputFormat) {
    formatSelect.value = format;
    setActionsEnabled(actionsEnabled);
    updateSizeControls();
  }

  function download(format: OutputFormat) {
    setFormat(format);
    return withRenderedSvg("downloadError", async (svgEl) => {
      if (format === "shapes") {
        throw new Error(t("shapesCannotBeDownloaded"));
      }
      const scale = chosenScale(svgEl);
      let dataUrl: string;
      if (format === "svg") {
        dataUrl = svgToDataUrl(serializeSvg(svgEl, scale));
      } else if (format === "svg-office") {
        dataUrl = svgToDataUrl(toOfficeSvg(svgEl));
      } else {
        dataUrl = `data:image/${format};base64,` + (await svgToRaster(svgEl, format, scale)).base64;
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `diagram.${FILE_EXTENSIONS[format === "svg-office" ? "svg" : format]}`;
      a.click();
    });
  }

  function insert(format: OutputFormat) {
    setFormat(format);
    return withRenderedSvg("insertError", async (svgEl) => {
      const mermaidCode = input.value.trim();
      const replaceId = currentDiagramId || undefined;
      let insertedShapeId: string;

      if (format === "shapes") {
        const data = await getFlowchartData(mermaidCode);
        if (!data) {
          throw new Error(t("shapesFlowchartOnly"));
        }
        const scale = await insertScale(svgEl, replaceId);
        insertedShapeId = await insertNativeShapes(
          scaleModel(extractFlowchart(svgEl, data), scale),
          mermaidCode,
          replaceId,
        );
      } else if (format === "svg" || format === "svg-office") {
        if (!isSvgInsertSupported()) {
          throw new Error(t("svgNotSupported"));
        }
        const scale = await insertScale(svgEl, replaceId);
        const svg = format === "svg" ? serializeSvg(svgEl) : toOfficeSvg(svgEl);
        const { width, height } = svgSize(svgEl);
        insertedShapeId = await insertSvgShape(
          { svg, width: width * scale, height: height * scale },
          mermaidCode,
          replaceId,
        );
      } else {
        const image = await svgToRaster(svgEl, format, await insertScale(svgEl, replaceId));
        insertedShapeId = await insertImageShape(image, mermaidCode, replaceId);
      }

      savedCode = mermaidCode;
      await refreshDiagramOptions(insertedShapeId);
    });
  }

  downloadBtn.addEventListener("click", () => void download(selectedFormat()));
  insertBtn.addEventListener("click", () => void insert(selectedFormat()));

  registerRibbonCommands({ useTemplate, generateFromCells, insert, download });

  // Render initial Mermaid code when the task pane opens.
  updateSizeControls();
  void renderPreview();
  void refreshDiagramOptions();
});
