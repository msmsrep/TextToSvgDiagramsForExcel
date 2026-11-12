// Checks Mermaid code with mermaid.parse in Node (jsdom stands in for the browser),
// for the text-to-Mermaid evaluation tool (desktop/tools/TextToMermaidEval).
// Talks over stdin/stdout, one JSON value per line (no server, no network):
//   "graph TD\n A-->B"               → {"valid":true,"type":"flowchart-v2"} or {"valid":false,"message":"..."}
//   {"fromText":"...","kind":"auto"} → {"code":"..."} or {"error":"..."} (the rule-based textToMermaid.ts)
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("");
for (const key of ["window", "document", "DOMParser", "Element", "HTMLElement", "SVGElement", "navigator"]) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true });
  }
}
const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false });

let textToMermaid;
/** Bundles src/core/textToMermaid.ts with esbuild the first time it is needed. */
async function loadTextToMermaid() {
  if (!textToMermaid) {
    const esbuild = await import("esbuild");
    const entry = fileURLToPath(new URL("../src/core/textToMermaid.ts", import.meta.url));
    const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", write: false });
    const source = Buffer.from(out.outputFiles[0].contents).toString("base64");
    ({ textToMermaid } = await import(`data:text/javascript;base64,${source}`));
  }
  return textToMermaid;
}

async function handle(request) {
  if (typeof request === "object" && request !== null && "fromText" in request) {
    try {
      return { code: (await loadTextToMermaid())(String(request.fromText), request.kind ?? "auto") };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  try {
    const { diagramType } = await mermaid.parse(String(request));
    return { valid: true, type: diagramType };
  } catch (e) {
    return { valid: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (line.trim()) {
    process.stdout.write(JSON.stringify(await handle(JSON.parse(line))) + "\n");
  }
}
