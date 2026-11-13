using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Services;

// Tests share Strings.Culture, so they run one at a time.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

/// <summary>An engine whose renders succeed with a 200 x 100 px diagram unless told otherwise.</summary>
internal sealed class FakeEngine : IEngineClient
{
    public List<string> Calls { get; } = [];
    public List<(string Code, int Seq)> Renders { get; } = [];
    public List<int> Clears { get; } = [];
    public string? Locale { get; private set; }

    /// <summary>Overrides the next renders' results, in order.</summary>
    public Queue<Func<string, int, Task<RenderResult>>> NextRenders { get; } = new();

    public double? Width { get; set; } = 200;
    public double? Height { get; set; } = 100;
    public bool IsFlowchart { get; set; } = true;
    public Exception? TableError { get; set; }
    public string TableCode { get; set; } = "graph TD\n    n1[\"A\"] --> n2[\"B\"]";
    public TableData? LastTable { get; private set; }
    public string? LastTableKind { get; private set; }

    public static readonly ShapeModel Model = new([], [], []);

    public IReadOnlyList<Template> Templates { get; } =
    [
        new("flowchart", "Flowchart", "graph TD\n    A --> B"),
        new("pie", "Pie", "pie\n    \"A\" : 1"),
    ];

    public Task InitAsync(string locale)
    {
        Locale = locale;
        return Task.CompletedTask;
    }

    public Task<RenderResult> RenderAsync(string code, int seq)
    {
        Renders.Add((code, seq));
        return NextRenders.TryDequeue(out var next)
            ? next(code, seq)
            : Task.FromResult(new RenderResult(seq, Width, Height));
    }

    public Task ClearAsync(int seq)
    {
        Clears.Add(seq);
        return Task.CompletedTask;
    }

    public Task<RasterResult> RasterAsync(int seq, string format, double scale)
    {
        Calls.Add($"raster {seq} {format} {scale}");
        return Task.FromResult(new RasterResult(Convert.ToBase64String([1, 2, 3]), 200 * scale, 100 * scale));
    }

    public Task<string> SvgAsync(int seq, double scale)
    {
        Calls.Add($"svg {seq} {scale}");
        return Task.FromResult($"<svg scale=\"{scale}\"/>");
    }

    public Task<OfficeSvgResult> OfficeSvgAsync(int seq)
    {
        Calls.Add($"officeSvg {seq}");
        return Task.FromResult(new OfficeSvgResult("<svg office/>", 200, 100));
    }

    public Task<ShapeModel> ShapeModelAsync(int seq, double scale)
    {
        Calls.Add($"shapeModel {seq} {scale}");
        return IsFlowchart
            ? Task.FromResult(Model)
            : Task.FromException<ShapeModel>(new EngineException("notFlowchart", "Shapes format supports flowcharts only."));
    }

    public Task<string> FromTableAsync(TableData table, string kind)
    {
        LastTable = table;
        LastTableKind = kind;
        return TableError is null ? Task.FromResult(TableCode) : Task.FromException<string>(TableError);
    }

    public Task<IReadOnlyList<Template>> TemplatesAsync() => Task.FromResult(Templates);
}

internal sealed class FakeExcel : IExcelGateway
{
    private int _nextId = 100;

    public ExcelStatus Status { get; set; } = new(ExcelState.Connected, "Book1.xlsx");
    public List<DiagramItem> Diagrams { get; } = [];
    public Dictionary<string, double> Widths { get; } = [];
    public List<string> Calls { get; } = [];
    public bool SvgSupported { get; set; } = true;
    public bool ListFails { get; set; }
    public Exception? InsertError { get; set; }
    public TableData Table { get; set; } = new([["A", "B"]], [["A", "B"]], [["", ""]], 1, false);
    public Exception? ReadError { get; set; }
    public string? SelectedShapeId { get; set; }
    /// <summary>Makes the next Locate report a different target.</summary>
    public bool TargetChangesOnNextLocate { get; set; }
    public bool Closed { get; set; }

    public event EventHandler? SheetChanged;

    public void RaiseSheetChanged() => SheetChanged?.Invoke(this, EventArgs.Empty);

    public bool Locate(bool quiet = false)
    {
        bool changed = TargetChangesOnNextLocate;
        TargetChangesOnNextLocate = false;
        return changed;
    }

    public bool CheckClosed()
    {
        if (!Closed)
        {
            return false;
        }
        Status = ExcelStatus.NotFound;
        return true;
    }

    public IReadOnlyList<DiagramItem> ListDiagrams()
    {
        Calls.Add("list");
        return ListFails ? throw new ExcelException("boom") : Diagrams.ToList();
    }

    public double GetDiagramWidth(string id) =>
        Widths.TryGetValue(id, out var width) ? width : throw new ExcelException("Selected diagram no longer exists.");

    public bool IsSvgInsertSupported() => SvgSupported;

    public string InsertPicture(byte[] data, string extension, double widthPt, double heightPt, string code, string? replaceId)
    {
        Calls.Add($"picture {extension} {widthPt} {heightPt} {replaceId ?? "-"}");
        return Insert(code, replaceId);
    }

    public string InsertShapes(ShapeModel model, string code, string? replaceId)
    {
        Calls.Add($"shapes {replaceId ?? "-"}");
        return Insert(code, replaceId);
    }

    private string Insert(string code, string? replaceId)
    {
        if (InsertError is not null)
        {
            throw InsertError;
        }
        string id = (_nextId++).ToString();
        string name = $"Diagram {id}";
        if (replaceId is not null)
        {
            var old = Diagrams.Single(d => d.Id == replaceId);
            Diagrams.Remove(old);
            name = old.Name;
        }
        Diagrams.Add(new DiagramItem(id, name, code));
        LastInsertedCode = code;
        return id;
    }

    public string? LastInsertedCode { get; private set; }

    public TableData ReadSelection() => ReadError is not null ? throw ReadError : Table;

    public string? GetSelectedShapeId(bool quiet) => SelectedShapeId;

    public void Dispose()
    {
    }
}

internal sealed class FakeDialogs : IDialogService
{
    public List<(string Name, string Filter, byte[] Data)> Saved { get; } = [];
    public string? OpenResult { get; set; }
    public (byte[] Png, string Svg)? Copied { get; private set; }
    /// <summary>Thrown by the next file or clipboard operations instead of doing them.</summary>
    public Exception? Error { get; set; }

    public bool SaveFile(string defaultName, string filter, byte[] data)
    {
        if (Error is not null)
        {
            throw Error;
        }
        Saved.Add((defaultName, filter, data));
        return true;
    }

    public string? OpenText(string filter) => Error is not null ? throw Error : OpenResult;

    public void CopyImage(byte[] png, string svg) => Copied = Error is not null ? throw Error : (png, svg);
}
