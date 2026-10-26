using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Text;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop.ViewModels;

public sealed record Option(string Value, string Label);

/// <summary>
/// The window's state, following the add-in's task pane (taskpane.ts) and its
/// rules in the specification §4.3, §4.10, §4.12 and §4.13.
/// </summary>
public sealed class MainViewModel : ObservableObject
{
    public const string InitialCode =
        "graph LR\n    A[Start] --> B{Condition}\n    B -->|Yes| C[Process A]\n    B -->|No| D[Process B]\n    C --> E[End]\n    D --> E";

    private static readonly TimeSpan s_renderDebounce = TimeSpan.FromMilliseconds(250);
    private const double PxToPt = 0.75;

    private readonly IEngineClient _engine;
    private readonly IExcelGateway _excel;
    private readonly IDialogService _dialogs;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;

    private string _code = InitialCode;
    // Code last loaded from or inserted into a diagram (or the initial sample).
    // Anything else in the editor is unsaved and asks before being replaced.
    private string _savedCode = InitialCode;
    private int _renderSeq;
    // The render shown in the preview, or 0 while there is none to output.
    private int _renderedSeq;
    private double? _renderedWidth;
    private double? _renderedHeight;
    private CancellationTokenSource? _debounce;
    private IReadOnlyList<DiagramItem> _items = [];
    private DiagramItem? _pendingLoad;
    private string? _lastPolledId;

    public MainViewModel(
        IEngineClient engine,
        IExcelGateway excel,
        IDialogService dialogs,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _engine = engine;
        _excel = excel;
        _dialogs = dialogs;
        _delay = delay ?? Task.Delay;
        _excel.SheetChanged += (_, _) => OnSheetChanged();

        Formats =
        [
            new("png", "PNG"),
            new("jpeg", "JPEG"),
            new("svg", "SVG"),
            new("svg-office", Strings.Get("FormatSvgOffice")),
            new("shapes", Strings.Get("FormatShapes")),
        ];
        SaveFormats = Formats.Where(f => f.Value != "shapes").ToList();
        Sizes =
        [
            new("0.5", "50%"),
            new("0.75", "75%"),
            new("1", "100%"),
            new("1.5", "150%"),
            new("2", "200%"),
            new("width", Strings.Get("SizeWidth")),
        ];
        TableKinds =
        [
            new("auto", Strings.Get("TableAuto")),
            new("flowchart", "Flowchart"),
            new("gantt", "Gantt"),
            new("pie", "Pie"),
        ];
        DiagramOptions = [NoDiagram];

        InsertCommand = new RelayCommand(_ => InsertAsync(Format), () => CanInsert);
        InsertAsCommand = new RelayCommand(f => InsertAsync(f ?? Format));
        SaveCommand = new RelayCommand(_ => SaveAsync(Format), () => CanSave);
        SaveAsCommand = new RelayCommand(f => SaveAsync(f ?? Format));
        CopyCommand = new RelayCommand(_ => CopyAsync());
        TemplateCommand = new RelayCommand(id => UseTemplateAsync(id ?? ""));
        FromCellsCommand = new RelayCommand(kind => GenerateFromCellsAsync(kind ?? "auto"));
        ReplaceCommand = new RelayCommand(_ => _pendingLoad is { } item ? LoadDiagramAsync(item) : Task.CompletedTask);
        KeepCommand = new RelayCommand(HideConfirm);
        RefreshCommand = new RelayCommand(() => RefreshDiagrams());
        LoadSelectedCommand = new RelayCommand(_ => LoadSelectedAsync());
        OpenMmdCommand = new RelayCommand(_ => OpenMmdAsync());
        SaveMmdCommand = new RelayCommand(SaveMmd);
        GoToErrorLineCommand = new RelayCommand(() =>
        {
            if (ErrorLine is int line)
            {
                GoToLineRequested?.Invoke(this, line);
            }
        });
    }

    // ── Events for the view ────────────────────────────────────────────────

    /// <summary>The view model replaced the code; the editor shows the new text.</summary>
    public event EventHandler<string>? CodeReplaced;

    /// <summary>Select the 0-based line in the editor and scroll it into view.</summary>
    public event EventHandler<int>? GoToLineRequested;

    // ── Commands ───────────────────────────────────────────────────────────

    public RelayCommand InsertCommand { get; }
    public RelayCommand InsertAsCommand { get; }
    public RelayCommand SaveCommand { get; }
    public RelayCommand SaveAsCommand { get; }
    public RelayCommand CopyCommand { get; }
    public RelayCommand TemplateCommand { get; }
    public RelayCommand FromCellsCommand { get; }
    public RelayCommand ReplaceCommand { get; }
    public RelayCommand KeepCommand { get; }
    public RelayCommand RefreshCommand { get; }
    public RelayCommand LoadSelectedCommand { get; }
    public RelayCommand OpenMmdCommand { get; }
    public RelayCommand SaveMmdCommand { get; }
    public RelayCommand GoToErrorLineCommand { get; }

    // ── Choices ────────────────────────────────────────────────────────────

    public IReadOnlyList<Option> Formats { get; }
    public IReadOnlyList<Option> SaveFormats { get; }
    public IReadOnlyList<Option> Sizes { get; }
    public IReadOnlyList<Option> TableKinds { get; }

    private ObservableCollection<Template> _templates = [];
    public ObservableCollection<Template> Templates
    {
        get => _templates;
        private set => Set(ref _templates, value);
    }

    // ── Editor and preview ─────────────────────────────────────────────────

    /// <summary>The editor's text with \n line breaks.</summary>
    public string Code => _code;

    private string _errorText = "";
    public string ErrorText
    {
        get => _errorText;
        private set => Set(ref _errorText, value);
    }

    private int? _errorLine;
    /// <summary>The 0-based line the render error points at, for "Go to line N".</summary>
    public int? ErrorLine
    {
        get => _errorLine;
        private set
        {
            if (Set(ref _errorLine, value))
            {
                OnPropertyChanged(nameof(GoToLineText));
            }
        }
    }

    public string GoToLineText => ErrorLine is int line ? Strings.Format("GoToLine", line + 1) : "";

    private int? _highlightedLine;
    /// <summary>The editor line highlighted as the render error's; kept while editing until the next render.</summary>
    public int? HighlightedLine
    {
        get => _highlightedLine;
        private set => Set(ref _highlightedLine, value);
    }

    private bool _actionsEnabled;
    /// <summary>The preview shows the current code, so it can be inserted or saved.</summary>
    public bool ActionsEnabled
    {
        get => _actionsEnabled;
        private set
        {
            if (Set(ref _actionsEnabled, value))
            {
                UpdateCommands();
            }
        }
    }

    private bool _isBusy;
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (Set(ref _isBusy, value))
            {
                UpdateCommands();
            }
        }
    }

    public bool CanInsert => ActionsEnabled && !IsBusy && ExcelStatus.State == ExcelState.Connected;

    public bool CanSave => ActionsEnabled && !IsBusy && Format != "shapes";

    private void UpdateCommands()
    {
        OnPropertyChanged(nameof(CanInsert));
        OnPropertyChanged(nameof(CanSave));
        InsertCommand.RaiseCanExecuteChanged();
        SaveCommand.RaiseCanExecuteChanged();
    }

    // ── Output format and size ─────────────────────────────────────────────

    private string _format = "png";
    public string Format
    {
        get => _format;
        set
        {
            if (Formats.Any(f => f.Value == value) && Set(ref _format, value))
            {
                UpdateCommands();
                UpdateSizeControls();
            }
        }
    }

    /// <summary>"SVG (for shape conversion)" stays at the actual size: Convert to Shape keeps the font sizes.</summary>
    private bool IsFixedSize => Format == "svg-office";

    private string _size = "1";
    public string Size
    {
        get => _size;
        set
        {
            if (!Sizes.Any(s => s.Value == value) || !Set(ref _size, value))
            {
                return;
            }
            // Start the width at the diagram's actual width.
            if (value == "width" && WidthText == "" && _renderedWidth is > 0 and var width)
            {
                WidthText = Math.Round(width * PxToPt).ToString(CultureInfo.InvariantCulture);
            }
            UpdateSizeControls();
        }
    }

    private string _widthText = "";
    public string WidthText
    {
        get => _widthText;
        set => Set(ref _widthText, value ?? "");
    }

    private bool _keepCurrentSize = true;
    public bool KeepCurrentSize
    {
        get => _keepCurrentSize;
        set => Set(ref _keepCurrentSize, value);
    }

    public bool SizeEnabled => !IsFixedSize;

    public bool WidthVisible => Size == "width";

    /// <summary>Keep current size applies only when replacing a diagram.</summary>
    public bool KeepSizeEnabled => !IsFixedSize && CurrentDiagramId != "";

    private void UpdateSizeControls()
    {
        OnPropertyChanged(nameof(SizeEnabled));
        OnPropertyChanged(nameof(WidthVisible));
        OnPropertyChanged(nameof(KeepSizeEnabled));
    }

    /// <summary>The diagram's actual width in points.</summary>
    private double ActualWidthPt() =>
        _renderedWidth is > 0 and var width ? width * PxToPt : throw new UserException(Strings.Get("SizeUnknown"));

    /// <summary>The scale chosen in Size, relative to the diagram's actual size.</summary>
    private double ChosenScale()
    {
        if (IsFixedSize)
        {
            return 1;
        }
        if (Size != "width")
        {
            return double.Parse(Size, CultureInfo.InvariantCulture);
        }
        if (!double.TryParse(WidthText, NumberStyles.Float, CultureInfo.CurrentCulture, out double width) || !(width > 0))
        {
            throw new UserException(Strings.Get("EnterWidth"));
        }
        return width / ActualWidthPt();
    }

    /// <summary>The scale for inserting; Keep current size matches the replaced diagram's width.</summary>
    private double InsertScale(string? replaceId) =>
        replaceId is not null && KeepSizeEnabled && KeepCurrentSize
            ? _excel.GetDiagramWidth(replaceId) / ActualWidthPt()
            : ChosenScale();

    // ── Diagrams on the sheet ──────────────────────────────────────────────

    private static Option NoDiagram => new("", Strings.Get("NoDiagramSelected"));

    public ObservableCollection<Option> DiagramOptions { get; }

    private string _currentDiagramId = "";
    /// <summary>The diagram the editor holds: the dropdown shows it and Insert replaces it.</summary>
    public string CurrentDiagramId
    {
        get => _currentDiagramId;
        private set
        {
            if (Set(ref _currentDiagramId, value))
            {
                UpdateSizeControls();
            }
        }
    }

    private bool _confirmVisible;
    public bool ConfirmVisible
    {
        get => _confirmVisible;
        private set => Set(ref _confirmVisible, value);
    }

    private string _confirmText = "";
    public string ConfirmText
    {
        get => _confirmText;
        private set => Set(ref _confirmText, value);
    }

    private ExcelStatus _excelStatus = ExcelStatus.NotFound;
    public ExcelStatus ExcelStatus
    {
        get => _excelStatus;
        private set
        {
            if (Set(ref _excelStatus, value))
            {
                OnPropertyChanged(nameof(ExcelStatusText));
                OnPropertyChanged(nameof(IsExcelConnected));
                OnPropertyChanged(nameof(IsExcelFound));
                UpdateCommands();
            }
        }
    }

    public bool IsExcelConnected => ExcelStatus.State == ExcelState.Connected;

    /// <summary>Excel is running and reachable (cells and the diagram list need it).</summary>
    public bool IsExcelFound => ExcelStatus.State is ExcelState.Connected or ExcelState.NoWorkbook;

    public string ExcelStatusText => ExcelStatus.State == ExcelState.Connected
        ? Strings.Format("ExcelConnected", ExcelStatus.WorkbookName ?? "")
        : ExcelGateway.StatusMessage(ExcelStatus);

    private bool _autoDetectSelection = true;
    /// <summary>Load diagrams selected on the sheet while the window is in the background (design §5.4).</summary>
    public bool AutoDetectSelection
    {
        get => _autoDetectSelection;
        set => Set(ref _autoDetectSelection, value);
    }

    // ── Startup ────────────────────────────────────────────────────────────

    /// <summary>Starts the engine, renders the sample code and lists the sheet's diagrams.</summary>
    public async Task InitializeAsync()
    {
        await _engine.InitAsync(Strings.Locale);
        Templates = new ObservableCollection<Template>(await _engine.TemplatesAsync());
        UpdateSizeControls();
        await RenderAsync();
        RefreshDiagrams();
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    /// <summary>The user edited the code: block outputs until the next render, which waits for typing to pause.</summary>
    public void OnCodeEdited(string text)
    {
        _code = Normalize(text);
        // The preview no longer matches the code; discard any render in progress.
        _renderSeq++;
        _renderedSeq = 0;
        ActionsEnabled = false;
        _debounce?.Cancel();
        _debounce = new CancellationTokenSource();
        DebouncedRender = DebouncedRenderAsync(_debounce.Token);
    }

    /// <summary>The render waiting for typing to pause (for tests).</summary>
    internal Task? DebouncedRender { get; private set; }

    private async Task DebouncedRenderAsync(CancellationToken token)
    {
        try
        {
            await _delay(s_renderDebounce, token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        if (!token.IsCancellationRequested)
        {
            await RenderAsync();
        }
    }

    private static string Normalize(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    public async Task RenderAsync()
    {
        _debounce?.Cancel();
        int seq = ++_renderSeq;
        _renderedSeq = 0;
        ClearError();
        ActionsEnabled = false;

        string source = _code;
        if (source.Trim() == "")
        {
            HighlightedLine = null;
            await _engine.ClearAsync(seq);
            return;
        }
        try
        {
            var result = await _engine.RenderAsync(source, seq);
            if (seq != _renderSeq)
            {
                return;
            }
            _renderedSeq = seq;
            _renderedWidth = result.Width;
            _renderedHeight = result.Height;
            HighlightedLine = null;
            ActionsEnabled = true;
        }
        catch (EngineException e)
        {
            if (seq != _renderSeq || e.Code == "stale")
            {
                return;
            }
            ShowError(Strings.Format("RenderError", e.Message));
            ErrorLine = e.Line;
            HighlightedLine = e.Line;
        }
    }

    private void ClearError()
    {
        ErrorText = "";
        ErrorLine = null;
    }

    private void ShowError(string text)
    {
        ErrorText = text;
        ErrorLine = null;
    }

    // ── New code (template, cells, .mmd) ───────────────────────────────────

    private void SetCode(string code)
    {
        _code = Normalize(code);
        _debounce?.Cancel();
        CodeReplaced?.Invoke(this, _code);
    }

    /// <summary>Puts new code in the editor and renders it right away, as a new diagram.</summary>
    private async Task StartNewDiagramAsync(string code)
    {
        SetCode(code);
        // The new code is a new diagram, so don't replace the selected one.
        HideConfirm();
        CurrentDiagramId = "";
        await RenderAsync();
    }

    public async Task UseTemplateAsync(string id)
    {
        if (Templates.FirstOrDefault(t => t.Id == id) is { } template)
        {
            ClearError();
            await StartNewDiagramAsync(template.Code);
        }
    }

    public async Task GenerateFromCellsAsync(string kind)
    {
        ClearError();
        string code;
        try
        {
            EnsureTarget();
            if (!IsExcelConnected)
            {
                throw new UserException(ExcelGateway.StatusMessage(ExcelStatus));
            }
            code = await _engine.FromTableAsync(_excel.ReadSelection(), kind);
        }
        catch (Exception e) when (e is UserException or ExcelException or EngineException)
        {
            ShowError(Strings.Format("GenerateError", e.Message));
            return;
        }
        await StartNewDiagramAsync(code);
    }

    public async Task OpenMmdAsync()
    {
        if (_dialogs.OpenText(Strings.Get("MmdFilter")) is { } text)
        {
            ClearError();
            await StartNewDiagramAsync(text);
        }
    }

    public void SaveMmd() =>
        _dialogs.SaveFile("diagram.mmd", Strings.Get("MmdFilter"), new UTF8Encoding(false).GetBytes(_code));

    // ── Loading diagrams ───────────────────────────────────────────────────

    /// <summary>Finds the target Excel again; when it changed, starts over with its diagrams.</summary>
    private bool EnsureTarget(bool quiet = false)
    {
        bool changed = _excel.Locate(quiet);
        ExcelStatus = _excel.Status;
        if (changed)
        {
            HideConfirm();
            UpdateDiagramOptions(TryList(), "");
        }
        return changed;
    }

    private IReadOnlyList<DiagramItem> TryList()
    {
        if (_excel.Status.State != ExcelState.Connected)
        {
            return [];
        }
        try
        {
            return _excel.ListDiagrams();
        }
        catch (ExcelException)
        {
            // Ignore load failures so rendering and inserting remain available.
            return [];
        }
        finally
        {
            ExcelStatus = _excel.Status;
        }
    }

    /// <summary>Reloads the sheet's diagrams, keeping the current one when it is still there.</summary>
    public void RefreshDiagrams(string? selectedId = null)
    {
        bool changed = EnsureTarget();
        UpdateDiagramOptions(TryList(), changed ? "" : selectedId ?? CurrentDiagramId);
    }

    private void UpdateDiagramOptions(IReadOnlyList<DiagramItem> items, string selectedId)
    {
        _items = items;
        DiagramOptions.Clear();
        DiagramOptions.Add(NoDiagram);
        foreach (var item in items)
        {
            DiagramOptions.Add(new Option(item.Id, item.Name));
        }
        SetCurrentDiagram(selectedId);
    }

    private void SetCurrentDiagram(string id)
    {
        CurrentDiagramId = _items.Any(item => item.Id == id) ? id : "";
    }

    /// <summary>The user picked an entry in the dropdown; the view then shows <see cref="CurrentDiagramId"/>.</summary>
    public async Task ChooseDiagramAsync(string id)
    {
        if (_items.FirstOrDefault(item => item.Id == id) is not { } item)
        {
            // "(No diagram selected)": insert as a new diagram, keeping the code.
            HideConfirm();
            SetCurrentDiagram("");
            return;
        }
        // Stay on the current diagram until the load actually happens.
        await RequestLoadAsync(item);
    }

    private async Task LoadDiagramAsync(DiagramItem item)
    {
        HideConfirm();
        SetCurrentDiagram(item.Id);
        SetCode(item.Code);
        _savedCode = item.Code.Trim();
        await RenderAsync();
    }

    /// <summary>Loads a diagram, first asking when that would discard unsaved code.</summary>
    private async Task RequestLoadAsync(DiagramItem item)
    {
        string code = _code.Trim();
        if (code == "" || code == _savedCode || code == item.Code.Trim())
        {
            await LoadDiagramAsync(item);
            return;
        }
        _pendingLoad = item;
        ConfirmText = Strings.Format("LoadConfirm", item.Name);
        ConfirmVisible = true;
    }

    private void HideConfirm()
    {
        _pendingLoad = null;
        ConfirmVisible = false;
    }

    /// <summary>A diagram was selected on the sheet.</summary>
    public async Task OnDiagramSelectedOnSheetAsync(string id)
    {
        // Selecting the diagram being edited (e.g. to see it) keeps the edits.
        if (id == CurrentDiagramId)
        {
            HideConfirm();
            return;
        }
        if (_items.FirstOrDefault(d => d.Id == id) is { } item)
        {
            await RequestLoadAsync(item);
        }
    }

    private void OnSheetChanged()
    {
        // Reload the list for the newly active sheet or workbook.
        HideConfirm();
        RefreshDiagrams("");
    }

    /// <summary>The window became active: the target may be another Excel window now.</summary>
    public void OnActivated() => RefreshDiagrams();

    /// <summary>Checks whether the target Excel window was closed (every second).</summary>
    public void CheckExcelClosed()
    {
        if (_excel.CheckClosed())
        {
            ExcelStatus = _excel.Status;
            HideConfirm();
            UpdateDiagramOptions([], "");
        }
    }

    /// <summary>
    /// While the window is in the background: loads a diagram newly selected on
    /// the sheet (COM has no event for shape selection). Never waits for a
    /// busy Excel and shows no errors.
    /// </summary>
    public async Task PollSelectionAsync()
    {
        if (!AutoDetectSelection || IsBusy)
        {
            return;
        }
        string? id;
        try
        {
            EnsureTarget(quiet: true);
            if (!IsExcelConnected)
            {
                _lastPolledId = null;
                return;
            }
            id = _excel.GetSelectedShapeId(quiet: true);
        }
        catch (ExcelException)
        {
            ExcelStatus = _excel.Status;
            return;
        }
        if (id == _lastPolledId)
        {
            return;
        }
        _lastPolledId = id;
        if (id is null)
        {
            return;
        }
        if (!_items.Any(item => item.Id == id))
        {
            // Inserted since the last refresh, or on a sheet switched to without an event.
            using (MessageFilter.Quiet())
            {
                UpdateDiagramOptions(TryList(), CurrentDiagramId);
            }
        }
        await OnDiagramSelectedOnSheetAsync(id);
    }

    /// <summary>Loads the diagram selected on the sheet (the manual form of the polling).</summary>
    public async Task LoadSelectedAsync()
    {
        ClearError();
        try
        {
            RefreshDiagrams();
            if (!IsExcelConnected)
            {
                throw new UserException(ExcelGateway.StatusMessage(ExcelStatus));
            }
            if (_excel.GetSelectedShapeId(quiet: false) is not { } id || !_items.Any(item => item.Id == id))
            {
                throw new UserException(Strings.Get("SelectDiagramOnSheet"));
            }
            _lastPolledId = id;
            await OnDiagramSelectedOnSheetAsync(id);
        }
        catch (Exception e) when (e is UserException or ExcelException)
        {
            ShowError(e.Message);
        }
    }

    // ── Insert / Save / Copy ───────────────────────────────────────────────

    /// <summary>
    /// Runs an action on the rendered diagram and reports any failure. Code
    /// typed since the last render (or still rendering) is rendered first.
    /// </summary>
    private async Task WithRenderedAsync(string errorKey, Func<int, Task> action)
    {
        if (IsBusy)
        {
            return;
        }
        if (ActionsEnabled)
        {
            ClearError();
        }
        else
        {
            await RenderAsync();
        }
        if (_renderedSeq == 0)
        {
            // Keep a render error, which tells more than this.
            if (ErrorText == "")
            {
                ShowError(Strings.Get("PleaseRenderFirst"));
            }
            return;
        }
        IsBusy = true;
        try
        {
            await action(_renderedSeq);
        }
        catch (Exception e) when (e is UserException or ExcelException or EngineException or IOException or UnauthorizedAccessException)
        {
            ShowError(Strings.Format(errorKey, e.Message));
        }
        finally
        {
            IsBusy = false;
        }
    }

    public Task InsertAsync(string format)
    {
        Format = format;
        return WithRenderedAsync("InsertError", async seq =>
        {
            string code = _code.Trim();
            string? replaceId = CurrentDiagramId == "" ? null : CurrentDiagramId;
            if (EnsureTarget() && replaceId is not null)
            {
                throw new UserException(Strings.Get("DiagramNoLongerExists"));
            }
            if (!IsExcelConnected)
            {
                throw new UserException(ExcelGateway.StatusMessage(ExcelStatus));
            }

            string insertedId;
            if (format == "shapes")
            {
                var model = await _engine.ShapeModelAsync(seq, InsertScale(replaceId));
                insertedId = _excel.InsertShapes(model, code, replaceId);
            }
            else if (format is "svg" or "svg-office")
            {
                if (!_excel.IsSvgInsertSupported())
                {
                    throw new UserException(Strings.Get("SvgNotSupported"));
                }
                double scale = InsertScale(replaceId);
                string svg;
                double width, height;
                if (format == "svg")
                {
                    svg = await _engine.SvgAsync(seq, 1);
                    (width, height) = (_renderedWidth ?? 0, _renderedHeight ?? 0);
                }
                else
                {
                    var office = await _engine.OfficeSvgAsync(seq);
                    (svg, width, height) = (office.Svg, office.Width, office.Height);
                }
                insertedId = _excel.InsertPicture(
                    Encoding.UTF8.GetBytes(svg), "svg", width * scale * PxToPt, height * scale * PxToPt, code, replaceId);
            }
            else
            {
                var image = await _engine.RasterAsync(seq, format, InsertScale(replaceId));
                insertedId = _excel.InsertPicture(
                    Convert.FromBase64String(image.Base64),
                    format == "jpeg" ? "jpg" : "png",
                    image.Width * PxToPt,
                    image.Height * PxToPt,
                    code,
                    replaceId);
            }

            _savedCode = code;
            RefreshDiagrams(insertedId);
        });
    }

    public Task SaveAsync(string format)
    {
        Format = format;
        return WithRenderedAsync("SaveError", async seq =>
        {
            if (format == "shapes")
            {
                throw new UserException(Strings.Get("ShapesCannotBeSaved"));
            }
            double scale = ChosenScale();
            byte[] data;
            string extension;
            if (format == "svg")
            {
                data = Encoding.UTF8.GetBytes(await _engine.SvgAsync(seq, scale));
                extension = "svg";
            }
            else if (format == "svg-office")
            {
                data = Encoding.UTF8.GetBytes((await _engine.OfficeSvgAsync(seq)).Svg);
                extension = "svg";
            }
            else
            {
                data = Convert.FromBase64String((await _engine.RasterAsync(seq, format, scale)).Base64);
                extension = format == "jpeg" ? "jpg" : "png";
            }
            _dialogs.SaveFile($"diagram.{extension}", Strings.Get($"Filter_{extension}"), data);
        });
    }

    /// <summary>Copies the diagram as PNG and SVG at the chosen size.</summary>
    public Task CopyAsync() => WithRenderedAsync("CopyError", async seq =>
    {
        double scale = IsFixedSize ? 1 : ChosenScale();
        var png = await _engine.RasterAsync(seq, "png", scale);
        string svg = await _engine.SvgAsync(seq, scale);
        _dialogs.CopyImage(Convert.FromBase64String(png.Base64), svg);
    });
}

/// <summary>An error caused by the user's input, shown as is.</summary>
public sealed class UserException(string message) : Exception(message);
