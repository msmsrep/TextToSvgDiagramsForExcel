import { beforeEach, describe, expect, it } from "vitest";
import {
  getDiagramWidth,
  insertImageShape,
  insertNativeShapes,
  insertSvgShape,
  isSvgInsertSupported,
  listDiagrams,
  onSheetActivated,
  watchDiagramSelection,
} from "../src/taskpane/excelShapes";
import type { ShapeModel, ShapeNode } from "../src/core/flowchartModel";
import { createFakeOffice, type FakeOffice, type ShapeState } from "./fakes/office";

const TITLE = "Mermaid Diagram";
const image = { base64: "AAAA", width: 200, height: 100 };
const svgImage = { svg: "<svg/>", width: 200, height: 100 };

let fake: FakeOffice;

function setup(...shapes: Partial<ShapeState>[]) {
  fake = createFakeOffice(shapes);
  fake.install();
}

describe("listDiagrams", () => {
  it("returns images and shape diagrams whose alt text title marks them as Mermaid diagrams", async () => {
    setup(
      { name: "Diagram 1", altTextTitle: TITLE, altTextDescription: "graph TD\nA-->B" },
      { name: "Photo", altTextTitle: "Other" },
      { name: "Shapes", type: "Group", altTextTitle: TITLE, altTextDescription: "graph LR\nA-->B" },
      { name: "Single", type: "GeometricShape", altTextTitle: TITLE, altTextDescription: "graph LR\nA" },
      { name: "Arrow", type: "Line", altTextTitle: TITLE },
      { name: "Diagram 2", altTextTitle: TITLE, altTextDescription: "pie" },
    );

    expect(await listDiagrams()).toEqual([
      { id: "shape-1", name: "Diagram 1", altTextDescription: "graph TD\nA-->B" },
      { id: "shape-3", name: "Shapes", altTextDescription: "graph LR\nA-->B" },
      { id: "shape-4", name: "Single", altTextDescription: "graph LR\nA" },
      { id: "shape-6", name: "Diagram 2", altTextDescription: "pie" },
    ]);
  });

  it("returns an empty description when the shape has none", async () => {
    setup({ name: "D", altTextTitle: TITLE, altTextDescription: undefined as unknown as string });
    expect(await listDiagrams()).toEqual([{ id: "shape-1", name: "D", altTextDescription: "" }]);
  });

  it("converts \\r\\n and \\r line breaks in the code to \\n", async () => {
    setup({ name: "D", altTextTitle: TITLE, altTextDescription: "graph TD\r\nA-->B\rB-->C" });
    expect(await listDiagrams()).toEqual([{ id: "shape-1", name: "D", altTextDescription: "graph TD\nA-->B\nB-->C" }]);
  });

  it("returns an empty list when the sheet has no diagrams", async () => {
    setup();
    expect(await listDiagrams()).toEqual([]);
  });
});

describe("onSheetActivated", () => {
  it("registers a handler that is called when a worksheet is activated", async () => {
    setup();
    let calls = 0;
    await onSheetActivated(() => calls++);

    expect(fake.activatedHandlers).toHaveLength(1);
    await fake.activatedHandlers[0]();
    expect(calls).toBe(1);
  });
});

describe("watchDiagramSelection", () => {
  it("calls the handler with the ID of a watched shape when it is selected", async () => {
    setup({ name: "D1" }, { name: "D2" }, { name: "Other" });
    const selected: string[] = [];
    await watchDiagramSelection(["shape-1", "shape-2"], (id) => selected.push(id));

    await fake.selectShape("shape-2");
    await fake.selectShape("shape-3");
    await fake.selectShape("shape-1");
    expect(selected).toEqual(["shape-2", "shape-1"]);
  });

  it("removes the previous handlers before watching the new shapes", async () => {
    setup({ name: "D1" }, { name: "D2" });
    const selected: string[] = [];
    await watchDiagramSelection(["shape-1"], (id) => selected.push(`old ${id}`));
    await watchDiagramSelection(["shape-1", "shape-2"], (id) => selected.push(id));

    await fake.selectShape("shape-1");
    await fake.selectShape("shape-2");
    expect(selected).toEqual(["shape-1", "shape-2"]);
    expect(fake.shapeHandlers.get("shape-1")?.size).toBe(1);
  });

  it("leaves no duplicate handlers when calls overlap", async () => {
    setup({ name: "D1" });
    await Promise.all([
      watchDiagramSelection(["shape-1"], () => {}),
      watchDiagramSelection(["shape-1"], () => {}),
      watchDiagramSelection(["shape-1"], () => {}),
    ]);
    expect(fake.shapeHandlers.get("shape-1")?.size).toBe(1);
  });

  it("removes all handlers when given no shapes", async () => {
    setup({ name: "D1" });
    let calls = 0;
    await watchDiagramSelection(["shape-1"], () => calls++);
    await watchDiagramSelection([], () => calls++);

    await fake.selectShape("shape-1");
    expect(calls).toBe(0);
  });

  it("keeps working after a failed call", async () => {
    setup({ name: "D1" });
    await expect(watchDiagramSelection(["missing"], () => {})).rejects.toThrow("ItemNotFound");

    let calls = 0;
    await watchDiagramSelection(["shape-1"], () => calls++);
    await fake.selectShape("shape-1");
    expect(calls).toBe(1);
  });
});

describe("isSvgInsertSupported", () => {
  beforeEach(() => setup());

  it("is true when ImageCoercion 1.2 is supported", () => {
    expect(isSvgInsertSupported()).toBe(true);
    expect(fake.Office.context.requirements.isSetSupported).toHaveBeenCalledWith("ImageCoercion", "1.2");
  });

  it("is false when ImageCoercion 1.2 is not supported", () => {
    fake.setSvgSupported(false);
    expect(isSvgInsertSupported()).toBe(false);
  });
});

describe("getDiagramWidth", () => {
  it("returns the diagram's width in points", async () => {
    setup({ altTextTitle: TITLE, width: 321 });
    expect(await getDiagramWidth("shape-1")).toBe(321);
  });

  it("fails when the diagram no longer exists", async () => {
    setup();
    await expect(getDiagramWidth("missing")).rejects.toThrow("Selected diagram no longer exists.");
  });
});

describe("insertImageShape", () => {
  it("adds the image at the active cell with the SVG size converted to points", async () => {
    setup();
    const id = await insertImageShape(image, "graph TD\nA-->B");

    const shape = fake.shapes.find((s) => s.id === id)!;
    expect(shape).toMatchObject({
      base64: "AAAA",
      left: 10,
      top: 20,
      width: 150,
      height: 75,
      altTextTitle: TITLE,
      altTextDescription: "graph TD\nA-->B",
      name: `Default ${id}`,
    });
  });

  it("replaces the target shape, taking over its position and name", async () => {
    setup({ name: "My diagram", altTextTitle: TITLE, left: 111, top: 222 });
    const id = await insertImageShape(image, "pie", "shape-1");

    expect(fake.shapes.map((s) => s.id)).toEqual([id]);
    expect(fake.shapes[0]).toMatchObject({ left: 111, top: 222, name: "My diagram", altTextDescription: "pie" });
  });

  it("adds the new shape and deletes the old one in a single sync", async () => {
    setup({ altTextTitle: TITLE });
    await insertImageShape(image, "pie", "shape-1");

    const add = fake.ops.find((o) => o.op === "addImage")!;
    const del = fake.ops.find((o) => o.op === "delete")!;
    expect(add.batch).toBe(del.batch);
    expect(fake.syncCount).toBe(add.batch + 1);
  });

  it("fails without adding anything when the target no longer exists", async () => {
    setup({ altTextTitle: TITLE });
    await expect(insertImageShape(image, "pie", "missing")).rejects.toThrow(
      "Selected diagram no longer exists.",
    );
    expect(fake.shapes.map((s) => s.id)).toEqual(["shape-1"]);
    expect(fake.ops).toEqual([]);
  });
});

describe("insertSvgShape", () => {
  it("inserts through setSelectedDataAsync as XmlSvg and moves the new shape to the active cell", async () => {
    setup({ name: "Unrelated" });
    const id = await insertSvgShape(svgImage, "graph TD\nA-->B");

    expect(fake.Office.context.document.setSelectedDataAsync).toHaveBeenCalledWith(
      "<svg/>",
      { coercionType: "xmlSvg" },
      expect.any(Function),
    );
    const shape = fake.shapes.find((s) => s.id === id)!;
    expect(shape).toMatchObject({
      left: 10,
      top: 20,
      altTextTitle: TITLE,
      altTextDescription: "graph TD\nA-->B",
      name: `Default ${id}`,
    });
    expect(fake.shapes.find((s) => s.name === "Unrelated")).toMatchObject({ altTextTitle: "" });
  });

  it("sizes the new shape to the SVG's actual size so converted text fits", async () => {
    setup();
    const id = await insertSvgShape(svgImage, "pie");

    expect(fake.shapes.find((s) => s.id === id)).toMatchObject({
      lockAspectRatio: false,
      width: 150,
      height: 75,
    });
  });

  it("keeps Excel's size when the SVG's size is unknown", async () => {
    setup();
    const id = await insertSvgShape({ svg: "<svg/>", width: 0, height: 0 }, "pie");

    expect(fake.shapes.find((s) => s.id === id)).not.toHaveProperty("lockAspectRatio");
  });

  it("replaces the target shape after the new one is in place", async () => {
    setup({ name: "My diagram", altTextTitle: TITLE, left: 111, top: 222 });
    const id = await insertSvgShape(svgImage, "pie", "shape-1");

    expect(fake.shapes.map((s) => s.id)).toEqual([id]);
    expect(fake.shapes[0]).toMatchObject({ left: 111, top: 222, name: "My diagram", altTextDescription: "pie" });
    const kinds = fake.ops.map((o) => o.op);
    expect(kinds).toEqual(["setSelectedData", "delete"]);
  });

  it("does not delete anything when the target disappeared during insertion", async () => {
    setup({ altTextTitle: TITLE });
    fake.Office.context.document.setSelectedDataAsync.mockImplementationOnce(
      (_data: string, _opts: unknown, cb: (r: unknown) => void) => {
        fake.shapes.splice(0, 1);
        fake.shapes.push({
          id: "new", name: "Graphic", type: "Image", altTextTitle: "", altTextDescription: "",
          left: 0, top: 0, width: 1, height: 1,
        });
        cb({ status: "succeeded" });
      },
    );

    expect(await insertSvgShape(svgImage, "pie", "shape-1")).toBe("new");
    expect(fake.ops.filter((o) => o.op === "delete")).toEqual([]);
  });

  it("fails before inserting when the target no longer exists", async () => {
    setup();
    await expect(insertSvgShape(svgImage, "pie", "missing")).rejects.toThrow(
      "Selected diagram no longer exists.",
    );
    expect(fake.Office.context.document.setSelectedDataAsync).not.toHaveBeenCalled();
  });

  it("reports the setSelectedDataAsync error and keeps the original shape", async () => {
    setup({ altTextTitle: TITLE });
    fake.svgInsert.result = "fail";
    fake.svgInsert.errorMessage = "Not allowed";

    await expect(insertSvgShape(svgImage, "pie", "shape-1")).rejects.toThrow("Not allowed");
    expect(fake.shapes.map((s) => s.id)).toEqual(["shape-1"]);
  });

  it("ignores other kinds of shapes added during insertion", async () => {
    setup();
    fake.Office.context.document.setSelectedDataAsync.mockImplementationOnce(
      (_data: string, _opts: unknown, cb: (r: unknown) => void) => {
        for (const [id, type] of [["chart", "Chart"], ["svg", "Image"]]) {
          fake.shapes.push({
            id, name: id, type, altTextTitle: "", altTextDescription: "", left: 0, top: 0, width: 1, height: 1,
          });
        }
        cb({ status: "succeeded" });
      },
    );

    expect(await insertSvgShape(svgImage, "pie")).toBe("svg");
    expect(fake.shapes.find((s) => s.id === "chart")).toMatchObject({ altTextTitle: "" });
  });

  it("deletes the new shape when it cannot be set up, keeping the original", async () => {
    setup({ altTextTitle: TITLE });
    // The placement and the shape list load; setting up the new shape fails.
    fake.failSyncAfter(2);

    await expect(insertSvgShape(svgImage, "pie", "shape-1")).rejects.toThrow("Sync failed");
    expect(fake.shapes.map((s) => s.id)).toEqual(["shape-1"]);
  });

  it.each([0, 2])("fails when %i shapes appear instead of one, keeping the original", async (n) => {
    setup({ altTextTitle: TITLE });
    fake.svgInsert.addShapes = n;

    await expect(insertSvgShape(svgImage, "pie", "shape-1")).rejects.toThrow(
      "Could not identify the inserted shape.",
    );
    expect(fake.shapes.some((s) => s.id === "shape-1")).toBe(true);
  });
});

describe("insertNativeShapes", () => {
  const label = (text: string) => ({ text, size: 12, color: "#333333" });
  const node = (id: string, left: number, extra: Partial<ShapeNode> = {}): ShapeNode => ({
    id,
    type: "Rectangle",
    box: { left, top: 10, width: 40, height: 20 },
    fill: { color: "#ECECFF", transparency: 0 },
    line: { color: "#9370DB", weight: 0.75, dashStyle: "Solid" },
    label: label(id),
    labelPosition: "Middle",
    ...extra,
  });
  // S contains A and B; A -> B ("Yes") goes from A's right side to B's left side.
  const model: ShapeModel = {
    nodes: [
      node("S", 0, { box: { left: 0, top: 0, width: 200, height: 40 }, labelPosition: "Top" }),
      node("A", 10),
      node("B", 100, { type: "Diamond" }),
    ],
    edges: [{
      from: "A",
      to: "B",
      begin: { x: 50, y: 20 },
      end: { x: 100, y: 20 },
      beginArrow: "None",
      endArrow: "Triangle",
      line: { color: "#333333", weight: 2.63, dashStyle: "Dash" },
      connectorType: "Straight",
    }],
    labels: [{ box: { left: 65, top: 15, width: 20, height: 10 }, fill: null, label: label("Yes") }],
  };
  const byId = (id: string) => fake.allShapes.find((s) => s.id === id)!;

  it("creates subgraphs, nodes, connectors and labels in z-order and groups them", async () => {
    setup();
    const id = await insertNativeShapes(model, "graph LR\nA-->B");

    expect(fake.ops.map((o) => o.op)).toEqual([
      "addGeometricShape", "addGeometricShape", "addGeometricShape", "addLine", "addTextBox", "addGroup",
    ]);
    expect(fake.shapes.map((s) => s.id)).toEqual([id]);
    expect(byId(id)).toMatchObject({
      type: "Group",
      members: ["shape-1", "shape-2", "shape-3", "shape-4", "shape-5"],
      left: 10,
      top: 20,
      altTextTitle: TITLE,
      altTextDescription: "graph LR\nA-->B",
    });
  });

  it("places shapes relative to the active cell with their fill, outline and centered text", async () => {
    setup();
    await insertNativeShapes(model, "graph LR\nA-->B");

    expect(byId("shape-2")).toMatchObject({
      geometricShapeType: "Rectangle",
      left: 20,
      top: 30,
      width: 40,
      height: 20,
      fill: { color: "#ECECFF", transparency: 0 },
      // Excel only accepts whole-point weights.
      lineFormat: { color: "#9370DB", weight: 1, dashStyle: "Solid" },
      textFrame: {
        autoSizeSetting: "AutoSizeNone",
        leftMargin: 0,
        rightMargin: 0,
        topMargin: 0,
        bottomMargin: 0,
        horizontalAlignment: "Center",
        verticalAlignment: "Middle",
        text: "A",
        fontSize: 12,
        fontColor: "#333333",
      },
    });
    expect(byId("shape-1").textFrame).toMatchObject({ text: "S", verticalAlignment: "Top" });
    expect(byId("shape-3").geometricShapeType).toBe("Diamond");
  });

  it("attaches connectors to the nearest connection sites with arrowheads and line style", async () => {
    setup();
    await insertNativeShapes(model, "graph LR\nA-->B");

    expect(byId("shape-4")).toMatchObject({
      lineFormat: { color: "#333333", weight: 3, dashStyle: "Dash" },
      line: {
        connectorType: "Straight",
        begin: { left: 60, top: 40 },
        end: { left: 110, top: 40 },
        // Sites run counterclockwise from the top: 1 = left, 3 = right.
        beginShape: "shape-2",
        beginSite: 3,
        endShape: "shape-3",
        endSite: 1,
        beginArrowheadStyle: "None",
        endArrowheadStyle: "Triangle",
      },
    });
  });

  it("adds edge labels as borderless text boxes", async () => {
    setup();
    await insertNativeShapes(model, "graph LR\nA-->B");

    expect(byId("shape-5")).toMatchObject({
      type: "TextBox",
      left: 75,
      top: 35,
      fill: { cleared: true },
      lineFormat: { visible: false },
      textFrame: { text: "Yes", horizontalAlignment: "Center", verticalAlignment: "Middle" },
    });
  });

  it("adds connectors only after the nodes' connection sites are loaded", async () => {
    setup();
    await insertNativeShapes(model, "graph LR\nA-->B");

    const nodeBatch = fake.ops.find((o) => o.op === "addGeometricShape")!.batch;
    const lineBatch = fake.ops.find((o) => o.op === "addLine")!.batch;
    expect(lineBatch).toBe(nodeBatch + 1);
  });

  it("uses the measured connection sites of shapes whose sites do not start at the top", async () => {
    setup();
    // Excel's hexagon has six sites starting at the right: 3 is the left vertex.
    fake.siteCounts.Hexagon = 6;
    const hex = node("B", 100, { type: "Hexagon" });
    await insertNativeShapes({ ...model, nodes: [model.nodes[1], hex] }, "graph LR\nA-->B");

    expect(byId("shape-3").line).toMatchObject({ endShape: "shape-2", endSite: 3 });
  });

  it("attaches the two ends of a self-loop to different sites", async () => {
    setup();
    // Both ends leave A's bottom (site 2); the end is right of the start.
    const loop = { ...model.edges[0], to: "A", begin: { x: 25, y: 30 }, end: { x: 35, y: 30 }, connectorType: "Elbow" as const };
    await insertNativeShapes({ ...model, edges: [loop] }, "graph LR\nA-->A");

    expect(byId("shape-4").line).toMatchObject({
      beginShape: "shape-2",
      beginSite: 2,
      endShape: "shape-2",
      endSite: 3,
    });
  });

  it("leaves a connector end unattached when its node is missing", async () => {
    setup();
    const edge = { ...model.edges[0], to: "Z" };
    await insertNativeShapes({ ...model, edges: [edge] }, "graph LR");

    const line = byId("shape-4").line!;
    expect(line.beginShape).toBe("shape-2");
    expect(line.endShape).toBeUndefined();
  });

  it("replaces the target in the final sync, taking over its position and name", async () => {
    setup({ name: "My diagram", altTextTitle: TITLE, left: 111, top: 222 });
    const id = await insertNativeShapes(model, "graph LR\nA-->B", "shape-1");

    expect(fake.shapes.map((s) => s.id)).toEqual([id]);
    expect(byId(id)).toMatchObject({ left: 111, top: 222, name: "My diagram" });
    expect(byId("shape-3")).toMatchObject({ left: 121, top: 232 });
    const group = fake.ops.find((o) => o.op === "addGroup")!;
    const del = fake.ops.find((o) => o.op === "delete")!;
    expect(del.batch).toBe(group.batch);
  });

  it("does not group a single shape and marks it as the diagram", async () => {
    setup();
    const id = await insertNativeShapes({ nodes: [node("A", 0)], edges: [], labels: [] }, "graph LR\nA");

    expect(fake.ops.map((o) => o.op)).toEqual(["addGeometricShape"]);
    expect(byId(id)).toMatchObject({ type: "GeometricShape", altTextTitle: TITLE, left: 10, top: 20 });
  });

  it("clears the fill, hides the outline and skips text when the node has none", async () => {
    setup();
    const plain = node("A", 0, { fill: null, line: null, label: label("") });
    const id = await insertNativeShapes({ nodes: [plain], edges: [], labels: [] }, "graph LR\nA");

    expect(byId(id)).toMatchObject({ fill: { cleared: true }, lineFormat: { visible: false } });
    expect(byId(id).textFrame).toBeUndefined();
  });

  it.each([1, 2])("deletes the shapes already added when the sync after %i fails", async (n) => {
    setup({ name: "Unrelated" });
    // Sync 1 loads the placement, sync 2 adds the nodes and sync 3 the rest.
    fake.failSyncAfter(n);

    await expect(insertNativeShapes(model, "graph LR")).rejects.toThrow("Sync failed");
    expect(fake.shapes.map((s) => s.name)).toEqual(["Unrelated"]);
  });

  it("keeps the diagram being replaced when adding the nodes fails", async () => {
    setup({ name: "Target", altTextTitle: TITLE });
    fake.failSyncAfter(1);

    await expect(insertNativeShapes(model, "graph LR", "shape-1")).rejects.toThrow("Sync failed");
    expect(fake.shapes.map((s) => s.name)).toEqual(["Target"]);
  });

  it("fails when the model has no shapes", async () => {
    setup();
    await expect(insertNativeShapes({ nodes: [], edges: [], labels: [] }, "graph LR")).rejects.toThrow(
      "The diagram has no shapes.",
    );
  });
});

describe("replacing while a shape is selected", () => {
  it("does not read the active cell, which Excel refuses while a shape is selected", async () => {
    setup({ name: "My diagram", altTextTitle: TITLE, left: 111, top: 222 });
    fake.ctx.workbook.getActiveCell = () => {
      throw new Error("The current selection is invalid for this operation.");
    };

    const id = await insertImageShape(image, "pie", "shape-1");
    expect(fake.shapes.find((s) => s.id === id)).toMatchObject({ left: 111, top: 222 });
  });
});
