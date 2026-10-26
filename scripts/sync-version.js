// @ts-check
"use strict";

// package.json の version を manifest.xml、Installer/*.iss、デスクトップ版の csproj と
// Package.appxmanifest に反映する。
// `npm version <patch|minor|major>` 実行時に package.json の "version" スクリプトから呼ばれる。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { version } = require("../package.json");
// Office アドイン、Inno Setup、MSIX は 4 桁のバージョンを使う（MSIX は 4 桁目を 0 にする）
const version4 = `${version}.0`;

/**
 * @param {string} relPath
 * @param {RegExp} pattern
 * @param {string} replacement
 */
function replaceInFile(relPath, pattern, replacement) {
  const file = path.join(ROOT, relPath);
  const src = fs.readFileSync(file, "utf8");
  if (!pattern.test(src)) {
    throw new Error(`Version pattern not found in ${relPath}`);
  }
  fs.writeFileSync(file, src.replace(pattern, replacement), "utf8");
  console.log(`  ${relPath} → ${version4}`);
}

replaceInFile(
  "manifest.xml",
  /<Version>[^<]*<\/Version>/,
  `<Version>${version4}</Version>`,
);
replaceInFile(
  "Installer/TextToSvgDiagramsForExcel.iss",
  /#define MyAppVersion "[^"]*"/,
  `#define MyAppVersion "${version4}"`,
);
replaceInFile(
  "desktop/src/TextToSvgDiagramsForExcel.Desktop/TextToSvgDiagramsForExcel.Desktop.csproj",
  /<Version>[^<]*<\/Version>/,
  `<Version>${version}</Version>`,
);
replaceInFile(
  "desktop/package/Package.appxmanifest",
  /(<Identity\b[^>]*\bVersion=")[^"]*(")/,
  `$1${version4}$2`,
);
