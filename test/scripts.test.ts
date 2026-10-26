// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.join(__dirname, "..");
const DEV_URL = "https://localhost:3000";
const PROD_URL = "https://msmsrep.github.io/TextToSvgDiagramsForExcel/dist";

const fixtures: string[] = [];

/** Copies the given repo paths into a fresh temp directory, which the scripts treat as the project root. */
function fixture(paths: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "text-to-svg-diagrams-for-excel-"));
  fixtures.push(dir);
  for (const p of paths) {
    fs.cpSync(path.join(REPO, p), path.join(dir, p), { recursive: true });
  }
  return dir;
}

function run(dir: string, script: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.join(dir, script), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

const read = (dir: string, p: string) => fs.readFileSync(path.join(dir, p), "utf8");
const count = (s: string, sub: string) => s.split(sub).length - 1;

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    // Remove the node_modules link itself first so the repo's packages are never touched.
    const link = path.join(dir, "node_modules");
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const CSPROJ = "desktop/src/TextToSvgDiagramsForExcel.Desktop/TextToSvgDiagramsForExcel.Desktop.csproj";
const APPX = "desktop/package/Package.appxmanifest";

describe("scripts/sync-version.js", () => {
  function versionFixture(version: string) {
    const dir = fixture(["scripts/sync-version.js", "manifest.xml", "Installer/TextToSvgDiagramsForExcel.iss", CSPROJ, APPX]);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    return dir;
  }

  it("writes the package.json version as four parts to the manifest and installer", () => {
    const dir = versionFixture("2.3.4");
    const before = { manifest: read(dir, "manifest.xml"), iss: read(dir, "Installer/TextToSvgDiagramsForExcel.iss") };

    const result = run(dir, "scripts/sync-version.js");
    expect(result.status, result.stderr).toBe(0);

    const manifest = read(dir, "manifest.xml");
    const iss = read(dir, "Installer/TextToSvgDiagramsForExcel.iss");
    expect(manifest).toContain("<Version>2.3.4.0</Version>");
    expect(iss).toContain('#define MyAppVersion "2.3.4.0"');
    // Nothing else changes.
    expect(manifest).toBe(before.manifest.replace(/<Version>[^<]*<\/Version>/, "<Version>2.3.4.0</Version>"));
    expect(iss).toBe(before.iss.replace(/#define MyAppVersion "[^"]*"/, '#define MyAppVersion "2.3.4.0"'));
  });

  it("writes the version to the desktop app's project and MSIX manifest", () => {
    const dir = versionFixture("2.3.4");
    const before = { csproj: read(dir, CSPROJ), appx: read(dir, APPX) };

    const result = run(dir, "scripts/sync-version.js");
    expect(result.status, result.stderr).toBe(0);

    // The project uses three parts; MSIX needs four with the last one 0.
    expect(read(dir, CSPROJ)).toBe(before.csproj.replace(/<Version>[^<]*<\/Version>/, "<Version>2.3.4</Version>"));
    const appx = read(dir, APPX);
    expect(appx).toMatch(/<Identity\s[^>]*Version="2\.3\.4\.0"/);
    expect(appx.replace('Version="2.3.4.0"', "")).toBe(before.appx.replace(/(<Identity\s[^>]*)Version="[^"]*"/, "$1"));
  });

  it("fails when the version is not found in a target file", () => {
    const dir = versionFixture("2.3.4");
    fs.writeFileSync(path.join(dir, "Installer/TextToSvgDiagramsForExcel.iss"), "; no version here\n");

    const result = run(dir, "scripts/sync-version.js");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Version pattern not found in Installer/TextToSvgDiagramsForExcel.iss");
  });
});

describe("build.js", () => {
  const BUILD_TIMEOUT = 120_000;

  function buildFixture() {
    const dir = fixture(["build.js", "manifest.xml", "assets", "src/taskpane", "src/core"]);
    // Resolve esbuild and the bundled packages from the repo.
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "junction");
    return dir;
  }

  function expectDistFiles(dir: string) {
    const dist = path.join(dir, "dist");
    for (const f of ["taskpane.html", "taskpane.css", "taskpane.js", "taskpane.js.map", "manifest.xml"]) {
      expect(fs.existsSync(path.join(dist, f)), f).toBe(true);
    }
    expect(fs.readdirSync(path.join(dist, "assets")).sort()).toEqual(
      fs.readdirSync(path.join(REPO, "assets")).sort(),
    );
    expect(read(dir, "dist/taskpane.html")).toBe(read(REPO, "src/taskpane/taskpane.html"));
  }

  it("builds for production with the GitHub Pages URL in the manifest", { timeout: BUILD_TIMEOUT }, () => {
    const dir = buildFixture();
    const result = run(dir, "build.js");
    expect(result.status, result.stderr).toBe(0);

    expectDistFiles(dir);
    const src = read(dir, "manifest.xml");
    const out = read(dir, "dist/manifest.xml");
    expect(out).not.toContain(DEV_URL);
    expect(count(out, PROD_URL)).toBe(count(src, DEV_URL));
    expect(out).toBe(src.replaceAll(DEV_URL, PROD_URL));
  });

  it("builds for development with the localhost URL in the manifest", { timeout: BUILD_TIMEOUT }, () => {
    const dir = buildFixture();
    const result = run(dir, "build.js", "dev");
    expect(result.status, result.stderr).toBe(0);

    expectDistFiles(dir);
    expect(read(dir, "dist/manifest.xml")).toBe(read(dir, "manifest.xml"));
  });

  it("bundles the task pane as an IIFE including mermaid", { timeout: BUILD_TIMEOUT }, () => {
    const dir = buildFixture();
    expect(run(dir, "build.js", "dev").status).toBe(0);

    const js = read(dir, "dist/taskpane.js");
    expect(js.trimStart()).toMatch(/^"use strict";\s*\(\(\) => \{|^\(\(\) => \{/);
    expect(js).toContain("mermaid-graph");
    expect(js).not.toMatch(/^\s*import\s/m);
    expect(js).toMatch(/\/\/# sourceMappingURL=taskpane\.js\.map\s*$/);
  });

  it("fails on an unknown mode", { timeout: BUILD_TIMEOUT }, () => {
    const dir = buildFixture();
    const result = run(dir, "build.js", "nope");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown mode: nope (build|dev|watch|serve|engine)");
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
  });
});
