// Compares a generated Mermaid diagram with a reference one, for the text-to-Mermaid
// evaluation (desktop/tools/TextToMermaidEval). Both are read with mermaid's own parser;
// what is compared is the content: which steps lead to which, who sends what to whom
// and in which order, which task runs when. Labels are matched by wording, not by id.

/** What a parsed diagram (mermaidAPI.getDiagramFromText) says, as plain data. */
export function extract(diagram) {
  const db = diagram.db;
  if (diagram.type.startsWith("flowchart")) {
    return {
      kind: "flowchart",
      nodes: [...db.getVertices().values()].map((v) => ({ id: v.id, label: v.text || v.id })),
      edges: db.getEdges().map((e) => ({ from: e.start, to: e.end, label: e.text ?? "" })),
    };
  }
  if (diagram.type === "sequence") {
    const t = db.LINETYPE;
    const blocks = new Map([
      [t.ALT_START, "alt"], [t.OPT_START, "alt"], [t.ALT_ELSE, "else"],
      [t.LOOP_START, "loop"], [t.PAR_START, "par"], [t.PAR_AND, "and"],
    ]);
    const items = [];
    for (const m of db.getMessages()) {
      if (blocks.has(m.type)) {
        items.push({ block: blocks.get(m.type) });
      } else if (m.from !== undefined && m.to !== undefined && m.type !== t.NOTE) {
        items.push({ from: m.from, to: m.to, text: m.message ?? "" });
      }
    }
    return {
      kind: "sequence",
      actors: [...db.getActors().values()].map((a) => ({ id: a.name, label: a.description || a.name })),
      items,
    };
  }
  if (diagram.type === "gantt") {
    return {
      kind: "gantt",
      tasks: db.getTasks().map((task) => ({ label: task.task.trim(), start: day(task.startTime), end: day(task.endTime) })),
    };
  }
  return { kind: diagram.type };
}

/**
 * How well `got` matches `ref` (both from extract): score is an F1 between 0 and 1.
 * flowchart: (steps found) × (connections between the steps both diagrams have).
 * sequence: messages in order, with the same sender and receiver.
 * gantt: tasks with the same start and end.
 */
export function compare(ref, got) {
  if (ref.kind !== got.kind) {
    return { score: 0, precision: 0, recall: 0 };
  }
  switch (ref.kind) {
    case "flowchart": return compareFlowcharts(ref, got);
    case "sequence": return compareSequences(ref, got);
    case "gantt": return compareGantts(ref, got);
    default: return { score: 0, precision: 0, recall: 0 };
  }
}

const SEPARATOR = "\u0000";

function compareFlowcharts(ref, got) {
  const pairs = matchLabels(ref.nodes.map((n) => n.label), got.nodes.map((n) => n.label));
  const toRef = new Map(pairs.map(([r, g]) => [got.nodes[g].id, ref.nodes[r].id]));
  const kept = new Set(toRef.values());
  // Steps only one diagram has are skipped over, so that splitting a step in two
  // does not break the connections around it; the missing step costs under "nodes".
  const labelOf = (list) => new Map(list.map((n) => [n.id, n.label]));
  const refLabels = labelOf(ref.nodes);
  const refEdges = skeleton(ref.edges, refLabels, (id) => (kept.has(id) ? id : undefined));
  const gotEdges = skeleton(got.edges, labelOf(got.nodes), (id) => toRef.get(id));
  const shared = [...gotEdges.keys()].filter((key) => refEdges.has(key));
  const nodes = f1(pairs.length, got.nodes.length, ref.nodes.length);
  const edges = f1(shared.length, gotEdges.size, refEdges.size);

  // Conditions on the branches: "はい" must not sit where the reference has "いいえ".
  let agree = 0;
  let total = 0;
  const mismatches = [];
  for (const key of shared) {
    const [wanted, found] = [refEdges.get(key), gotEdges.get(key)];
    if (!wanted.label) {
      continue;
    }
    const verdict = sameCondition(wanted, found);
    if (verdict !== undefined) {
      total++;
      agree += verdict ? 1 : 0;
      if (!verdict) {
        const [from, to] = key.split(SEPARATOR).map((id) => refLabels.get(id));
        mismatches.push({ from, to, wanted: wanted.label, found: found.label, question: found.question });
      }
    }
  }
  return {
    score: nodes.f1 * edges.f1,
    precision: nodes.precision * edges.precision,
    recall: nodes.recall * edges.recall,
    nodes: nodes.f1,
    edges: edges.f1,
    conditionsAgree: agree,
    conditionsTotal: total,
    conditionMismatches: mismatches,
  };
}

/**
 * Edges between the nodes `map` keeps (id → shared id), walking through the others.
 * The value is the first label on the arrows on the way, and the node that label leaves (the question).
 */
function skeleton(edges, labels, map) {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) {
      out.set(e.from, []);
    }
    out.get(e.from).push(e);
  }
  const step = (e, label, question) => (label ? [e.to, label, question] : [e.to, e.label, e.label ? labels.get(e.from) : undefined]);
  const result = new Map();
  for (const start of out.keys()) {
    const from = map(start);
    if (from === undefined) {
      continue;
    }
    const seen = new Set([start]);
    const queue = out.get(start).map((e) => step(e));
    while (queue.length > 0) {
      const [id, label, question] = queue.shift();
      const to = map(id);
      if (to !== undefined) {
        const key = from + SEPARATOR + to;
        if (!result.has(key) || (!result.get(key).label && label)) {
          result.set(key, { label, question });
        }
        continue;
      }
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      for (const e of out.get(id) ?? []) {
        queue.push(step(e, label, question));
      }
    }
  }
  return result;
}

const YES = /^(はい|yes|y|ok|true|○|可)$/;
const NO = /^(いいえ|no|n|ng|false|×|不可)$/;
const NEGATED = /ない|なけれ|なし|ません|なかっ/;

/**
 * True or false when the two branch conditions ({label, question}) can be told apart;
 * undefined when they cannot.
 */
function sameCondition(wanted, found) {
  const a = normalize(wanted.label);
  const b = normalize(found.label);
  if (!b) {
    return false;
  }
  const answer = (s) => (YES.test(s) ? "yes" : NO.test(s) ? "no" : undefined);
  if (answer(a) && answer(b)) {
    // Answers only compare when they answer the same question ("成功？" and "失敗？" do not).
    if (similarity(wanted.question, found.question) < 0.6) {
      return undefined;
    }
    // "不備がある？ はい" is "不備がない？ いいえ".
    const flipped = NEGATED.test(wanted.question) !== NEGATED.test(found.question);
    return (answer(a) === answer(b)) !== flipped;
  }
  if (answer(a) || answer(b)) {
    return undefined;
  }
  if (NEGATED.test(a) !== NEGATED.test(b)) {
    return false;
  }
  const [x, y] = [content(a), content(b)];
  return x.includes(y) || y.includes(x) || similarity(wanted.label, found.label) >= 0.8;
}

function compareSequences(ref, got) {
  const pairs = matchLabels(ref.actors.map((a) => a.label), got.actors.map((a) => a.label));
  const toRef = new Map(pairs.map(([r, g]) => [got.actors[g].id, ref.actors[r].id]));
  const weight = (r, g) => {
    if (r.block || g.block) {
      return r.block === g.block ? 1 : 0;
    }
    return toRef.get(g.from) === r.from && toRef.get(g.to) === r.to ? 0.5 + 0.5 * similarity(r.text, g.text) : 0;
  };
  // The heaviest pairing that keeps the order (as in a longest common subsequence).
  const [n, m] = [ref.items.length, got.items.length];
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const w = weight(ref.items[i - 1], got.items[j - 1]);
      best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], w > 0 ? best[i - 1][j - 1] + w : 0);
    }
  }
  const result = f1(best[n][m], m, n);
  return { score: result.f1, precision: result.precision, recall: result.recall, participants: f1(pairs.length, got.actors.length, ref.actors.length).f1 };
}

function compareGantts(ref, got) {
  const pairs = matchLabels(ref.tasks.map((t) => t.label), got.tasks.map((t) => t.label));
  let credit = 0;
  for (const [r, g] of pairs) {
    const [wanted, found] = [ref.tasks[r], got.tasks[g]];
    // A day given without a length ("本番は10月10日") may be a milestone or a one-day task.
    const oneDay = wanted.end - wanted.start <= 1 && found.end - found.start <= 1;
    // "1か月" may be 30 or 31 days.
    const slack = wanted.end - wanted.start >= 28 ? 1 : 0;
    const sameEnd = Math.abs(wanted.end - found.end) <= slack || (oneDay && wanted.start === found.start);
    credit += (1 + (wanted.start === found.start ? 1 : 0) + (sameEnd ? 1 : 0)) / 3;
  }
  const result = f1(credit, got.tasks.length, ref.tasks.length);
  return { score: result.f1, precision: result.precision, recall: result.recall, tasks: f1(pairs.length, got.tasks.length, ref.tasks.length).f1 };
}

/** Days since 1970-01-01 of a local date. */
function day(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function f1(hit, found, wanted) {
  const precision = found === 0 ? 0 : hit / found;
  const recall = wanted === 0 ? 0 : hit / wanted;
  return { precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall) };
}

/** Pairs [i, j] of labels that say the same thing, each label used once, most alike first. */
function matchLabels(wanted, found) {
  const candidates = [];
  wanted.forEach((a, i) => found.forEach((b, j) => {
    const s = similarity(a, b);
    if (s >= 0.5) {
      candidates.push([s, i, j]);
    }
  }));
  candidates.sort((x, y) => y[0] - x[0]);
  const [usedA, usedB, pairs] = [new Set(), new Set(), []];
  for (const [, i, j] of candidates) {
    if (!usedA.has(i) && !usedB.has(j)) {
      usedA.add(i);
      usedB.add(j);
      pairs.push([i, j]);
    }
  }
  return pairs;
}

function normalize(text) {
  return (text ?? "").normalize("NFKC").toLowerCase().replace(/<br\s*\/?>/g, "").replace(/[\s、。，．,.?？!！・「」『』()（）:：;"'`]/gu, "");
}

/** Without hiragana: the kanji, katakana, letters and digits carry what a label is about. */
function content(normalized) {
  return normalized.replace(/[぀-ゟ]/g, "");
}

/**
 * 0 to 1: the share of characters two labels have in common, in order. Hiragana is left out
 * when both labels have other characters, so "在庫を確認する" and "在庫確認" count as the same.
 */
export function similarity(a, b) {
  let [x, y] = [normalize(a), normalize(b)];
  if (!x || !y) {
    return 0;
  }
  if (x === y) {
    return 1;
  }
  if (content(x) && content(y)) {
    [x, y] = [content(x), content(y)];
  }
  const row = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= y.length; j++) {
      const above = row[j];
      row[j] = x[i - 1] === y[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  const ratio = (2 * row[y.length]) / (x.length + y.length);
  // "アプリ" and "フードデリバリーのアプリ" name the same thing.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short) ? Math.max(ratio, 0.7) : ratio;
}
