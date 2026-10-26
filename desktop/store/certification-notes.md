# Certification notes

Text for Partner Center → Submission options. Reviewers read English.

## Restricted capability: runFullTrust

```text
The app is a WPF desktop app (packaged with the Desktop Bridge) and needs runFullTrust to run as a full trust process. Its main purpose is to insert diagrams into Microsoft Excel: it finds the user's running Excel window and uses Excel's COM object model (AccessibleObjectFromWindow and the Excel object model) to insert pictures and shapes, read the selected cells and list the diagrams on the active sheet. This is not possible from a partial trust (UWP) process. The app does not start other programs, install anything or access the network.
```

## Notes for certification

```text
How to test:
1. Start Excel for desktop and open or create a workbook.
2. Start Text-to-SVG Diagrams for Excel. The top right shows "Excel: <workbook name>" when it is connected.
3. The editor starts with a sample flowchart. Click "Insert to Excel" to insert it at the active cell as a PNG image.
4. Select the inserted picture on the sheet, edit the code in the app and click "Insert to Excel" again: the picture is replaced in the same place.
5. Other functions: New > Template, New > From cells (select a table of two or more columns first), Output > Insert as / Save as, and View > Language.

Without Excel, the app still draws the preview and can save images (File and Output menus).

The app needs the Microsoft Edge WebView2 Runtime; if it is missing, the app shows a message with the download link and closes.
The app does not use the network and collects no data. Settings (window position, output size and format, language) are stored in the app's local data folder.
```
