import mermaid from "mermaid";

const GRAPH_ID = "mermaid-graph";

export function initMermaid() {
  // htmlLabels is disabled so labels are plain SVG text, which survives
  // rasterization and SVG insertion into Excel.
  // https://github.com/mermaid-js/mermaid-cli/issues/112
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    htmlLabels: false,
    flowchart: {
      useMaxWidth: false,
      htmlLabels: false,
    },
  });
}

export type FlowNode = {
  id: string;
  shape?: string;
  isGroup: boolean;
  domId?: string;
};
export type FlowEdge = {
  id: string;
  start: string;
  end: string;
  arrowTypeStart?: string;
  arrowTypeEnd?: string;
  pattern?: string;
};
export type FlowchartData = { nodes: FlowNode[]; edges: FlowEdge[] };

const FLOWCHART_TYPES = ["flowchart", "flowchart-v2", "flowchart-elk"];

/**
 * Parses the code and returns the flowchart's node and edge definitions
 * (shape types, arrow types), or null when it is not a flowchart.
 */
export async function getFlowchartData(code: string): Promise<FlowchartData | null> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  if (!FLOWCHART_TYPES.includes(diagram.type)) {
    return null;
  }
  const db = diagram.db as { getData(): FlowchartData };
  const { nodes, edges } = db.getData();
  return { nodes, edges };
}

/** Renders Mermaid code to an SVG string. */
export async function renderMermaid(code: string): Promise<string> {
  // Remove element with the same ID to avoid errors
  document.getElementById(GRAPH_ID)?.remove();
  const { svg } = await mermaid.render(GRAPH_ID, code);
  return svg;
}
