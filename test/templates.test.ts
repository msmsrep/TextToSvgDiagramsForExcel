import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../src/taskpane/templates";

describe("TEMPLATES", () => {
  it("has unique ids and labels", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.label)).size).toBe(TEMPLATES.length);
  });

  it.each(TEMPLATES.map((t) => [t.id, t.code]))("%s starts with its diagram keyword", (_id, code) => {
    expect(code).toBe(code.trim());
    expect(code.split("\n")[0]).toMatch(
      /^(graph TD|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|gantt|pie|mindmap|timeline)$/,
    );
  });
});
