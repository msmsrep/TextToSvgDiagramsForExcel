# Text-to-SVG Diagrams for Excel

[English](./readme.md) | [日本語](./readme.ja.md)

An Office Add-in that creates diagrams using Mermaid syntax and inserts them as images into Excel sheets.

Quickly draw flowcharts, sequence diagrams, ER diagrams, and more using text-based notation, then insert them as PNG/JPEG/SVG images into the active sheet. All processing happens locally — your input is never sent to external servers.

Landing page and install guide: https://msmsrep.github.io/TextToSvgDiagramsForExcel/?lang=en

This is an unofficial tool and is not affiliated with the Mermaid project. It was formerly named "Mermaid for Excel"; see [docs/migration.md](./docs/migration.md) for moving from the old name.

### Key Features

- **Real-time preview** — The diagram is rendered automatically in the task pane as you type Mermaid syntax. On a syntax error, the offending line is highlighted in the editor and [Go to line N] jumps to it
- **Insert into Excel** — Insert the previewed image at the active cell with one click
- **Re-editing** — The Mermaid code is stored in the inserted image's alt text; select the diagram on the sheet (or pick it from [Sheet diagram]) to load it back, then edit and replace it. If the editor has unsaved code, you are asked before it is replaced
- **Templates** — Pick a diagram type in [New from template] and click [Use] to start from a short example (flowchart, sequence, class, state, ER, Gantt, pie, mindmap, timeline)
- **Code from selected cells** — Select a table and click [Generate] to get flowchart (`parent | child | label`), Gantt (`task | start | end or days | section`) or pie chart (`label | value`) code
- **PNG / JPEG / SVG output** — Choose your output format and download the image directly
- **Output size** — Set the size as a scale (50–200%) or a width in points. When replacing a diagram, *Keep current size* (on by default) keeps its width on the sheet
- **Editable shapes (experimental)** — Insert a flowchart as native Excel shapes and connectors (`Shapes (editable)`), or as an SVG simplified for Excel's *Convert to Shape* (`SVG (for shape conversion)`), so people without the add-in can edit it
- **Wide diagram support** — All diagram types supported by [Mermaid](https://github.com/mermaid-js/mermaid) are available, including flowcharts, sequence diagrams, class diagrams, ER diagrams, and Gantt charts
- **Privacy-friendly** — All processing is completed within the task pane; no data is sent to external servers

## Project Structure

```
TextToSvgDiagramsForExcel/
  build.js                 ← esbuild build script (build / dev / watch / serve)
  manifest.xml             ← Office Add-in manifest
  package.json
  tsconfig.json
  assets/                  ← Icon directory
  scripts/sync-version.js  ← Syncs the package.json version to the manifest and installer
  site/index.html          ← Landing page served at the GitHub Pages root (includes install guide)
  src/taskpane/
    taskpane.html / .css
    taskpane.ts            ← UI wiring (entry point)
    render.ts              ← Mermaid rendering
    image.ts               ← SVG → PNG/JPEG conversion
    officeSvg.ts           ← SVG simplified for Excel's Convert to Shape
    flowchartModel.ts      ← Flowchart SVG → Excel shape model
    svgUtil.ts             ← Matrix and color helpers
    excelShapes.ts         ← Excel shape insert / replace / list
    excelTable.ts          ← Reads the selected cells
    tableToMermaid.ts      ← Table → Mermaid code
    templates.ts           ← Starting code for each diagram type
    splitter.ts            ← Editor / preview splitter
    errorLine.ts           ← Maps a render error to the editor line
    lineHighlight.ts       ← Highlights a line of the editor
  samples/                 ← Sample workbook for manual testing
  test/                    ← Vitest tests (Office.js, mermaid and Canvas are mocked)
  dist/                    ← Build output (not committed; deployed by GitHub Actions)
```

## Setup

```bash
cd TextToSvgDiagramsForExcel
npm install

# Install development HTTPS certificate (first time only, requires admin privileges)
npx office-addin-dev-certs install
```

## Starting the Development Server

```bash
npm run dev-server
# → https://localhost:3000/taskpane.html
```

To sideload and debug, run `npm start` while the development server is running.

## Registering the Add-in in Excel

1. Open Excel
2. **[Insert]** → **[Add-ins]** → **[My Add-ins]** → **[Upload My Add-in]**
3. Select `dist/manifest.xml` (built with `npm run build:dev` when using the development server)

An **[Open Text-to-SVG]** button will be added to the Home tab.

## Scripts

| Command | Description |
|---|---|
| `npm run dev-server` | Build + start HTTPS server (port 3000) |
| `npm start` | Sideload into Excel and start debugging |
| `npm stop` | Stop debugging |
| `npm run build` | One-time build to `dist/` (manifest with production URLs) |
| `npm run build:dev` | One-time build to `dist/` (manifest with `https://localhost:3000`) |
| `npm run watch` | Watch for file changes and auto-rebuild |
| `npm run typecheck` | Type-check the source and tests with `tsc` |
| `npm test` | Run the tests with Vitest |
| `npm run test:watch` | Run the tests in watch mode |
| `npm version <patch\|minor\|major>` | Bump the version and sync it to `manifest.xml` and the installer |

## Replacing Icons

Replace `assets/icon-{16,32,64,80}.png` with your own PNG images.  

## License

This project is licensed under the [MIT License](LICENSE.txt).

### Third-party licenses

This software uses [mermaid](https://github.com/mermaid-js/mermaid) (MIT License).

## Privacy Policy

Last updated: October 22, 2026

### Data Collection

Text-to-SVG Diagrams for Excel does **not** collect any personal information or user data.

### How It Works

- Mermaid syntax text entered by the user is processed **entirely within the task pane** in Excel
- Diagram rendering is completed locally and no data is sent to external servers
- Inserting images into Excel sheets is also performed locally via the Microsoft Office JavaScript API
- When generating code from a table, the selected cell values are read only to build the code inside the task pane; they are not stored or sent anywhere

### Access to External Services

This add-in loads its application files (HTML/JavaScript) from a hosting server.  
No user data is included in this communication.

### Cookies and Tracking

This add-in does not use cookies, local storage, or any tracking technologies.

### Contact

For privacy-related questions, please open a [GitHub Issue](https://github.com/msmsrep/TextToSvgDiagramsForExcel/issues).
