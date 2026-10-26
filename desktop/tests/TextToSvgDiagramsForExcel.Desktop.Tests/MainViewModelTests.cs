using System.Globalization;
using System.Text;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.ViewModels;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

/// <summary>The same rules as the add-in's task pane (test/taskpane.test.ts).</summary>
public class MainViewModelTests
{
    /// <summary>A debounce delay that finishes only when fired.</summary>
    private sealed class ManualDelay
    {
        private readonly List<TaskCompletionSource> _pending = [];

        public Task Delay(TimeSpan duration, CancellationToken token)
        {
            var tcs = new TaskCompletionSource();
            token.Register(() => tcs.TrySetCanceled(token));
            _pending.Add(tcs);
            return tcs.Task;
        }

        public void Fire()
        {
            foreach (var tcs in _pending)
            {
                tcs.TrySetResult();
            }
            _pending.Clear();
        }
    }

    private readonly FakeEngine _engine = new();
    private readonly FakeExcel _excel = new();
    private readonly FakeDialogs _dialogs = new();
    private readonly ManualDelay _delay = new();
    private string? _editor;

    private static readonly DiagramItem D1 = new("1", "Diagram 1", "graph TD\n    X --> Y");
    private static readonly DiagramItem D2 = new("2", "Diagram 2", "pie\n    \"A\" : 1");

    public MainViewModelTests()
    {
        Strings.Culture = CultureInfo.GetCultureInfo("en-US");
    }

    private async Task<MainViewModel> StartAsync(params DiagramItem[] diagrams)
    {
        _excel.Diagrams.AddRange(diagrams);
        var vm = new MainViewModel(_engine, _excel, _dialogs, _delay.Delay);
        vm.CodeReplaced += (_, code) => _editor = code;
        await vm.InitializeAsync();
        return vm;
    }

    /// <summary>Types code and waits for the debounced render.</summary>
    private async Task TypeAsync(MainViewModel vm, string code)
    {
        vm.OnCodeEdited(code);
        _delay.Fire();
        await vm.DebouncedRender!;
    }

    private static Func<string, int, Task<RenderResult>> Fails(string message, int? line = null) =>
        (_, _) => Task.FromException<RenderResult>(new EngineException("render", message, line));

    // ── Startup ────────────────────────────────────────────────────────────

    [Fact]
    public async Task StartsTheEngineAndRendersTheSampleCode()
    {
        var vm = await StartAsync(D1);

        Assert.Equal("en", _engine.Locale);
        Assert.Equal([(MainViewModel.InitialCode, 1)], _engine.Renders);
        Assert.True(vm.ActionsEnabled);
        Assert.True(vm.CanInsert);
        Assert.Equal(["Flowchart", "Pie"], vm.Templates.Select(t => t.Name));
        Assert.Equal(["(No diagram selected)", "Diagram 1"], vm.DiagramOptions.Select(o => o.Label));
        Assert.Equal("Excel: Book1.xlsx", vm.ExcelStatusText);
    }

    [Fact]
    public async Task UsesJapaneseWhenChosen()
    {
        Strings.Culture = CultureInfo.GetCultureInfo("ja-JP");
        var vm = await StartAsync();

        Assert.Equal("ja", _engine.Locale);
        Assert.Equal("(図を選択していません)", vm.DiagramOptions[0].Label);
    }

    [Fact]
    public async Task WorksWithoutExcel()
    {
        _excel.Status = ExcelStatus.NotFound;
        var vm = await StartAsync();

        Assert.True(vm.ActionsEnabled);
        Assert.False(vm.CanInsert);
        Assert.True(vm.CanSave);
        Assert.Equal("Excel not found", vm.ExcelStatusText);
        Assert.DoesNotContain("list", _excel.Calls);
    }

    // ── Preview ────────────────────────────────────────────────────────────

    [Fact]
    public async Task RendersAfterTypingPauses()
    {
        var vm = await StartAsync();
        vm.OnCodeEdited("graph TD\nA");
        vm.OnCodeEdited("graph TD\nA-->B");

        Assert.False(vm.ActionsEnabled);
        Assert.Single(_engine.Renders);

        _delay.Fire();
        await vm.DebouncedRender!;

        Assert.Equal("graph TD\nA-->B", _engine.Renders[^1].Code);
        Assert.Equal(2, _engine.Renders.Count);
        Assert.True(vm.ActionsEnabled);
    }

    [Fact]
    public async Task UsesNewlinesForTheEditorsLineBreaks()
    {
        var vm = await StartAsync();
        await TypeAsync(vm, "graph TD\r\nA\rB");

        Assert.Equal("graph TD\nA\nB", _engine.Renders[^1].Code);
        Assert.Equal("graph TD\nA\nB", vm.Code);
    }

    [Fact]
    public async Task ShowsTheHintAndDisablesActionsForEmptyCode()
    {
        var vm = await StartAsync();
        await TypeAsync(vm, "  \n ");

        Assert.Single(_engine.Clears);
        Assert.False(vm.ActionsEnabled);
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task ShowsRenderErrorsWithTheLine()
    {
        var vm = await StartAsync();
        int? goTo = null;
        vm.GoToLineRequested += (_, line) => goTo = line;
        _engine.NextRenders.Enqueue(Fails("Parse error on line 2:", 1));

        await TypeAsync(vm, "graph TD\n  A--");

        Assert.Equal("Render error: Parse error on line 2:", vm.ErrorText);
        Assert.Equal(1, vm.ErrorLine);
        Assert.Equal(1, vm.HighlightedLine);
        Assert.Equal("Go to line 2", vm.GoToLineText);
        Assert.False(vm.ActionsEnabled);
        vm.GoToErrorLineCommand.Execute(null);
        Assert.Equal(1, goTo);
    }

    [Fact]
    public async Task KeepsTheHighlightWhileEditingAndClearsItOnTheNextRender()
    {
        var vm = await StartAsync();
        _engine.NextRenders.Enqueue(Fails("Parse error on line 1:", 0));
        await TypeAsync(vm, "x");

        vm.OnCodeEdited("xy");
        Assert.Equal(0, vm.HighlightedLine);

        _delay.Fire();
        await vm.DebouncedRender!;
        Assert.Null(vm.HighlightedLine);
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task DoesNotHighlightErrorsWithoutALine()
    {
        var vm = await StartAsync();
        _engine.NextRenders.Enqueue(Fails("No diagram type detected"));
        await TypeAsync(vm, "x");

        Assert.Null(vm.ErrorLine);
        Assert.Null(vm.HighlightedLine);
        Assert.Equal("", vm.GoToLineText);
    }

    [Fact]
    public async Task DiscardsARenderThatFinishesAfterANewerOne()
    {
        var vm = await StartAsync();
        var slow = new TaskCompletionSource<RenderResult>();
        _engine.NextRenders.Enqueue((_, _) => slow.Task);
        var older = vm.RenderAsync();
        await vm.RenderAsync();

        slow.SetException(new EngineException("render", "late error", 0));
        await older;

        Assert.True(vm.ActionsEnabled);
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task IgnoresStaleErrorsFromTheEngine()
    {
        var vm = await StartAsync();
        _engine.NextRenders.Enqueue((_, _) => Task.FromException<RenderResult>(new EngineException("stale", "Diagram changed.")));
        await vm.RenderAsync();

        Assert.Equal("", vm.ErrorText);
    }

    // ── Diagram dropdown ───────────────────────────────────────────────────

    [Fact]
    public async Task LoadsTheChosenDiagramAndRendersIt()
    {
        var vm = await StartAsync(D1, D2);
        await vm.ChooseDiagramAsync("1");

        Assert.Equal(D1.Code, _editor);
        Assert.Equal("1", vm.CurrentDiagramId);
        Assert.Equal(D1.Code, _engine.Renders[^1].Code);
        Assert.True(vm.KeepSizeEnabled);
    }

    [Fact]
    public async Task NoDiagramSelectedKeepsTheCode()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        _editor = null;
        await vm.ChooseDiagramAsync("");

        Assert.Equal("", vm.CurrentDiagramId);
        Assert.Null(_editor);
    }

    [Fact]
    public async Task RefreshKeepsTheSelectionWhileTheDiagramExists()
    {
        var vm = await StartAsync(D1, D2);
        await vm.ChooseDiagramAsync("2");

        vm.RefreshDiagrams();
        Assert.Equal("2", vm.CurrentDiagramId);

        _excel.Diagrams.Remove(D2);
        vm.RefreshDiagrams();
        Assert.Equal("", vm.CurrentDiagramId);
        Assert.Equal(2, vm.DiagramOptions.Count);
    }

    [Fact]
    public async Task EmptiesTheListWithoutAnErrorWhenListingFails()
    {
        var vm = await StartAsync(D1);
        _excel.ListFails = true;
        vm.RefreshDiagrams();

        Assert.Single(vm.DiagramOptions);
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task ReloadsWithoutASelectionWhenTheSheetChanges()
    {
        var vm = await StartAsync(D1, D2);
        await vm.ChooseDiagramAsync("1");
        await TypeAsync(vm, "graph TD\n  edited");
        await vm.OnDiagramSelectedOnSheetAsync("2");
        Assert.True(vm.ConfirmVisible);

        _excel.RaiseSheetChanged();

        Assert.Equal("", vm.CurrentDiagramId);
        Assert.False(vm.ConfirmVisible);
    }

    [Fact]
    public async Task StartsOverWhenTheTargetWorkbookChanges()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        _excel.TargetChangesOnNextLocate = true;

        vm.OnActivated();

        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task AsksBeforeReplacingUnsavedCode()
    {
        var vm = await StartAsync(D1);
        await TypeAsync(vm, "graph TD\n  mine");
        _editor = null;

        await vm.ChooseDiagramAsync("1");

        Assert.True(vm.ConfirmVisible);
        Assert.Equal("Load \"Diagram 1\"? The code in the editor has unsaved changes and will be replaced.", vm.ConfirmText);
        Assert.Equal("", vm.CurrentDiagramId);
        Assert.Null(_editor);
    }

    [Fact]
    public async Task ReplaceLoadsThePendingDiagram()
    {
        var vm = await StartAsync(D1);
        await TypeAsync(vm, "graph TD\n  mine");
        await vm.ChooseDiagramAsync("1");

        vm.ReplaceCommand.Execute(null);

        Assert.False(vm.ConfirmVisible);
        Assert.Equal("1", vm.CurrentDiagramId);
        Assert.Equal(D1.Code, _editor);
    }

    [Fact]
    public async Task KeepLeavesTheCodeAndTheCurrentDiagram()
    {
        var vm = await StartAsync(D1);
        await TypeAsync(vm, "graph TD\n  mine");
        await vm.ChooseDiagramAsync("1");

        vm.KeepCommand.Execute(null);

        Assert.False(vm.ConfirmVisible);
        Assert.Equal("", vm.CurrentDiagramId);
        Assert.Equal("graph TD\n  mine", vm.Code);
    }

    [Fact]
    public async Task LoadsAnotherDiagramWithoutAskingAfterLoadingOne()
    {
        var vm = await StartAsync(D1, D2);
        await vm.OnDiagramSelectedOnSheetAsync("1");
        await vm.OnDiagramSelectedOnSheetAsync("2");

        Assert.False(vm.ConfirmVisible);
        Assert.Equal("2", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task LoadsWithoutAskingWhenTheEditorIsEmptyOrHoldsTheDiagramsCode()
    {
        var vm = await StartAsync(D1, D2);
        await TypeAsync(vm, "");
        await vm.OnDiagramSelectedOnSheetAsync("1");
        Assert.Equal("1", vm.CurrentDiagramId);

        await vm.ChooseDiagramAsync("");
        await TypeAsync(vm, "  " + D2.Code + "\n");
        await vm.OnDiagramSelectedOnSheetAsync("2");
        Assert.False(vm.ConfirmVisible);
        Assert.Equal("2", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task KeepsEditsWhenTheDiagramBeingEditedIsSelected()
    {
        var vm = await StartAsync(D1, D2);
        await vm.OnDiagramSelectedOnSheetAsync("1");
        await TypeAsync(vm, "graph TD\n  edited");
        await vm.OnDiagramSelectedOnSheetAsync("2");
        Assert.True(vm.ConfirmVisible);

        await vm.OnDiagramSelectedOnSheetAsync("1");

        Assert.False(vm.ConfirmVisible);
        Assert.Equal("graph TD\n  edited", vm.Code);
    }

    [Fact]
    public async Task DoesNotAskAfterTheCodeWasInserted()
    {
        var vm = await StartAsync(D1);
        await TypeAsync(vm, "graph TD\n  new");
        await vm.InsertAsync("png");

        await vm.OnDiagramSelectedOnSheetAsync("1");

        Assert.False(vm.ConfirmVisible);
        Assert.Equal("1", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task IgnoresShapesThatAreNotListed()
    {
        var vm = await StartAsync(D1);
        await vm.OnDiagramSelectedOnSheetAsync("99");

        Assert.Equal("", vm.CurrentDiagramId);
        Assert.False(vm.ConfirmVisible);
    }

    // ── New code ───────────────────────────────────────────────────────────

    [Fact]
    public async Task TemplatesStartANewDiagram()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");

        await vm.UseTemplateAsync("pie");

        Assert.Equal(_engine.Templates[1].Code, _editor);
        Assert.Equal(_engine.Templates[1].Code, _engine.Renders[^1].Code);
        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task AsksBeforeReplacingTemplateCode()
    {
        var vm = await StartAsync(D1);
        await vm.UseTemplateAsync("pie");

        await vm.OnDiagramSelectedOnSheetAsync("1");

        Assert.True(vm.ConfirmVisible);
    }

    [Fact]
    public async Task GeneratesCodeFromTheSelectedCells()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");

        await vm.GenerateFromCellsAsync("gantt");

        Assert.Same(_excel.Table, _engine.LastTable);
        Assert.Equal("gantt", _engine.LastTableKind);
        Assert.Equal(_engine.TableCode, _editor);
        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task ReportsCellReadFailuresAndLeavesTheCodeAlone()
    {
        var vm = await StartAsync();
        _excel.ReadError = new ExcelException("Select a cell range on the sheet.");
        _editor = null;

        await vm.GenerateFromCellsAsync("auto");

        Assert.Equal("Generate error: Select a cell range on the sheet.", vm.ErrorText);
        Assert.Null(_editor);
    }

    [Fact]
    public async Task ReportsTableErrors()
    {
        var vm = await StartAsync();
        _engine.TableError = new EngineException("table", "Select at least two columns.");

        await vm.GenerateFromCellsAsync("auto");

        Assert.Equal("Generate error: Select at least two columns.", vm.ErrorText);
    }

    [Fact]
    public async Task OpensAndSavesMermaidFiles()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        _dialogs.OpenResult = "graph LR\r\n  F --> G";

        await vm.OpenMmdAsync();
        vm.SaveMmd();

        Assert.Equal("graph LR\n  F --> G", _editor);
        Assert.Equal("", vm.CurrentDiagramId);
        Assert.Equal("diagram.mmd", _dialogs.Saved[^1].Name);
        Assert.Equal("graph LR\n  F --> G", Encoding.UTF8.GetString(_dialogs.Saved[^1].Data));
    }

    // ── Insert ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task InsertsPngAtTheActualSize()
    {
        var vm = await StartAsync();
        await vm.InsertAsync("png");

        Assert.Equal(["raster 1 png 1"], _engine.Calls);
        Assert.Contains("picture png 150 75 -", _excel.Calls);
        // The list is reloaded with the new diagram selected.
        Assert.Equal("100", vm.CurrentDiagramId);
        Assert.Equal(MainViewModel.InitialCode, _excel.LastInsertedCode);
    }

    [Fact]
    public async Task ReplacesTheCurrentDiagram()
    {
        var vm = await StartAsync(D1);
        _excel.Widths["1"] = 150;
        await vm.ChooseDiagramAsync("1");

        await vm.InsertAsync("jpeg");

        Assert.Contains("picture jpg 150 75 1", _excel.Calls);
        Assert.Equal("100", vm.CurrentDiagramId);
        Assert.Equal(["(No diagram selected)", "Diagram 1"], vm.DiagramOptions.Select(o => o.Label));
    }

    [Fact]
    public async Task InsertsSvgWhenSupported()
    {
        var vm = await StartAsync();
        vm.Size = "2";
        await vm.InsertAsync("svg");

        Assert.Equal(["svg 1 1"], _engine.Calls);
        Assert.Contains("picture svg 300 150 -", _excel.Calls);
    }

    [Theory]
    [InlineData("svg")]
    [InlineData("svg-office")]
    public async Task RefusesSvgWhenExcelCannotInsertIt(string format)
    {
        var vm = await StartAsync();
        _excel.SvgSupported = false;

        await vm.InsertAsync(format);

        Assert.Equal("Insert error: SVG insertion is not supported in this version of Excel. Use PNG or JPEG.", vm.ErrorText);
        Assert.DoesNotContain(_excel.Calls, c => c.StartsWith("picture"));
    }

    [Fact]
    public async Task InsertsTheShapeConversionSvgAtTheActualSize()
    {
        var vm = await StartAsync();
        vm.Size = "2";
        await vm.InsertAsync("svg-office");

        Assert.Equal(["officeSvg 1"], _engine.Calls);
        Assert.Contains("picture svg 150 75 -", _excel.Calls);
        Assert.False(vm.SizeEnabled);
    }

    [Fact]
    public async Task InsertsNativeShapes()
    {
        var vm = await StartAsync();
        vm.Size = "0.5";
        await vm.InsertAsync("shapes");

        Assert.Equal(["shapeModel 1 0.5"], _engine.Calls);
        Assert.Contains("shapes -", _excel.Calls);
        Assert.False(vm.CanSave);
    }

    [Fact]
    public async Task RefusesShapesForOtherDiagrams()
    {
        var vm = await StartAsync();
        _engine.IsFlowchart = false;
        await vm.InsertAsync("shapes");

        Assert.Equal("Insert error: Shapes format supports flowcharts only.", vm.ErrorText);
    }

    [Fact]
    public async Task ReportsInsertFailuresAndClearsThemNextTime()
    {
        var vm = await StartAsync();
        _excel.InsertError = new ExcelException("The sheet is protected.");
        await vm.InsertAsync("png");
        Assert.Equal("Insert error: The sheet is protected.", vm.ErrorText);

        _excel.InsertError = null;
        await vm.InsertAsync("png");
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task RendersTypedCodeBeforeInserting()
    {
        var vm = await StartAsync();
        vm.OnCodeEdited("graph TD\n  typed");

        await vm.InsertAsync("png");

        Assert.Equal("graph TD\n  typed", _engine.Renders[^1].Code);
        Assert.Equal("graph TD\n  typed", _excel.LastInsertedCode);
    }

    [Fact]
    public async Task KeepsTheRenderErrorInsteadOfInserting()
    {
        var vm = await StartAsync();
        vm.OnCodeEdited("bad");
        _engine.NextRenders.Enqueue(Fails("Parse error on line 1:", 0));

        await vm.InsertAsync("png");

        Assert.Equal("Render error: Parse error on line 1:", vm.ErrorText);
        Assert.Null(_excel.LastInsertedCode);
    }

    [Fact]
    public async Task AsksToRenderFirstWhenThereIsNoDiagram()
    {
        var vm = await StartAsync();
        await TypeAsync(vm, "");

        await vm.InsertAsync("png");

        Assert.Equal("Please render first", vm.ErrorText);
    }

    [Fact]
    public async Task StopsReplacingWhenTheTargetChanged()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        _excel.TargetChangesOnNextLocate = true;

        await vm.InsertAsync("png");

        Assert.Equal("Insert error: Selected diagram no longer exists.", vm.ErrorText);
        Assert.Null(_excel.LastInsertedCode);
        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task ExplainsWhyItCannotInsertWithoutAWorkbook()
    {
        _excel.Status = new ExcelStatus(ExcelState.NoWorkbook);
        var vm = await StartAsync();

        await vm.InsertAsync("png");

        Assert.False(vm.CanInsert);
        Assert.Equal("Insert error: Open a workbook in Excel", vm.ErrorText);
    }

    // ── Save and copy ──────────────────────────────────────────────────────

    [Theory]
    [InlineData("png", "diagram.png", "raster 1 png 1")]
    [InlineData("jpeg", "diagram.jpg", "raster 1 jpeg 1")]
    [InlineData("svg", "diagram.svg", "svg 1 1")]
    [InlineData("svg-office", "diagram.svg", "officeSvg 1")]
    public async Task SavesEachFormat(string format, string name, string call)
    {
        var vm = await StartAsync();
        await vm.SaveAsync(format);

        Assert.Equal(name, _dialogs.Saved.Single().Name);
        Assert.Equal([call], _engine.Calls);
        Assert.DoesNotContain(_excel.Calls, c => c != "list");
    }

    [Fact]
    public async Task CannotSaveShapes()
    {
        var vm = await StartAsync();
        vm.Format = "shapes";
        Assert.False(vm.CanSave);
        vm.Format = "png";
        Assert.True(vm.CanSave);

        await vm.SaveAsync("shapes");
        Assert.Equal("Save error: Shapes cannot be saved as a file.", vm.ErrorText);
    }

    [Fact]
    public async Task SavesAtTheChosenSizeEvenWhileReplacing()
    {
        var vm = await StartAsync(D1);
        _excel.Widths["1"] = 600;
        await vm.ChooseDiagramAsync("1");
        vm.Size = "1.5";

        await vm.SaveAsync("svg");

        Assert.Equal(["svg 2 1.5"], _engine.Calls);
    }

    [Fact]
    public async Task CopiesPngAndSvg()
    {
        var vm = await StartAsync();
        vm.Size = "2";
        await vm.CopyAsync();

        Assert.Equal(["raster 1 png 2", "svg 1 2"], _engine.Calls);
        Assert.Equal("<svg scale=\"2\"/>", _dialogs.Copied!.Value.Svg);
    }

    // ── Output size ────────────────────────────────────────────────────────

    [Fact]
    public async Task StartsAt100PercentWithKeepCurrentSizeDisabled()
    {
        var vm = await StartAsync();

        Assert.Equal("1", vm.Size);
        Assert.True(vm.KeepCurrentSize);
        Assert.False(vm.KeepSizeEnabled);
        Assert.False(vm.WidthVisible);
    }

    [Fact]
    public async Task FixesTheSizeOfTheShapeConversionSvg()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        vm.Format = "svg-office";

        Assert.False(vm.SizeEnabled);
        Assert.False(vm.KeepSizeEnabled);
    }

    [Fact]
    public async Task StartsTheWidthAtTheActualWidth()
    {
        var vm = await StartAsync();
        vm.Size = "width";

        Assert.True(vm.WidthVisible);
        Assert.Equal("150", vm.WidthText);
    }

    [Fact]
    public async Task InsertsAtTheEnteredWidth()
    {
        var vm = await StartAsync();
        vm.Size = "width";
        vm.WidthText = "300";

        await vm.InsertAsync("png");

        Assert.Equal(["raster 1 png 2"], _engine.Calls);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("abc")]
    [InlineData("")]
    public async Task ReportsAnInvalidWidth(string width)
    {
        var vm = await StartAsync();
        vm.Size = "width";
        vm.WidthText = width;

        await vm.InsertAsync("png");

        Assert.Equal("Insert error: Enter a width greater than 0.", vm.ErrorText);
    }

    [Fact]
    public async Task KeepsTheReplacedDiagramsWidth()
    {
        var vm = await StartAsync(D1);
        _excel.Widths["1"] = 300;
        await vm.ChooseDiagramAsync("1");
        vm.Size = "0.5";

        await vm.InsertAsync("png");

        Assert.Equal(["raster 2 png 2"], _engine.Calls);
    }

    [Fact]
    public async Task UsesSizeWhenKeepCurrentSizeIsOff()
    {
        var vm = await StartAsync(D1);
        _excel.Widths["1"] = 300;
        await vm.ChooseDiagramAsync("1");
        vm.Size = "0.5";
        vm.KeepCurrentSize = false;

        await vm.InsertAsync("png");

        Assert.Equal(["raster 2 png 0.5"], _engine.Calls);
    }

    [Fact]
    public async Task ReportsWhenTheSizeIsUnknown()
    {
        _engine.Width = null;
        var vm = await StartAsync();
        vm.Size = "width";
        vm.WidthText = "100";

        await vm.InsertAsync("png");

        Assert.Equal("Insert error: The diagram's size is unknown.", vm.ErrorText);
    }

    // ── Selection on the sheet ─────────────────────────────────────────────

    [Fact]
    public async Task PollingLoadsANewlySelectedDiagramOnce()
    {
        var vm = await StartAsync(D1);
        _excel.SelectedShapeId = "1";
        await vm.PollSelectionAsync();
        Assert.Equal("1", vm.CurrentDiagramId);

        // Choosing another entry while the shape stays selected is not undone.
        await vm.ChooseDiagramAsync("");
        await vm.PollSelectionAsync();
        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task PollingReloadsTheListForUnknownShapes()
    {
        var vm = await StartAsync();
        _excel.Diagrams.Add(D1);
        _excel.SelectedShapeId = "1";

        await vm.PollSelectionAsync();

        Assert.Equal("1", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task PollingCanBeTurnedOff()
    {
        var vm = await StartAsync(D1);
        vm.AutoDetectSelection = false;
        _excel.SelectedShapeId = "1";

        await vm.PollSelectionAsync();

        Assert.Equal("", vm.CurrentDiagramId);
    }

    [Fact]
    public async Task LoadsTheSelectedDiagramOnRequest()
    {
        var vm = await StartAsync(D1);
        await vm.LoadSelectedAsync();
        Assert.Equal("Select a diagram on the sheet.", vm.ErrorText);

        _excel.SelectedShapeId = "1";
        await vm.LoadSelectedAsync();
        Assert.Equal("1", vm.CurrentDiagramId);
        Assert.Equal("", vm.ErrorText);
    }

    [Fact]
    public async Task ForgetsTheDiagramsWhenExcelCloses()
    {
        var vm = await StartAsync(D1);
        await vm.ChooseDiagramAsync("1");
        _excel.Closed = true;

        vm.CheckExcelClosed();

        Assert.Equal("Excel not found", vm.ExcelStatusText);
        Assert.Single(vm.DiagramOptions);
        Assert.Equal("", vm.CurrentDiagramId);
        Assert.False(vm.CanInsert);
    }
}
