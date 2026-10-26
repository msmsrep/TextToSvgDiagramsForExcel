import { afterEach, describe, expect, it } from "vitest";
import { byId } from "../src/taskpane/dom";
import { errorMessage } from "../src/core/util";

describe("byId", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the element with the given ID", () => {
    document.body.innerHTML = '<div id="target"></div>';
    expect(byId("target")).toBe(document.getElementById("target"));
  });

  it("throws when the element does not exist", () => {
    expect(() => byId("missing")).toThrow("Element #missing not found.");
  });
});

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorMessage("text")).toBe("text");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
