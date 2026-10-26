// User-facing messages from the shared code, in English and Japanese.
// mermaid's own error messages and diagram type names stay in English.

export type Locale = "en" | "ja";

const EN = {
  pleaseRenderFirst: "Please render first",
  diagramChanged: "Diagram changed. Try again.",
  shapesFlowchartOnly: "Shapes format supports flowcharts only.",
  sizeUnknown: "The diagram's size is unknown.",
  svgLoadFailed: "Failed to load SVG image.",
  previewHint: "Type Mermaid code, or start from {menu}",
  tableTwoColumns: "Select at least two columns.",
  tableEmpty: "The selection is empty.",
  tableNoDataRows: "The selection has no data rows.",
  tableTaskEmpty: "Row {row}: the task name is empty.",
  tableStartNotDate: "Row {row}: the start must be a date.",
  tableEndInvalid: "Row {row}: the end must be a date or a number of days.",
  tableValueNotNumber: "Row {row}: the value must be a number.",
};

export type MessageId = keyof typeof EN;

const JA: Record<MessageId, string> = {
  pleaseRenderFirst: "先に図を描画してください",
  diagramChanged: "図が変わりました。もう一度実行してください。",
  shapesFlowchartOnly: "Shapes 形式はフローチャートだけに対応しています。",
  sizeUnknown: "図の大きさが分かりません。",
  svgLoadFailed: "SVG 画像を読み込めませんでした。",
  previewHint: "Mermaid のコードを入力するか、{menu} から始めてください",
  tableTwoColumns: "2 列以上を選択してください。",
  tableEmpty: "選択範囲が空です。",
  tableNoDataRows: "選択範囲にデータの行がありません。",
  tableTaskEmpty: "{row} 行目: タスク名が空です。",
  tableStartNotDate: "{row} 行目: 開始は日付にしてください。",
  tableEndInvalid: "{row} 行目: 終了は日付か日数にしてください。",
  tableValueNotNumber: "{row} 行目: 値は数値にしてください。",
};

export const MESSAGES: Record<Locale, Record<MessageId, string>> = { en: EN, ja: JA };

let current: Locale = "en";

export function setLocale(locale: Locale) {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** "ja" for Japanese language tags such as "ja-JP", otherwise "en". */
export function toLocale(language: string | undefined): Locale {
  return /^ja\b/i.test(language ?? "") ? "ja" : "en";
}

/** The message in the current locale, with {name} placeholders filled in. */
export function t(id: MessageId, params: Record<string, string | number> = {}): string {
  return MESSAGES[current][id].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
