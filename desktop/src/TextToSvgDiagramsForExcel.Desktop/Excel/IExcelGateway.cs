using TextToSvgDiagramsForExcel.Desktop.Engine;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>A diagram on the sheet: a shape whose alt text title is "Mermaid Diagram".</summary>
public sealed record DiagramItem(string Id, string Name, string Code);

public enum ExcelState
{
    /// <summary>Connected to a window showing a workbook.</summary>
    Connected,
    /// <summary>Excel is running without an open workbook.</summary>
    NoWorkbook,
    NotFound,
    /// <summary>Excel's object model cannot be reached (for example, Excel runs as administrator).</summary>
    CannotConnect,
}

/// <summary>Where the app is connected: the state and the target workbook's name.</summary>
public sealed record ExcelStatus(ExcelState State, string? WorkbookName = null)
{
    public static readonly ExcelStatus NotFound = new(ExcelState.NotFound);
}

/// <summary>An Excel error to show to the user, with a message in the UI language.</summary>
public sealed class ExcelException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Excel operations on the target window (the active Excel's window) and its
/// workbook, as the add-in's excelShapes.ts / excelTable.ts. Shape IDs are
/// strings, as in the add-in. Calls are made on the UI thread.
/// </summary>
public interface IExcelGateway : IDisposable
{
    ExcelStatus Status { get; }

    /// <summary>The target window's active sheet or workbook was switched in Excel.</summary>
    event EventHandler? SheetChanged;

    /// <summary>
    /// Finds the target again (the frontmost Excel window). Returns true when the
    /// target changed. Quiet calls (polling) do not wait for a busy Excel.
    /// </summary>
    bool Locate(bool quiet = false);

    /// <summary>Drops the connection when the target's Excel window was closed or hidden; true when it was.</summary>
    bool CheckClosed();

    IReadOnlyList<DiagramItem> ListDiagrams();

    /// <summary>The diagram's width in points.</summary>
    double GetDiagramWidth(string id);

    bool IsSvgInsertSupported();

    /// <summary>Inserts a PNG/JPEG/SVG file's data at the active cell, or in place of the replaced diagram.</summary>
    string InsertPicture(byte[] data, string extension, double widthPt, double heightPt, string code, string? replaceId);

    /// <summary>Builds the flowchart from native shapes and groups them.</summary>
    string InsertShapes(ShapeModel model, string code, string? replaceId);

    /// <summary>Reads the cells with values in the selected range.</summary>
    TableData ReadSelection();

    /// <summary>The ID of the shape (or its group) selected on the sheet, or null.</summary>
    string? GetSelectedShapeId(bool quiet);
}
