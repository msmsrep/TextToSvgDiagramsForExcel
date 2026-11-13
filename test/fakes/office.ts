import { vi } from "vitest";

/** In-memory stand-in for a shape on the active worksheet. */
export type ShapeState = {
  id: string;
  name: string;
  type: string;
  altTextTitle: string;
  altTextDescription: string;
  left: number;
  top: number;
  width: number;
  height: number;
  lockAspectRatio?: boolean;
  base64?: string;
  geometricShapeType?: string;
  fill?: FillState;
  lineFormat?: LineFormatState;
  textFrame?: TextFrameState;
  line?: LineState;
  /** IDs of the shapes in a group. */
  members?: string[];
};

export type FillState = { color?: string; transparency?: number; cleared?: boolean };
export type LineFormatState = { color?: string; weight?: number; dashStyle?: string; visible?: boolean };
export type TextFrameState = {
  autoSizeSetting?: string;
  leftMargin?: number;
  rightMargin?: number;
  topMargin?: number;
  bottomMargin?: number;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  text?: string;
  fontSize?: number;
  fontColor?: string;
};
export type LineState = {
  connectorType?: string;
  begin: { left: number; top: number };
  end: { left: number; top: number };
  beginShape?: string;
  beginSite?: number;
  endShape?: string;
  endSite?: number;
  beginArrowheadStyle?: string;
  endArrowheadStyle?: string;
};

/** Operation log entry; `batch` is the number of syncs completed before it. */
export type Op = {
  op: "addImage" | "delete" | "setSelectedData" | "addGeometricShape" | "addLine" | "addTextBox" | "addGroup";
  id?: string;
  batch: number;
};


/**
 * Minimal fake of the Excel / Office APIs used by excelShapes.ts. Property
 * writes take effect immediately; `ops` records which sync batch each
 * mutating call belongs to so tests can check batching.
 */
export function createFakeOffice(init: Partial<ShapeState>[] = []) {
  let nextId = 1;
  const newId = () => `shape-${nextId++}`;

  const shapes: ShapeState[] = init.map((s) => ({
    id: newId(),
    name: "Picture",
    type: "Image",
    altTextTitle: "",
    altTextDescription: "",
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    ...s,
  }));
  const ops: Op[] = [];
  /** Connection site counts reported by the fake, by geometric shape type. */
  const siteCounts: Record<string, number> = { Rectangle: 4, Diamond: 4, Ellipse: 8 };
  /** Every shape ever added, including grouped and deleted ones. */
  const allShapes: ShapeState[] = [...shapes];
  const activeCell = { left: 10, top: 20 };
  /**
   * The used part of the selected range, or null when it has no values;
   * "shape" makes the selection a shape, so reading it fails.
   */
  let selection: {
    values: unknown[][];
    text: string[][];
    numberFormat: string[][];
    rowIndex: number;
  } | null | "shape" = null;
  const activatedHandlers: Array<() => unknown> = [];
  /** Shape onActivated handlers by shape ID. */
  const shapeHandlers = new Map<string, Set<(args: { shapeId: string }) => unknown>>();
  let syncCount = 0;

  /** How setSelectedDataAsync behaves: fail, or add this many shapes. */
  const svgInsert: { result: "ok" | "fail"; errorMessage: string; addShapes: number } = {
    result: "ok",
    errorMessage: "Insert failed",
    addShapes: 1,
  };
  let svgSupported = true;
  let date1904 = false;
  /** Fails the sync after this many more succeed, as Excel does when a queued call fails. */
  let failSyncAfter: number | undefined;

  function fillProxy(state: ShapeState) {
    const fill = (state.fill ??= {});
    return {
      setSolidColor(color: string) { fill.color = color; },
      clear() { fill.cleared = true; },
      set transparency(v: number) { fill.transparency = v; },
    };
  }

  function textFrameProxy(state: ShapeState) {
    const frame = (state.textFrame ??= {});
    return Object.assign(frame, {
      textRange: {
        set text(v: string) { frame.text = v; },
        font: {
          set size(v: number) { frame.fontSize = v; },
          set color(v: string) { frame.fontColor = v; },
        },
      },
    });
  }

  function lineProxy(line: LineState) {
    return Object.assign(line, {
      connectBeginShape(shape: { id: string }, site: number) {
        line.beginShape = shape.id;
        line.beginSite = site;
      },
      connectEndShape(shape: { id: string }, site: number) {
        line.endShape = shape.id;
        line.endSite = site;
      },
    });
  }

  function shapeProxy(state: ShapeState) {
    return {
      get id() { return state.id; },
      get connectionSiteCount() { return siteCounts[state.geometricShapeType ?? ""] ?? 0; },
      get fill() { return fillProxy(state); },
      get lineFormat() { return (state.lineFormat ??= {}); },
      get textFrame() { return textFrameProxy(state); },
      get line() { return lineProxy(state.line!); },
      get type() { return state.type; },
      get name() { return state.name; },
      set name(v: string) { state.name = v; },
      get altTextTitle() { return state.altTextTitle; },
      set altTextTitle(v: string) { state.altTextTitle = v; },
      get altTextDescription() { return state.altTextDescription; },
      set altTextDescription(v: string) { state.altTextDescription = v; },
      get left() { return state.left; },
      set left(v: number) { state.left = v; },
      get top() { return state.top; },
      set top(v: number) { state.top = v; },
      get width() { return state.width; },
      set width(v: number) { state.width = v; },
      get height() { return state.height; },
      set height(v: number) { state.height = v; },
      set lockAspectRatio(v: boolean) { state.lockAspectRatio = v; },
      onActivated: {
        add(h: (args: { shapeId: string }) => unknown) {
          let set = shapeHandlers.get(state.id);
          if (!set) shapeHandlers.set(state.id, (set = new Set()));
          set.add(h);
          return { context: ctx, remove: () => set.delete(h) };
        },
      },
      isNullObject: false,
      load: vi.fn(),
      delete() {
        ops.push({ op: "delete", id: state.id, batch: syncCount });
        const i = shapes.indexOf(state);
        if (i >= 0) shapes.splice(i, 1);
      },
    };
  }

  function find(id: string) {
    return shapes.find((s) => s.id === id);
  }

  const shapeCollection = {
    get items() { return shapes.map(shapeProxy); },
    load: vi.fn(),
    getItem(id: string) {
      const s = find(id);
      if (!s) throw new Error(`ItemNotFound: ${id}`);
      return shapeProxy(s);
    },
    getItemOrNullObject(id: string) {
      const s = find(id);
      return s ? shapeProxy(s) : { isNullObject: true, load: vi.fn(), delete: vi.fn() };
    },
    addImage(base64: string) {
      const id = newId();
      const state: ShapeState = {
        id, name: `Default ${id}`, type: "Image",
        altTextTitle: "", altTextDescription: "",
        left: 0, top: 0, width: 50, height: 50, base64,
      };
      shapes.push(state);
      ops.push({ op: "addImage", id: state.id, batch: syncCount });
      return shapeProxy(state);
    },
    addGeometricShape(geometricShapeType: string) {
      const state = addShape("GeometricShape", { geometricShapeType });
      ops.push({ op: "addGeometricShape", id: state.id, batch: syncCount });
      return shapeProxy(state);
    },
    addLine(startLeft: number, startTop: number, endLeft: number, endTop: number, connectorType?: string) {
      const state = addShape("Line", {
        line: { connectorType, begin: { left: startLeft, top: startTop }, end: { left: endLeft, top: endTop } },
      });
      ops.push({ op: "addLine", id: state.id, batch: syncCount });
      return shapeProxy(state);
    },
    addTextBox(text?: string) {
      const state = addShape("TextBox", { textFrame: { text } });
      ops.push({ op: "addTextBox", id: state.id, batch: syncCount });
      return shapeProxy(state);
    },
    /** Grouped shapes leave the sheet's top-level collection, as in Excel. */
    addGroup(values: Array<string | { id: string }>) {
      const members = values.map((v) => (typeof v === "string" ? v : v.id));
      for (const id of members) {
        const i = shapes.findIndex((s) => s.id === id);
        if (i >= 0) shapes.splice(i, 1);
      }
      const state = addShape("Group", { members });
      ops.push({ op: "addGroup", id: state.id, batch: syncCount });
      return shapeProxy(state);
    },
  };

  function addShape(type: string, extra: Partial<ShapeState>): ShapeState {
    const id = newId();
    const state: ShapeState = {
      id, name: `Default ${id}`, type,
      altTextTitle: "", altTextDescription: "",
      left: 0, top: 0, width: 50, height: 50,
      ...extra,
    };
    shapes.push(state);
    allShapes.push(state);
    return state;
  }

  const ctx = {
    workbook: {
      worksheets: {
        getActiveWorksheet: () => ({ shapes: shapeCollection }),
        onActivated: { add: vi.fn((h: () => unknown) => { activatedHandlers.push(h); }) },
      },
      getActiveCell: () => ({ ...activeCell, load: vi.fn() }),
      getSelectedRange: () => ({ getUsedRangeOrNullObject: selectedUsedRange }),
      functions: {
        /** DATE(y, m, d) as a serial in the workbook's date system (only 1904-01-01 is needed). */
        date: (y: number, m: number, d: number) => ({
          value: y === 1904 && m === 1 && d === 1 ? (date1904 ? 0 : 1462) : NaN,
          load: vi.fn(),
        }),
      },
    },
    sync: vi.fn(async () => {
      if (failSyncAfter !== undefined && failSyncAfter-- === 0) {
        failSyncAfter = undefined;
        throw new Error("Sync failed");
      }
      if (pendingSyncError) {
        const e = pendingSyncError;
        pendingSyncError = undefined;
        throw e;
      }
      syncCount++;
    }),
  };
  /** Error thrown by the next sync, as Excel reports queued failures there. */
  let pendingSyncError: Error | undefined;

  function selectedUsedRange() {
    if (selection === "shape") {
      pendingSyncError = new Error("InvalidSelection");
      return { load: vi.fn() };
    }
    const s = selection;
    return {
      isNullObject: s === null,
      rowCount: s?.values.length ?? 0,
      rowIndex: s?.rowIndex ?? 0,
      values: s?.values,
      text: s?.text,
      numberFormat: s?.numberFormat,
      load: vi.fn(),
    };
  }

  const Excel = {
    /** Accepts `run(fn)` and `run(context, fn)`. */
    run: vi.fn(async (a: unknown, b?: (c: typeof ctx) => unknown) =>
      (typeof a === "function" ? (a as (c: typeof ctx) => unknown) : b!)(ctx)),
  };

  const Office = {
    CoercionType: { XmlSvg: "xmlSvg" },
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    context: {
      requirements: {
        isSetSupported: vi.fn((name: string, version: string) =>
          svgSupported && name === "ImageCoercion" && version === "1.2"),
      },
      document: {
        setSelectedDataAsync: vi.fn(
          (data: string, _opts: unknown, cb: (r: unknown) => void) => {
            ops.push({ op: "setSelectedData", batch: syncCount });
            if (svgInsert.result === "fail") {
              cb({ status: "failed", error: { message: svgInsert.errorMessage } });
              return;
            }
            for (let i = 0; i < svgInsert.addShapes; i++) {
              const id = newId();
              shapes.push({
                id, name: `Default ${id}`, type: "Image",
                altTextTitle: "", altTextDescription: "",
                left: 300, top: 300, width: 80, height: 80, base64: data,
              });
            }
            cb({ status: "succeeded" });
          },
        ),
      },
    },
  };

  return {
    Excel,
    Office,
    ctx,
    shapes,
    allShapes,
    ops,
    siteCounts,
    activeCell,
    svgInsert,
    activatedHandlers,
    shapeHandlers,
    /** Selects a shape on the sheet, firing its onActivated handlers. */
    async selectShape(id: string) {
      for (const h of shapeHandlers.get(id) ?? []) await h({ shapeId: id });
    },
    get syncCount() { return syncCount; },
    setSvgSupported(v: boolean) { svgSupported = v; },
    setSelection(s: typeof selection) { selection = s; },
    setDate1904(v: boolean) { date1904 = v; },
    /** Makes the sync after `n` successful ones fail. */
    failSyncAfter(n: number) { failSyncAfter = n; },
    /** Installs the fakes as the `Excel` and `Office` globals. */
    install() {
      vi.stubGlobal("Excel", Excel);
      vi.stubGlobal("Office", Office);
    },
  };
}

export type FakeOffice = ReturnType<typeof createFakeOffice>;
