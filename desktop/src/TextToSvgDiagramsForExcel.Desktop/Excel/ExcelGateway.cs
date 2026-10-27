using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Threading;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>
/// Excel through COM (late bound, so any Excel 2016 or later works and no
/// interop assembly is needed). Works on the target window found by
/// <see cref="ExcelLocator"/> and its workbook, never on Application.Active*,
/// which may be another workbook while Excel is in the background.
/// </summary>
public sealed class ExcelGateway : IExcelGateway
{
    // SVG pictures came with Office 365 version 1704 (build 8067); Excel 2016
    // without a subscription cannot insert them. 要検証 (design §5.5.2).
    private const int SvgMinBuild = 8067;
    private const int MaxTableRows = 500;

    private readonly ExcelLocator _locator;
    private readonly Dispatcher _dispatcher;
    private ExcelTarget? _target;
    // Long-lived references (design §5.2): released together in Release().
    private dynamic? _app;
    private dynamic? _window;
    private AppEventsSink? _sink;
    // Set on Dispose; events queued before it are ignored and nothing reconnects.
    private bool _disposed;

    public ExcelGateway(ExcelLocator locator)
    {
        _locator = locator;
        _dispatcher = Dispatcher.CurrentDispatcher;
    }

    public ExcelStatus Status { get; private set; } = ExcelStatus.NotFound;

    public event EventHandler? SheetChanged;

    public bool Locate(bool quiet = false)
    {
        if (_disposed)
        {
            return false;
        }
        using var _ = MessageFilter.Quiet(quiet);
        var target = _locator.Locate();
        // Same window: keep the connection (a failed one is tried again).
        if (target == _target && Status.State != ExcelState.CannotConnect)
        {
            if (_window is not null && !quiet)
            {
                // The workbook may have been saved under another name.
                TryRefreshName();
            }
            return false;
        }

        var before = (Status, _target);
        Release();
        _target = target;
        Status = Connect(target);
        return Status != before.Status || _target != before._target;
    }

    private ExcelStatus Connect(ExcelTarget? target)
    {
        if (target is null)
        {
            return ExcelStatus.NotFound;
        }
        if (!target.HasWorkbook)
        {
            return new ExcelStatus(ExcelState.NoWorkbook);
        }
        var iid = NativeMethods.IID_IDispatch;
        int hr = NativeMethods.AccessibleObjectFromWindow(target.WorkbookWindow, NativeMethods.OBJID_NATIVEOM, ref iid, out object? window);
        if (hr < 0 || window is null)
        {
            // Fails for an Excel running as administrator (UIPI).
            return new ExcelStatus(ExcelState.CannotConnect);
        }
        try
        {
            _window = window;
            _app = _window.Application;
            string name = WorkbookName();
            Subscribe();
            return new ExcelStatus(ExcelState.Connected, name);
        }
        catch (Exception e) when (e is COMException or InvalidComObjectException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
        {
            Release();
            return new ExcelStatus(ExcelState.CannotConnect);
        }
    }

    private string WorkbookName()
    {
        using var s = new ComScope();
        dynamic workbook = s.T(_window!.Parent);
        return (string)workbook.Name;
    }

    private void TryRefreshName()
    {
        try
        {
            Status = Status with { WorkbookName = WorkbookName() };
        }
        catch (Exception e) when (ComErrors.IsDisconnected(e))
        {
            Disconnect();
        }
        catch (Exception e) when (e is COMException)
        {
            // Busy; keep the old name.
        }
    }

    public bool CheckClosed()
    {
        if (_target is null)
        {
            return false;
        }
        // Excel hides its window instead of quitting while it is referenced from outside.
        if (NativeMethods.IsWindow(_target.MainWindow) && NativeMethods.IsWindowVisible(_target.MainWindow))
        {
            return false;
        }
        Disconnect();
        return true;
    }

    private void Disconnect()
    {
        Release();
        _target = null;
        Status = ExcelStatus.NotFound;
    }

    private void Subscribe()
    {
        try
        {
            _sink = new AppEventsSink(OnSheetActivate, OnWorkbookActivate);
            _sink.Advise(_app!);
        }
        catch (Exception e) when (e is COMException or InvalidCastException)
        {
            // Without events, polling and activation still refresh the list.
            _sink = null;
        }
    }

    // Events arrive on the UI thread while Excel waits, so the work (COM calls)
    // runs afterwards. Events come from the whole application; only the target
    // workbook's count.
    private void OnSheetActivate(object sheet) => _dispatcher.BeginInvoke(() =>
    {
        try
        {
            if (_disposed)
            {
                return;
            }
            using var _ = MessageFilter.Quiet();
            using var s = new ComScope();
            dynamic workbook = s.T(((dynamic)sheet).Parent);
            if ((string)workbook.Name == Status.WorkbookName)
            {
                SheetChanged?.Invoke(this, EventArgs.Empty);
            }
        }
        catch (Exception e) when (e is COMException or InvalidComObjectException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
        {
            // Ignore events that cannot be checked.
        }
        finally
        {
            Marshal.ReleaseComObject(sheet);
        }
    });

    private void OnWorkbookActivate(object workbook) => _dispatcher.BeginInvoke(() =>
    {
        Marshal.ReleaseComObject(workbook);
        if (!_disposed)
        {
            SheetChanged?.Invoke(this, EventArgs.Empty);
        }
    });

    private void Release()
    {
        _sink?.Unadvise();
        _sink = null;
        foreach (var obj in new object?[] { _window, _app })
        {
            if (obj is not null && Marshal.IsComObject(obj))
            {
                try
                {
                    Marshal.FinalReleaseComObject(obj);
                }
                catch (ArgumentException)
                {
                }
            }
        }
        _window = null;
        _app = null;
        // Late-bound calls leave untracked RCWs; collect them so Excel can quit.
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }

    public void Dispose()
    {
        _disposed = true;
        Release();
        _target = null;
    }

    /// <summary>Runs an operation on the target, turning COM failures into messages.</summary>
    private T Run<T>(Func<ComScope, T> action)
    {
        if (Status.State != ExcelState.Connected || _window is null)
        {
            throw new ExcelException(StatusMessage(Status));
        }
        using var scope = new ComScope();
        try
        {
            return action(scope);
        }
        catch (ExcelException)
        {
            throw;
        }
        catch (Exception e) when (ComErrors.IsDisconnected(e))
        {
            Disconnect();
            throw new ExcelException(Strings.Get("ExcelNotFound"), e);
        }
        catch (Exception e) when (ComErrors.IsRejected(e))
        {
            throw new ExcelException(Strings.Get("ExcelBusy"), e);
        }
        catch (Exception e) when (e is COMException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException or IOException or UnauthorizedAccessException)
        {
            throw new ExcelException(ComErrors.Unwrap(e).Message, e);
        }
    }

    /// <summary>The message for a state other than Connected.</summary>
    public static string StatusMessage(ExcelStatus status) => status.State switch
    {
        ExcelState.NoWorkbook => Strings.Get("ExcelNoWorkbook"),
        ExcelState.CannotConnect => Strings.Get("ExcelCannotConnect"),
        _ => Strings.Get("ExcelNotFound"),
    };

    public IReadOnlyList<DiagramItem> ListDiagrams() => Run(s =>
    {
        dynamic sheet = s.T(_window!.ActiveSheet);
        dynamic shapes = s.T(sheet.Shapes);
        var items = new List<DiagramItem>();
        int count = shapes.Count;
        for (int i = 1; i <= count; i++)
        {
            dynamic shape = s.T(shapes.Item(i));
            if (!Office.DiagramShapeTypes.Contains((int)shape.Type) || (string)shape.Title != Office.AltTextTitle)
            {
                continue;
            }
            string code = (string)shape.AlternativeText ?? "";
            items.Add(new DiagramItem(
                ((int)shape.ID).ToString(CultureInfo.InvariantCulture),
                (string)shape.Name,
                // Excel may store line breaks as \r; the editor and the saved-code check use \n.
                code.Replace("\r\n", "\n").Replace('\r', '\n')));
        }
        return (IReadOnlyList<DiagramItem>)items;
    });

    private static dynamic? FindShape(ComScope s, dynamic shapes, string id)
    {
        int count = shapes.Count;
        for (int i = 1; i <= count; i++)
        {
            dynamic shape = s.T(shapes.Item(i));
            if (((int)shape.ID).ToString(CultureInfo.InvariantCulture) == id)
            {
                return shape;
            }
        }
        return null;
    }

    private static dynamic FindDiagram(ComScope s, dynamic shapes, string id) =>
        FindShape(s, shapes, id) ?? throw new ExcelException(Strings.Get("DiagramNoLongerExists"));

    public double GetDiagramWidth(string id) => Run(s =>
    {
        dynamic shapes = s.T(s.T(_window!.ActiveSheet).Shapes);
        return (double)FindDiagram(s, shapes, id).Width;
    });

    public bool IsSvgInsertSupported() => Run(_ =>
    {
        string version = _app!.Version;
        int major = int.TryParse(version.Split('.')[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int m) ? m : 0;
        int build = (int)_app.Build;
        return major > 16 || (major == 16 && build >= SvgMinBuild);
    });

    private sealed record Placement(double Left, double Top, string? Name);

    /// <summary>Where the new shape goes: the replaced diagram's place and name, or the active cell.</summary>
    private Placement LoadPlacement(ComScope s, dynamic shapes, string? replaceId)
    {
        if (replaceId is null)
        {
            dynamic cell = s.T(_window!.ActiveCell);
            return new Placement((double)cell.Left, (double)cell.Top, null);
        }
        dynamic target = FindDiagram(s, shapes, replaceId);
        return new Placement((double)target.Left, (double)target.Top, (string)target.Name);
    }

    /// <summary>Marks the new diagram and, when replacing, deletes the old one and takes its name.</summary>
    private static void Finish(ComScope s, dynamic shapes, dynamic diagram, Placement placement, string code, string? replaceId)
    {
        diagram.Left = placement.Left;
        diagram.Top = placement.Top;
        diagram.Title = Office.AltTextTitle;
        diagram.AlternativeText = code;
        if (replaceId is not null)
        {
            FindShape(s, shapes, replaceId)?.Delete();
            diagram.Name = placement.Name;
        }
    }

    /// <summary>Turns off screen updating for an insert and restores it afterwards.</summary>
    private T WithoutScreenUpdating<T>(Func<T> action)
    {
        bool updating = _app!.ScreenUpdating;
        _app.ScreenUpdating = false;
        try
        {
            return action();
        }
        finally
        {
            _app.ScreenUpdating = updating;
        }
    }

    public string InsertPicture(byte[] data, string extension, double widthPt, double heightPt, string code, string? replaceId) => Run(s =>
    {
        dynamic shapes = s.T(s.T(_window!.ActiveSheet).Shapes);
        var placement = LoadPlacement(s, shapes, replaceId);
        string path = WriteTempFile(data, extension);
        try
        {
            return WithoutScreenUpdating(() =>
            {
                bool sized = widthPt > 0 && heightPt > 0;
                // Embedded, not linked; -1 keeps the picture's own size.
                dynamic picture = s.T(shapes.AddPicture(
                    path, Office.MsoFalse, Office.MsoTrue, placement.Left, placement.Top, sized ? widthPt : -1, sized ? heightPt : -1));
                try
                {
                    if (sized)
                    {
                        // Excel picks its own size for SVG; Convert to Shape keeps font
                        // sizes, so the picture must be at the actual size (as the add-in).
                        picture.LockAspectRatio = Office.MsoFalse;
                        picture.Width = widthPt;
                        picture.Height = heightPt;
                    }
                    if (extension != "svg")
                    {
                        picture.LockAspectRatio = Office.MsoTrue;
                    }
                    Finish(s, shapes, picture, placement, code, replaceId);
                    return ((int)picture.ID).ToString(CultureInfo.InvariantCulture);
                }
                catch
                {
                    // Leave no unmarked picture behind, as InsertShapes.
                    DeleteQuietly(picture);
                    throw;
                }
            });
        }
        finally
        {
            try
            {
                File.Delete(path);
            }
            catch (IOException)
            {
                // Left in the temp folder.
            }
        }
    });

    private static string WriteTempFile(byte[] data, string extension)
    {
        Directory.CreateDirectory(AppPaths.TempFolder);
        string path = Path.Combine(AppPaths.TempFolder, $"diagram-{Guid.NewGuid():N}.{extension}");
        File.WriteAllBytes(path, data);
        return path;
    }

    public string InsertShapes(ShapeModel model, string code, string? replaceId) => Run(s =>
    {
        if (model.Nodes.Count + model.Edges.Count + model.Labels.Count == 0)
        {
            throw new ExcelException(Strings.Get("DiagramHasNoShapes"));
        }
        dynamic shapes = s.T(s.T(_window!.ActiveSheet).Shapes);
        var placement = LoadPlacement(s, shapes, replaceId);
        return WithoutScreenUpdating(() =>
        {
            var created = new List<dynamic>();
            dynamic? diagram = null;
            try
            {
                diagram = BuildShapes(s, shapes, model, placement, created);
                Finish(s, shapes, diagram, placement, code, replaceId);
                return ((int)diagram.ID).ToString(CultureInfo.InvariantCulture);
            }
            catch
            {
                // Leave nothing behind, as a failed Excel.run in the add-in.
                foreach (var shape in diagram is not null ? [diagram] : Enumerable.Reverse(created))
                {
                    DeleteQuietly(shape);
                }
                throw;
            }
        });
    });

    private static void DeleteQuietly(dynamic shape)
    {
        try
        {
            shape.Delete();
        }
        catch (COMException)
        {
            // Already gone, or Excel is busy; nothing more to do.
        }
    }

    private static dynamic BuildShapes(ComScope s, dynamic shapes, ShapeModel model, Placement placement, List<dynamic> created)
    {
        // Unique names so the shapes can be grouped by name.
        string prefix = $"mermaid-{Guid.NewGuid():N}-";
        var names = new List<string>();
        dynamic Add(dynamic shape)
        {
            shape.Name = prefix + names.Count;
            names.Add((string)shape.Name);
            created.Add(shape);
            return shape;
        }

        var nodes = new Dictionary<string, (dynamic Shape, Box Box, string Type, int Sites)>();
        foreach (var node in model.Nodes)
        {
            int type = Office.AutoShapeTypes.GetValueOrDefault(node.Type, Office.AutoShapeTypes["Rectangle"]);
            dynamic shape = Add(s.T(shapes.AddShape(type, placement.Left + node.Box.Left, placement.Top + node.Box.Top, node.Box.Width, node.Box.Height)));
            SetFill(s, shape, node.Fill);
            SetLine(s, shape, node.Line);
            if (node.Label.Text != "")
            {
                SetText(s, shape, node.Label, node.LabelPosition == "Top" ? Office.MsoAnchorTop : Office.MsoAnchorMiddle);
            }
            nodes[node.Id] = (shape, node.Box, node.Type, (int)shape.ConnectionSiteCount);
        }

        foreach (var edge in model.Edges)
        {
            int connectorType = edge.ConnectorType == "Elbow" ? Office.MsoConnectorElbow : Office.MsoConnectorStraight;
            dynamic connector = Add(s.T(shapes.AddConnector(
                connectorType,
                placement.Left + edge.Begin.X,
                placement.Top + edge.Begin.Y,
                placement.Left + edge.End.X,
                placement.Top + edge.End.Y)));
            dynamic format = s.T(connector.ConnectorFormat);
            int? beginSite = null;
            bool hasFrom = nodes.TryGetValue(edge.From, out var from) && from.Sites > 0;
            if (hasFrom)
            {
                beginSite = ConnectionSite.Nearest(from.Box, edge.Begin, from.Sites, from.Type);
                // COM numbers connection sites from 1.
                format.BeginConnect(from.Shape, beginSite.Value + 1);
            }
            if (nodes.TryGetValue(edge.To, out var to) && to.Sites > 0)
            {
                // A self-loop needs two different sites, or the connector has no length.
                int? exclude = edge.From == edge.To ? beginSite : null;
                format.EndConnect(to.Shape, ConnectionSite.Nearest(to.Box, edge.End, to.Sites, to.Type, exclude) + 1);
            }
            dynamic line = s.T(connector.Line);
            line.BeginArrowheadStyle = Office.ArrowheadStyles.GetValueOrDefault(edge.BeginArrow, 1);
            line.EndArrowheadStyle = Office.ArrowheadStyles.GetValueOrDefault(edge.EndArrow, 1);
            SetLine(s, connector, edge.Line);
        }

        foreach (var label in model.Labels)
        {
            dynamic box = Add(s.T(shapes.AddTextbox(
                Office.MsoTextOrientationHorizontal,
                placement.Left + label.Box.Left,
                placement.Top + label.Box.Top,
                label.Box.Width,
                label.Box.Height)));
            SetFill(s, box, label.Fill);
            SetLine(s, box, null);
            SetText(s, box, label.Label, Office.MsoAnchorMiddle);
        }

        if (created.Count == 1)
        {
            return created[0];
        }
        dynamic range = s.T(shapes.Range(names.Cast<object>().ToArray()));
        return s.T(range.Group());
    }

    private static void SetFill(ComScope s, dynamic shape, Fill? fill)
    {
        dynamic format = s.T(shape.Fill);
        if (fill is null)
        {
            format.Visible = Office.MsoFalse;
            return;
        }
        format.Visible = Office.MsoTrue;
        format.Solid();
        s.T(format.ForeColor).RGB = Office.Rgb(fill.Color);
        format.Transparency = (float)fill.Transparency;
    }

    private static void SetLine(ComScope s, dynamic shape, Line? line)
    {
        dynamic format = s.T(shape.Line);
        if (line is null)
        {
            format.Visible = Office.MsoFalse;
            return;
        }
        format.Visible = Office.MsoTrue;
        s.T(format.ForeColor).RGB = Office.Rgb(line.Color);
        // Whole points, at least 1 (as the add-in; Office.js rejects fractions).
        format.Weight = (float)Math.Max(1, Math.Round(line.Weight, MidpointRounding.AwayFromZero));
        format.DashStyle = line.DashStyle == "Dash" ? Office.MsoLineDash : Office.MsoLineSolid;
    }

    private static void SetText(ComScope s, dynamic shape, Label label, int verticalAnchor)
    {
        dynamic frame = s.T(shape.TextFrame2);
        frame.AutoSize = Office.MsoAutoSizeNone;
        frame.MarginLeft = 0f;
        frame.MarginRight = 0f;
        frame.MarginTop = 0f;
        frame.MarginBottom = 0f;
        frame.VerticalAnchor = verticalAnchor;
        dynamic range = s.T(frame.TextRange);
        // Office text ranges separate paragraphs with \r.
        range.Text = label.Text.Replace("\n", "\r");
        s.T(range.ParagraphFormat).Alignment = Office.MsoAlignCenter;
        dynamic font = s.T(range.Font);
        font.Size = (float)label.Size;
        dynamic fill = s.T(font.Fill);
        fill.Visible = Office.MsoTrue;
        s.T(fill.ForeColor).RGB = Office.Rgb(label.Color);
    }

    public TableData ReadSelection() => Run(s =>
    {
        dynamic selection = s.T(_window!.Selection);
        // Shapes and charts are not ranges; neither are multiple areas
        // (Office.js getSelectedRange fails on those too).
        if (ComTypeName.Of(selection) != "Range" || (int)s.T(selection.Areas).Count > 1)
        {
            throw new ExcelException(Strings.Get("SelectCellRange"));
        }

        // Trim to the cells with values, as Office.js getUsedRangeOrNullObject(true).
        // Intersecting with UsedRange keeps whole-column selections small; its
        // values are read in one call and trimmed here. (Range.Find would
        // overwrite the settings of the user's Find dialog.)
        dynamic sheet = s.T(selection.Worksheet);
        dynamic? used = s.T(_app!.Intersect(selection, s.T(sheet.UsedRange)));
        if (used is null)
        {
            throw new ExcelException(Strings.Get("SelectionEmpty"));
        }
        int usedRow = used.Row;
        int usedColumn = used.Column;
        var usedValues = CellValues.FromValue2((object?)used.Value2, (int)s.T(used.Rows).Count, (int)s.T(used.Columns).Count);
        if (CellValues.Bounds(usedValues) is not var (top, left, bottom, right))
        {
            throw new ExcelException(Strings.Get("SelectionEmpty"));
        }
        int firstRow = usedRow + top;
        int rows = bottom - top + 1;
        int columns = right - left + 1;
        if (rows > MaxTableRows)
        {
            throw new ExcelException(Strings.Format("SelectionTooManyRows", MaxTableRows));
        }
        var values = CellValues.Slice(usedValues, top, left, rows, columns);

        dynamic sheetCells = s.T(sheet.Cells);
        dynamic range = s.T(sheet.Range(
            s.T(sheetCells[firstRow, usedColumn + left]),
            s.T(sheetCells[usedRow + bottom, usedColumn + right])));
        dynamic workbook = s.T(sheet.Parent);
        // NumberFormat is in English except "General", which comes back in the
        // UI language ("G/標準", "Standard"); Office.js returns "General".
        string general = (string)s.T(s.T(workbook.Styles).Item("Normal")).NumberFormat;
        string English(object? format) => format is string f ? (f == general ? "General" : f) : "";
        // Text and NumberFormat are null (DBNull) for ranges with mixed values, so
        // they are read per cell, and only where tableToMermaid uses them
        // (numbers and booleans), since each read is a call into Excel.
        object? sharedFormat = range.NumberFormat;
        var text = new string[rows][];
        var numberFormat = new string[rows][];
        dynamic rangeCells = s.T(range.Cells);
        for (int r = 0; r < rows; r++)
        {
            text[r] = new string[columns];
            numberFormat[r] = new string[columns];
            for (int c = 0; c < columns; c++)
            {
                text[r][c] = "";
                numberFormat[r][c] = "";
                if (values[r][c] is not (double or bool))
                {
                    continue;
                }
                dynamic cell = s.T(rangeCells[r + 1, c + 1]);
                text[r][c] = cell.Text as string ?? "";
                if (values[r][c] is double)
                {
                    numberFormat[r][c] = English(sharedFormat as string ?? (object?)cell.NumberFormat);
                }
            }
        }
        return new TableData(values, text, numberFormat, firstRow, (bool)workbook.Date1904);
    });

    public string? GetSelectedShapeId(bool quiet)
    {
        using var _ = MessageFilter.Quiet(quiet);
        return Run(s =>
        {
            dynamic? selection = s.T(_window!.Selection);
            if (selection is null || ComTypeName.Of(selection) is "Range" or "")
            {
                return null;
            }
            dynamic shapeRange;
            try
            {
                shapeRange = s.T(selection.ShapeRange);
            }
            catch (Exception e) when (e is COMException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                return null;
            }
            if ((int)shapeRange.Count < 1)
            {
                return null;
            }
            dynamic shape = s.T(shapeRange.Item(1));
            // A shape inside a group stands for its group (the add-in cannot do this; its §8-6).
            for (int depth = 0; depth < 16 && (int)shape.Child == Office.MsoTrue; depth++)
            {
                shape = s.T(shape.ParentGroup);
            }
            return ((int)shape.ID).ToString(CultureInfo.InvariantCulture);
        });
    }
}
