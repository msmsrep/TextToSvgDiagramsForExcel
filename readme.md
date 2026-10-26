# Text-to-SVG Diagrams for Excel

[English](./readme.md) | [日本語](./readme.ja.md)

An Office Add-in that creates diagrams using Mermaid syntax and inserts them as images into Excel sheets.

Quickly draw flowcharts, sequence diagrams, ER diagrams, and more using text-based notation, then insert them as PNG/JPEG/SVG images into the active sheet. All processing happens locally — your input is never sent to external servers.

Landing page and install guide: https://msmsrep.github.io/TextToSvgDiagramsForExcel/?lang=en

This is an unofficial tool and is not affiliated with the Mermaid project. It was formerly named "Mermaid for Excel"; see [docs/migration.md](./docs/migration.md) for moving from the old name.

### Key Features

- **Real-time preview** — The diagram is rendered automatically in the task pane as you type Mermaid syntax. On a syntax error, the offending line is highlighted in the editor and [Go to line N] jumps to it
- **Insert into Excel** — Insert the previewed image at the active cell with one click
- **Re-editing** — The Mermaid code is stored in the inserted image's alt text; select the diagram on the sheet (or pick it from [Diagram]) to load it back, then edit and replace it. If the editor has unsaved code, you are asked before it is replaced
- **Diagrams ribbon tab** — Start new diagrams, insert and download from the *Diagrams* tab; the task pane keeps just the editor, preview and output settings
- **Templates** — Pick a diagram type from *Diagrams > Template* to start from a short example (flowchart, sequence, class, state, ER, Gantt, pie, mindmap, timeline)
- **Code from selected cells** — Select a table and pick a type from *Diagrams > From cells* to get flowchart (`parent | child | label`), Gantt (`task | start | end or days | section`) or pie chart (`label | value`) code
- **PNG / JPEG / SVG output** — Choose your output format and download the image directly
- **Output size** — Set the size as a scale (50–200%) or a width in points. When replacing a diagram, *Keep current size* (on by default) keeps its width on the sheet
- **Editable shapes (experimental)** — Insert a flowchart as native Excel shapes and connectors (`Shapes (editable)`), or as an SVG simplified for Excel's *Convert to Shape* (`SVG (for shape conversion)`), so people without the add-in can edit it
- **Wide diagram support** — All diagram types supported by [Mermaid](https://github.com/mermaid-js/mermaid) are available, including flowcharts, sequence diagrams, class diagrams, ER diagrams, and Gantt charts
- **Privacy-friendly** — All processing is completed within the task pane; no data is sent to external servers

## Project Structure

```
TextToSvgDiagramsForExcel/
  build.js                 ← esbuild build script (build / dev / watch / serve / engine)
  manifest.xml             ← Office Add-in manifest
  package.json
  tsconfig.json
  assets/                  ← Icon directory
  scripts/sync-version.js  ← Syncs the package.json version to the manifest, installer and desktop app
  site/index.html          ← Landing page served at the GitHub Pages root (includes install guide)
  src/core/                ← Code shared by the add-in and the desktop app
    render.ts              ← Mermaid rendering
    image.ts               ← SVG → PNG/JPEG conversion
    officeSvg.ts           ← SVG simplified for Excel's Convert to Shape
    flowchartModel.ts      ← Flowchart SVG → Excel shape model
    svgUtil.ts             ← Matrix and color helpers
    tableToMermaid.ts      ← Table → Mermaid code
    templates.ts           ← Starting code for each diagram type
    errorLine.ts           ← Maps a render error to the editor line
    messages.ts            ← Shared messages (English and Japanese)
  src/taskpane/            ← Add-in only
    taskpane.html / .css
    taskpane.ts            ← UI wiring (entry point)
    excelShapes.ts         ← Excel shape insert / replace / list
    excelTable.ts          ← Reads the selected cells
    ribbon.ts              ← Diagrams tab commands (shared runtime)
    splitter.ts            ← Editor / preview splitter
    lineHighlight.ts       ← Highlights a line of the editor
  src/engine/              ← The desktop app's rendering engine (a page run in WebView2)
  desktop/                 ← Desktop app (WPF); see docs/desktop-design.md
    src/                   ← The app
    tests/                 ← xUnit tests
    package/               ← MSIX manifest, images and packaging script (pack.ps1)
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
| `npm run build:engine` | Build the desktop app's rendering engine into `desktop/src/TextToSvgDiagramsForExcel.Desktop/web/` |
| `npm run watch` | Watch for file changes and auto-rebuild |
| `npm run typecheck` | Type-check the source and tests with `tsc` |
| `npm test` | Run the tests with Vitest |
| `npm run test:watch` | Run the tests in watch mode |
| `npm version <patch\|minor\|major>` | Bump the version and sync it to `manifest.xml`, the installer and the desktop app (csproj and `Package.appxmanifest`) |

## Desktop App (WPF)

Requirements: .NET 10 SDK, Node.js (the build creates the rendering engine), and [winapp CLI](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli) (`winget install Microsoft.winappcli`; only for MSIX).

### Build, Run and Test

```bash
dotnet build desktop/TextToSvgDiagramsForExcel.Desktop.sln
dotnet test desktop/TextToSvgDiagramsForExcel.Desktop.sln
```

The build runs `npm run build:engine`. The executable is `desktop/src/TextToSvgDiagramsForExcel.Desktop/bin/Debug/net10.0-windows10.0.19041.0/win-x64/TextToSvgDiagramsForExcel.exe` (outside MSIX it keeps its settings in `%LOCALAPPDATA%\TextToSvgDiagramsForExcel`).

### Creating the MSIX

MSIX packages are always signed with a self-signed certificate whose subject is the Store Publisher; the same certificate signs the release and development packages (see `docs/desktop-design.md` §9).

**1. Create the certificate** (once; again when it expires)

```bash
winapp cert generate --manifest desktop/package/Package.appxmanifest --output desktop/package/cert/TextToSvgDiagramsForExcel.pfx --password <password> --export-cer --valid-days 365
```

- Don't use the default password (`password`); it is publicly known.
- `desktop/package/cert/` and `.pfx` / `.cer` files are never committed (they are in `.gitignore`).

**2. Save the password in an environment variable** (optional; saves typing it every time)

```powershell
[Environment]::SetEnvironmentVariable('MSIX_CERT_PASSWORD', '<password>', 'User')
```

Open a new terminal after saving it.

**3. Create the MSIX** (PowerShell)

```powershell
# Development (Identity ...Dev; Debug build with WebView2 DevTools)
./desktop/package/pack.ps1 -Variant Dev

# Release (the one submitted to the Store)
./desktop/package/pack.ps1 -Variant Release
```

- Without the environment variable, add `-CertPassword <password>`.
- For a certificate somewhere else, add `-CertPath <path to .pfx>`.
- To build one architecture only, add `-Arch x64` (or `arm64`); the result is a `.msix` instead of a bundle.
- The output goes to `desktop/out/<Dev|Release>/`, named `TextToSvgDiagramsForExcel[.Dev]_<version>.msixbundle` (x64 and Arm64 in one bundle).
- The development package has its own Identity, so it installs next to the Store version.

### Installing on a Test Machine

**1. Trust the certificate** (once per machine; run as administrator)

```bash
winapp cert install desktop/package/cert/TextToSvgDiagramsForExcel.cer
```

Without winapp, import the `.cer` into Local Computer → Trusted People. On a development PC you can instead add `--install` to `cert generate`.

**2. Install the package**

```powershell
Add-AppxPackage desktop/out/Dev/TextToSvgDiagramsForExcel.Dev_1.5.0.0.msixbundle
```

- Double-clicking the `.msixbundle` also installs it.
- Uninstall it from Settings → Apps.
- `.msixbundle` files are not distributed to users; the app is distributed only through the Microsoft Store.

### Submitting to the Store

To build the release package and submit it, add `-Publish`.

```powershell
./desktop/package/pack.ps1 -Variant Release -Publish
```

The first submission and the Store listing are made in Partner Center.

### CI

`.github/workflows/desktop.yml` builds and tests the app. When the repository secrets `MSIX_CERT_BASE64` (the `.pfx` in Base64) and `MSIX_CERT_PASSWORD` are set, it also creates the development `.msixbundle` as a build artifact. To get the `.pfx` in Base64, run:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('desktop/package/cert/TextToSvgDiagramsForExcel.pfx')) | Set-Clipboard
```

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
