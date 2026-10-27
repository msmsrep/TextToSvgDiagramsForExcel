// User-facing messages from the shared code and the add-in's task pane, in
// English and Japanese. mermaid's own error messages and diagram type names
// stay in English.

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
  // Task pane
  ribbonTemplateMenu: "Diagrams > Template on the ribbon",
  labelDiagram: "Diagram",
  diagramSelectLabel: "Select Mermaid diagram in active sheet",
  noDiagramSelected: "(No diagram selected)",
  loadConfirm: 'Load "{name}"? The code in the editor has unsaved changes and will be replaced.',
  buttonReplace: "Replace",
  buttonKeep: "Keep",
  codeLabel: "Mermaid code",
  splitterLabel: "Resize editor",
  labelSize: "Size",
  sizeLabel: "Output size",
  sizeWidth: "Width (pt)",
  widthLabel: "Width in points",
  keepCurrentSize: "Keep current size",
  formatLabel: "Output format",
  formatSvgOffice: "SVG (for shape conversion)",
  formatShapes: "Shapes (editable)",
  buttonInsert: "Insert to Excel",
  buttonDownload: "Download",
  goToLine: "Go to line {line}",
  renderError: "Render error: {message}",
  insertError: "Insert error: {message}",
  downloadError: "Download error: {message}",
  generateError: "Generate error: {message}",
  enterWidth: "Enter a width greater than 0.",
  shapesCannotBeDownloaded: "Shapes cannot be downloaded.",
  svgNotSupported: "SVG insertion is not supported in this version of Excel. Use PNG or JPEG.",
  diagramNoLongerExists: "Selected diagram no longer exists.",
  diagramHasNoShapes: "The diagram has no shapes.",
  insertedShapeUnknown: "Could not identify the inserted shape.",
  selectCellRange: "Select a cell range on the sheet.",
  selectionTooManyRows: "The selection has more than {max} rows.",
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
  ribbonTemplateMenu: "リボンの [図] > [テンプレート]",
  labelDiagram: "図",
  diagramSelectLabel: "アクティブ シートの Mermaid の図を選択",
  noDiagramSelected: "(図を選択していません)",
  loadConfirm: "「{name}」を読み込みますか? 入力欄のコードには保存していない変更があり、置き換えられます。",
  buttonReplace: "置き換える",
  buttonKeep: "残す",
  codeLabel: "Mermaid のコード",
  splitterLabel: "入力欄の大きさを変更",
  labelSize: "サイズ",
  sizeLabel: "出力サイズ",
  sizeWidth: "幅 (pt)",
  widthLabel: "幅 (ポイント)",
  keepCurrentSize: "今の大きさを保つ",
  formatLabel: "出力形式",
  formatSvgOffice: "SVG (図形変換用)",
  formatShapes: "図形 (編集可能)",
  buttonInsert: "Excel に挿入",
  buttonDownload: "ダウンロード",
  goToLine: "{line} 行目へ移動",
  renderError: "描画エラー: {message}",
  insertError: "挿入エラー: {message}",
  downloadError: "ダウンロード エラー: {message}",
  generateError: "生成エラー: {message}",
  enterWidth: "0 より大きい幅を入力してください。",
  shapesCannotBeDownloaded: "図形はダウンロードできません。",
  svgNotSupported: "この Excel では SVG を挿入できません。PNG か JPEG を使ってください。",
  diagramNoLongerExists: "選択した図はもうありません。",
  diagramHasNoShapes: "図に図形がありません。",
  insertedShapeUnknown: "挿入した図形を特定できませんでした。",
  selectCellRange: "シートでセル範囲を選択してください。",
  selectionTooManyRows: "選択範囲が {max} 行を超えています。",
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
