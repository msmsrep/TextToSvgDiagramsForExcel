import { type Box, connectionSite, type Fill, type Label, type Line, type ShapeModel } from "../core/flowchartModel";
import type { RasterImage, SvgImage } from "../core/image";
import { PX_TO_PT } from "../core/util";

// Marks images inserted by this add-in; the Mermaid code goes in the description.
const ALT_TEXT_TITLE = "Mermaid Diagram";
// Images (PNG/JPEG/SVG), and groups or single shapes from the Shapes format.
const DIAGRAM_SHAPE_TYPES: string[] = ["Image", "Group", "GeometricShape"];

export type DiagramItem = { id: string; name: string; altTextDescription: string };
type Placement = { left: number; top: number; name?: string };

function activeShapes(ctx: Excel.RequestContext): Excel.ShapeCollection {
  return ctx.workbook.worksheets.getActiveWorksheet().shapes;
}

/** Lists diagrams on the active sheet that were inserted by this add-in. */
export async function listDiagrams(): Promise<DiagramItem[]> {
  return Excel.run(async (ctx) => {
    const shapes = activeShapes(ctx);
    shapes.load(
      "items/id,items/name,items/type,items/altTextTitle,items/altTextDescription",
    );
    await ctx.sync();

    return shapes.items
      .filter(
        (shape) =>
          DIAGRAM_SHAPE_TYPES.includes(shape.type) &&
          shape.altTextTitle === ALT_TEXT_TITLE,
      )
      .map((shape) => ({
        id: shape.id,
        name: shape.name,
        // Excel may store line breaks as \r; the editor and the saved-code check use \n.
        altTextDescription: (shape.altTextDescription ?? "").replace(/\r\n?/g, "\n"),
      }));
  });
}

export async function onSheetActivated(handler: () => void): Promise<void> {
  return Excel.run(async (ctx) => {
    ctx.workbook.worksheets.onActivated.add(async () => handler());
    await ctx.sync();
  });
}

let selectionHandlers: OfficeExtension.EventHandlerResult<Excel.ShapeActivatedEventArgs>[] = [];
let selectionWatch: Promise<void> = Promise.resolve();

/**
 * Calls `handler` with the shape ID when one of the given shapes is selected
 * on the sheet. Handlers from the previous call are removed first. Calls are
 * queued so that overlapping refreshes do not leave duplicate handlers.
 */
export function watchDiagramSelection(
  ids: string[],
  handler: (id: string) => void,
): Promise<void> {
  const next = selectionWatch.then(async () => {
    const old = selectionHandlers;
    selectionHandlers = [];
    if (old.length > 0) {
      try {
        await Excel.run(old[0].context, async (ctx) => {
          for (const h of old) h.remove();
          await ctx.sync();
        });
      } catch {
        // Handlers of deleted shapes may fail to remove; they never fire again.
      }
    }
    if (ids.length === 0) {
      return;
    }
    await Excel.run(async (ctx) => {
      const shapes = activeShapes(ctx);
      const added = ids.map((id) =>
        shapes.getItem(id).onActivated.add(async (args) => handler(args.shapeId)),
      );
      await ctx.sync();
      selectionHandlers = added;
    });
  });
  selectionWatch = next.catch(() => {/* keep the queue going */});
  return next;
}

export function isSvgInsertSupported(): boolean {
  return !!Office.context.requirements?.isSetSupported("ImageCoercion", "1.2");
}

/**
 * Loads where a new shape should go: the replacement target's position and
 * name, or the active cell's top-left corner when there is no target.
 */
async function loadPlacement(
  ctx: Excel.RequestContext,
  replaceId?: string,
): Promise<Placement> {
  if (!replaceId) {
    const cell = ctx.workbook.getActiveCell();
    cell.load(["left", "top"]);
    await ctx.sync();
    return { left: cell.left, top: cell.top };
  }
  // Not reading the active cell here: it fails while a shape is selected,
  // which is typical when replacing a diagram.
  const target = activeShapes(ctx).getItemOrNullObject(replaceId);
  target.load(["isNullObject", "left", "top", "name"]);
  await ctx.sync();

  if (target.isNullObject) {
    throw new Error("Selected diagram no longer exists.");
  }
  return { left: target.left, top: target.top, name: target.name };
}

/** The width in points of a diagram on the active sheet, for keeping its size on replace. */
export function getDiagramWidth(id: string): Promise<number> {
  return Excel.run(async (ctx) => {
    const shape = activeShapes(ctx).getItemOrNullObject(id);
    shape.load(["isNullObject", "width"]);
    await ctx.sync();
    if (shape.isNullObject) {
      throw new Error("Selected diagram no longer exists.");
    }
    return shape.width;
  });
}

function applyShapeProps(
  shape: Excel.Shape,
  placement: Placement,
  mermaidCode: string,
) {
  shape.left = placement.left;
  shape.top = placement.top;
  if (placement.name) {
    shape.name = placement.name;
  }
  shape.altTextTitle = ALT_TEXT_TITLE;
  shape.altTextDescription = mermaidCode;
}

/** Adds a PNG/JPEG image and, when replacing, deletes the old shape in the same sync. */
export function insertImageShape(
  image: RasterImage,
  mermaidCode: string,
  replaceId?: string,
): Promise<string> {
  return Excel.run(async (ctx) => {
    const placement = await loadPlacement(ctx, replaceId);
    const shapes = activeShapes(ctx);

    const shape = shapes.addImage(image.base64);
    shape.width = image.width * PX_TO_PT;
    shape.height = image.height * PX_TO_PT;
    applyShapeProps(shape, placement, mermaidCode);
    shape.load("id");
    if (replaceId) {
      shapes.getItem(replaceId).delete();
    }
    await ctx.sync();
    return shape.id;
  });
}

function setFill(shape: Excel.Shape, fill: Fill) {
  if (fill) {
    shape.fill.setSolidColor(fill.color);
    shape.fill.transparency = fill.transparency;
  } else {
    shape.fill.clear();
  }
}

function setLine(shape: Excel.Shape, line: Line) {
  if (line) {
    shape.lineFormat.color = line.color;
    // Excel rejects fractional weights (InvalidArgument), so round to whole points.
    shape.lineFormat.weight = Math.max(1, Math.round(line.weight));
    shape.lineFormat.dashStyle = line.dashStyle;
  } else {
    shape.lineFormat.visible = false;
  }
}

function setText(shape: Excel.Shape, label: Label, verticalAlignment: "Middle" | "Top") {
  const frame = shape.textFrame;
  frame.autoSizeSetting = "AutoSizeNone";
  frame.leftMargin = frame.rightMargin = frame.topMargin = frame.bottomMargin = 0;
  frame.horizontalAlignment = "Center";
  frame.verticalAlignment = verticalAlignment;
  frame.textRange.text = label.text;
  frame.textRange.font.size = label.size;
  frame.textRange.font.color = label.color;
}

/**
 * Builds a flowchart from native shapes: geometric shapes for nodes and
 * subgraphs, connectors attached to them for edges, and text boxes for edge
 * labels, all grouped into one shape that carries the Mermaid code.
 */
export function insertNativeShapes(
  model: ShapeModel,
  mermaidCode: string,
  replaceId?: string,
): Promise<string> {
  return Excel.run(async (ctx) => {
    const placement = await loadPlacement(ctx, replaceId);
    const shapes = activeShapes(ctx);
    const all: Excel.Shape[] = [];
    const place = (shape: Excel.Shape, box: Box) => {
      shape.left = placement.left + box.left;
      shape.top = placement.top + box.top;
      shape.width = box.width;
      shape.height = box.height;
    };

    const nodes = new Map<string, { shape: Excel.Shape; box: Box; type: string }>();
    for (const node of model.nodes) {
      const shape = shapes.addGeometricShape(node.type);
      place(shape, node.box);
      setFill(shape, node.fill);
      setLine(shape, node.line);
      if (node.label.text) {
        setText(shape, node.label, node.labelPosition);
      }
      shape.load("connectionSiteCount");
      nodes.set(node.id, { shape, box: node.box, type: node.type });
      all.push(shape);
    }
    // Connection site counts are needed to attach the connectors.
    await ctx.sync();

    for (const edge of model.edges) {
      const shape = shapes.addLine(
        placement.left + edge.begin.x,
        placement.top + edge.begin.y,
        placement.left + edge.end.x,
        placement.top + edge.end.y,
        edge.connectorType,
      );
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      let beginSite: number | undefined;
      if (from && from.shape.connectionSiteCount > 0) {
        beginSite = connectionSite(from.box, edge.begin, from.shape.connectionSiteCount, from.type);
        shape.line.connectBeginShape(from.shape, beginSite);
      }
      if (to && to.shape.connectionSiteCount > 0) {
        // A self-loop needs two different sites, or the connector has no length.
        const exclude = from === to ? beginSite : undefined;
        shape.line.connectEndShape(
          to.shape,
          connectionSite(to.box, edge.end, to.shape.connectionSiteCount, to.type, exclude),
        );
      }
      shape.line.beginArrowheadStyle = edge.beginArrow;
      shape.line.endArrowheadStyle = edge.endArrow;
      setLine(shape, edge.line);
      all.push(shape);
    }

    for (const label of model.labels) {
      const shape = shapes.addTextBox(label.label.text);
      place(shape, label.box);
      setFill(shape, label.fill);
      setLine(shape, null);
      setText(shape, label.label, "Middle");
      all.push(shape);
    }

    if (all.length === 0) {
      throw new Error("The diagram has no shapes.");
    }
    const diagram = all.length > 1 ? shapes.addGroup(all) : all[0];
    applyShapeProps(diagram, placement, mermaidCode);
    diagram.load("id");
    if (replaceId) {
      shapes.getItem(replaceId).delete();
    }
    await ctx.sync();
    return diagram.id;
  });
}

/**
 * Inserts an SVG through setSelectedDataAsync. The new shape is found by
 * diffing shape IDs before and after insertion, and the old shape is deleted
 * only after the new one is in place.
 */
export async function insertSvgShape(
  image: SvgImage,
  mermaidCode: string,
  replaceId?: string,
): Promise<string> {
  const before = await Excel.run(async (ctx) => {
    const shapes = activeShapes(ctx);
    shapes.load("items/id");
    const placement = await loadPlacement(ctx, replaceId);
    return { ids: new Set(shapes.items.map((s) => s.id)), placement };
  });

  await insertSvgToSelection(image.svg);

  return Excel.run(async (ctx) => {
    const shapes = activeShapes(ctx);
    shapes.load("items/id");
    await ctx.sync();

    const added = shapes.items.filter((s) => !before.ids.has(s.id));
    if (added.length !== 1) {
      throw new Error("Could not identify the inserted shape.");
    }
    const shape = added[0];
    // Excel picks its own size for the inserted SVG. "Convert to Shape" scales
    // the shapes with the picture but keeps the font sizes, so the picture
    // must be at its actual size for the text to fit.
    if (image.width > 0 && image.height > 0) {
      shape.lockAspectRatio = false;
      shape.width = image.width * PX_TO_PT;
      shape.height = image.height * PX_TO_PT;
    }
    applyShapeProps(shape, before.placement, mermaidCode);
    await ctx.sync();

    if (replaceId) {
      const target = shapes.getItemOrNullObject(replaceId);
      target.load("isNullObject");
      await ctx.sync();
      if (!target.isNullObject) {
        target.delete();
        await ctx.sync();
      }
    }
    return shape.id;
  });
}

function insertSvgToSelection(svgStr: string): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.setSelectedDataAsync(
      svgStr,
      { coercionType: Office.CoercionType.XmlSvg },
      (asyncResult) => {
        if (asyncResult.status === Office.AsyncResultStatus.Failed) {
          reject(new Error(asyncResult.error.message));
        } else {
          resolve();
        }
      },
    );
  });
}
