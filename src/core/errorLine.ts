// mermaid's parsers report 1-based lines as "Parse error on line N:" (jison),
// "Lexical error on line N." (jison lexer) or "... error on line N, column M:"
// (Langium-based diagrams such as pie).
const ERROR_LINE_REGEX = /\b(?:Parse|Lexical|Lexer) error on line (\d+)/;

// The same patterns mermaid uses to strip the code before parsing it
// (preprocessDiagram in mermaid 11), so error lines can be mapped back.
// mermaid's front matter regex uses the "s" flag; [\s\S] does the same in ES2017.
const FRONT_MATTER_REGEX = /^-{3}\s*[\n\r]([\s\S]*?)[\n\r]-{3}\s*[\n\r]+/;
const DIRECTIVE_REGEX = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const COMMENT_LINE_REGEX = /^\s*%%(?!{)[^\n]+\n?/gm;

/** Text whose characters each remember the 0-based source line they came from. */
type TrackedText = { text: string; lines: number[] };

function track(source: string): TrackedText {
  const lines: number[] = [];
  let line = 0;
  for (const ch of source) {
    // for...of iterates code points; keep one entry per UTF-16 unit.
    for (let i = 0; i < ch.length; i++) lines.push(line);
    if (ch === "\n") line++;
  }
  return { text: source, lines };
}

/** Removes every match of the regex, keeping the line of each remaining character. */
function remove(t: TrackedText, regex: RegExp): TrackedText {
  const global = regex.global ? regex : new RegExp(regex.source, regex.flags + "g");
  let text = "";
  const lines: number[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = global.exec(t.text)) !== null) {
    text += t.text.slice(last, match.index);
    lines.push(...t.lines.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[0] === "") {
      global.lastIndex++;
    }
  }
  text += t.text.slice(last);
  lines.push(...t.lines.slice(last));
  return { text, lines };
}

function slice(t: TrackedText, start: number, end = t.text.length): TrackedText {
  return { text: t.text.slice(start, end), lines: t.lines.slice(start, end) };
}

// String#trimStart/trimEnd are ES2019; \s matches the same whitespace.
function trimStart(t: TrackedText): TrackedText {
  return slice(t, /^\s*/.exec(t.text)![0].length);
}

function trim(t: TrackedText): TrackedText {
  return trimStart(slice(t, 0, t.text.length - /\s*$/.exec(t.text)![0].length));
}

/**
 * Returns the 0-based line of `source` (the editor's text) that a mermaid
 * error message points at, or undefined when the message has no line.
 * `source` is trimmed before rendering, then mermaid removes front matter,
 * directives and comment lines, so the reported line is mapped back through
 * those removals.
 */
export function errorSourceLine(source: string, message: string): number | undefined {
  const match = ERROR_LINE_REGEX.exec(message);
  if (!match) {
    return undefined;
  }
  let t = trim(track(source.replace(/\r\n?/g, "\n")));
  t = remove(t, FRONT_MATTER_REGEX);
  t = remove(t, DIRECTIVE_REGEX);
  t = trimStart(remove(t, COMMENT_LINE_REGEX));
  if (t.lines.length === 0) {
    return undefined;
  }

  // Find where the reported line starts in the parsed text.
  const target = Number(match[1]) - 1;
  let offset = 0;
  for (let line = 0; line < target; line++) {
    const next = t.text.indexOf("\n", offset);
    if (next < 0) {
      // Past the end (errors at the end of input): use the last line.
      return t.lines[t.lines.length - 1];
    }
    offset = next + 1;
  }
  return t.lines[Math.min(offset, t.lines.length - 1)];
}
