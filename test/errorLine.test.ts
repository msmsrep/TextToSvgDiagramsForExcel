import { describe, expect, it } from "vitest";
import { errorSourceLine } from "../src/core/errorLine";

const jison = (line: number) => `Parse error on line ${line}:\n...A-->\n-----^\nExpecting 'NODE_STRING', got 'LINK'`;

describe("errorSourceLine", () => {
  it("reads the line of jison parse and lexical errors", () => {
    const code = "graph TD\nA-->B\nB--> -->\nC-->D";
    expect(errorSourceLine(code, jison(3))).toBe(2);
    expect(errorSourceLine(code, "Lexical error on line 2. Unrecognized text.")).toBe(1);
  });

  it("reads the line of Langium errors with columns", () => {
    const code = 'pie\n"a": 1\n"b" x';
    const message =
      "Parsing failed: Lexer error on line 3, column 5: unexpected character. " +
      "Parse error on line 3, column 6: Expecting token of type ':'";
    expect(errorSourceLine(code, message)).toBe(2);
  });

  it("returns undefined for messages without a line", () => {
    expect(errorSourceLine("graph TD\nA", "No diagram type detected")).toBeUndefined();
    expect(errorSourceLine("   ", jison(1))).toBeUndefined();
  });

  it("accounts for leading blank lines and indentation trimmed before rendering", () => {
    expect(errorSourceLine("\n\n  graph TD\nA-->B\nB--> -->", jison(3))).toBe(4);
  });

  it("accounts for removed comment lines", () => {
    expect(errorSourceLine("graph TD\n%% note\nA-->B\n  %% indented\nB--> -->", jison(3))).toBe(4);
  });

  it("accounts for removed front matter", () => {
    const code = "---\ntitle: Flow\n---\ngraph TD\nA-->B\nB--> -->";
    expect(errorSourceLine(code, jison(3))).toBe(5);
  });

  it("accounts for removed directives, including multi-line ones", () => {
    expect(errorSourceLine("%%{init: {}}%%\ngraph TD\nA-->B\nB--> -->", jison(3))).toBe(3);
    const multiLine = '%%{init: {\n  "theme": "dark"\n}}%%\ngraph TD\nB--> -->';
    expect(errorSourceLine(multiLine, jison(2))).toBe(4);
  });

  it("uses the last line for errors past the end of the code", () => {
    expect(errorSourceLine("graph TD\nA-->B[", jison(3))).toBe(1);
  });

  it("maps errors on blank lines to that line", () => {
    expect(errorSourceLine("graph TD\n\nA-->", jison(2))).toBe(1);
  });

  it("handles CRLF line breaks", () => {
    expect(errorSourceLine("graph TD\r\n%% c\r\nB--> -->", jison(2))).toBe(2);
  });
});
