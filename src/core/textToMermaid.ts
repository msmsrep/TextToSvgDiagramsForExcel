import { t } from "./messages";

export type TextKind = "auto" | "flowchart" | "sequence";

/** A non-empty line of the input: its 1-based number, indentation and text without the bullet. */
type Line = { number: number; indent: number; bullet: boolean; text: string };

/** A sequence message: sender, receiver, text and whether it is a reply (dashed). */
type Message = { from: string; to: string; text: string; reply: boolean };

// "->", "-->", "->>", "=>", "→", "⇒" and the like.
const ARROW = /\s*(?:-+>>?|=+>|[→⇒➡⟶➔])\s*/;
// "-", "*", "・", "1.", "1)", "①", "(1)" at the start of a line.
const BULLET = /^(?:[-*+・•●○◆■□]|\d+[.)．、]|[①-⑳]|[(（]\d+[)）])\s*/;
// Words that only join steps: "まず", "次に", "then", ...
const CONNECTIVE =
  /^(?:まず(?:は)?|最初に|はじめに|初めに|次に|その後|そのあと|それから|そして|続いて|最後に|最終的に|終わりに|first(?:ly)?|then|next|after that|and then|finally|lastly)(?:\s*[、,，]\s*|\s+|(?=\S))/i;
// "顧客が店員に注文する", "店員から顧客へ商品を渡す".
const JA_MESSAGE = /^(.+?)(?:から|が)(.+?)(?:へ|に)[、,]?\s*(.+)$/;
const REPLY = /返|応答|回答|reply|respond|return/i;

/** Label width (in full-width characters) before it wraps. */
const WRAP_WIDTH = 16;

/**
 * Builds Mermaid code from plain text with fixed rules (no AI):
 * - sequence: every line is a message, "A -> B: message" or "AがBに〇〇する"
 * - flowchart from arrows: "A -> B -> C", with "A -> B: label" for an edge label
 * - flowchart from an indented list: each item points to its children
 * - otherwise a flowchart of steps, one per line or sentence
 * "auto" picks sequence only when there are two or more lines and all are messages.
 */
export function textToMermaid(text: string, kind: TextKind = "auto"): string {
  const lines = parseLines(text);
  if (lines.length === 0) {
    throw new Error(t("textEmpty"));
  }

  if (kind === "sequence") {
    return sequence(
      lines.map((line) => parseMessage(line.text) ?? fail(line)),
    );
  }
  if (kind === "auto" && lines.length >= 2) {
    const messages = lines.map((line) => parseMessage(line.text));
    if (messages.every((m) => m !== undefined)) {
      return sequence(messages as Message[]);
    }
  }

  if (lines.some((line) => ARROW.test(line.text))) {
    return arrowFlowchart(lines);
  }
  if (lines.some((line) => line.indent > lines[0].indent)) {
    return treeFlowchart(lines);
  }
  return stepFlowchart(lines);
}

const fail = (line: Line): never => {
  throw new Error(t("textNotMessage", { line: line.number }));
};

function parseLines(text: string): Line[] {
  const lines: Line[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, i) => {
      // A tab counts as four spaces, a full-width space as two.
      const expanded = raw.replace(/\t/g, "    ").replace(/　/g, "  ");
      const indent = /^\s*/.exec(expanded)![0].length;
      const trimmed = expanded.trim();
      const body = trimmed.replace(BULLET, "");
      if (body) {
        lines.push({ number: i + 1, indent, bullet: body !== trimmed, text: body });
      }
    });
  return lines;
}

// ── Sequence diagram ──────────────────────────────────────────────────────

function parseMessage(text: string): Message | undefined {
  const arrow = splitArrows(text);
  if (arrow.length === 2) {
    const colon = /[:：]/.exec(arrow[1]);
    if (!colon) {
      return undefined;
    }
    const [from, to, message] = [arrow[0], arrow[1].slice(0, colon.index), arrow[1].slice(colon.index + 1)].map(clean);
    return from && to && message ? { from, to, text: message, reply: REPLY.test(message) } : undefined;
  }
  if (arrow.length > 2) {
    return undefined;
  }
  const match = JA_MESSAGE.exec(stripConnective(text));
  if (!match) {
    return undefined;
  }
  const [from, to, message] = match.slice(1).map(clean);
  // "AがBに" with a sentence as the receiver ("申請書を経理に") is a step, not a message.
  if (!from || !to || !message || /[をはで]|たら|れば/.test(to) || /[をはで、]/.test(from)) {
    return undefined;
  }
  return { from, to, text: message, reply: REPLY.test(message) };
}

function sequence(messages: Message[]): string {
  const ids = new Map<string, string>();
  const participants: string[] = [];
  const id = (name: string) => {
    let value = ids.get(name);
    if (!value) {
      value = `P${ids.size + 1}`;
      ids.set(name, value);
      participants.push(`    participant ${value} as ${sequenceText(name)}`);
    }
    return value;
  };
  const body = messages.map(
    (m) => `    ${id(m.from)}${m.reply ? "-->>" : "->>"}${id(m.to)}: ${sequenceText(m.text)}`,
  );
  return ["sequenceDiagram", ...participants, ...body].join("\n");
}

/** Semicolons and "#" end or escape sequence text, so write them as entities. */
function sequenceText(text: string): string {
  return text.replace(/[#;]/g, (c) => (c === "#" ? "#35;" : "#59;"));
}

// ── Flowcharts ────────────────────────────────────────────────────────────

/** Declares nodes once per label, with an ID and the label the first time. */
function nodeTable() {
  const ids = new Map<string, string>();
  let count = 0;
  return {
    /** A node for the label, shared by every use of the same label. */
    shared(label: string) {
      const id = ids.get(label);
      if (id) {
        return id;
      }
      const newId = `n${++count}`;
      ids.set(label, newId);
      return `${newId}["${flowchartLabel(label)}"]`;
    },
    /** A new node, even when another one has the same label. */
    fresh(label: string) {
      return { id: `n${++count}`, text: `n${count}["${flowchartLabel(label)}"]` };
    },
  };
}

function arrowFlowchart(lines: Line[]): string {
  const nodes = nodeTable();
  const out = ["graph TD"];
  for (const line of lines) {
    const parts = splitArrows(line.text);
    // "A -> B: label" labels the edge.
    let label = "";
    if (parts.length === 2) {
      const colon = /[:：]/.exec(parts[1]);
      if (colon) {
        label = clean(parts[1].slice(colon.index + 1));
        parts[1] = parts[1].slice(0, colon.index);
      }
    }
    const names = parts.map(clean).filter(Boolean);
    if (names.length === 1) {
      out.push(`    ${nodes.shared(names[0])}`);
      continue;
    }
    const arrow = label ? `-->|"${edgeText(label)}"|` : "-->";
    let chain = nodes.shared(names[0]);
    for (const name of names.slice(1)) {
      chain += ` ${arrow} ${nodes.shared(name)}`;
    }
    out.push(`    ${chain}`);
  }
  return out.join("\n");
}

function treeFlowchart(lines: Line[]): string {
  const nodes = nodeTable();
  const out = ["graph TD"];
  // The open ancestors of the current line, innermost last.
  const stack: { indent: number; id: string }[] = [];
  for (const line of lines) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) {
      stack.pop();
    }
    const node = nodes.fresh(clean(line.text));
    const parent = stack[stack.length - 1];
    out.push(parent ? `    ${parent.id} --> ${node.text}` : `    ${node.text}`);
    stack.push({ indent: line.indent, id: node.id });
  }
  return out.join("\n");
}

function stepFlowchart(lines: Line[]): string {
  let steps = ([] as string[]).concat(...lines.map((line) => splitSentences(line.text)));
  // A single sentence: "申請書を作成し、上長が承認し、経理が支払う".
  if (steps.length === 1) {
    const parts = steps[0].split(/\s*[、，,]\s*/).map(clean).filter(Boolean);
    if (parts.length >= 2) {
      steps = parts.map(toPlainForm);
    }
  }
  const nodes = nodeTable();
  const ids = steps.map((step) => nodes.fresh(step));
  if (ids.length === 1) {
    return ["graph TD", `    ${ids[0].text}`].join("\n");
  }
  const out = ["graph TD"];
  ids.forEach((node, i) => {
    if (i > 0) {
      out.push(`    ${i === 1 ? ids[0].text : ids[i - 1].id} --> ${node.text}`);
    }
  });
  return out.join("\n");
}

/** Sentences of a line, ending at "。", "." followed by a space, "!" or "?". */
function splitSentences(text: string): string[] {
  // No lookbehind: the shared code also runs in older WebViews (ES2017).
  return text
    .replace(/[。．！？!?]/g, "$&\n")
    .replace(/\.\s+/g, ".\n")
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

/** "作成し" → "作成する": a step cut at "、" ends in the continuative form. */
function toPlainForm(step: string): string {
  return step.replace(/([一-鿿゠-ヿ])し(?:て)?$/, "$1する");
}

// ── Text helpers ──────────────────────────────────────────────────────────

function splitArrows(text: string): string[] {
  return text.split(new RegExp(ARROW.source, "g"));
}

function stripConnective(text: string): string {
  return text.replace(CONNECTIVE, "");
}

/** Trims a label and drops joining words and the sentence's final period. */
function clean(text: string): string {
  return stripConnective(text.trim()).replace(/[。．.]+$/, "").trim();
}

function flowchartLabel(text: string): string {
  return wrap(text).map(edgeText).join("<br>");
}

function edgeText(text: string): string {
  return text.replace(/"/g, "#quot;");
}

/** Width of a character: full-width ones count 1, others 0.5. */
const charWidth = (c: string) => (/[\u0000-ÿ｡-ﾟ]/.test(c) ? 0.5 : 1);

/** Splits a long label into lines, preferring breaks after "、" or spaces. */
export function wrap(text: string, width = WRAP_WIDTH): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest) {
    let w = 0;
    let end = 0;
    let lastBreak = -1;
    for (const c of rest) {
      if (w + charWidth(c) > width) break;
      w += charWidth(c);
      end += c.length;
      if (/[、，,。\s]/.test(c)) lastBreak = end;
    }
    if (end >= rest.length) {
      lines.push(rest);
      break;
    }
    const cut = lastBreak > 0 ? lastBreak : end;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return lines;
}
