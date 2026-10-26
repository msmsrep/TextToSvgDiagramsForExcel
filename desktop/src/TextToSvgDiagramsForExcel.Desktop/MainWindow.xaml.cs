using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;
using TextToSvgDiagramsForExcel.Desktop.ViewModels;
using TextToSvgDiagramsForExcel.Desktop.Views;

namespace TextToSvgDiagramsForExcel.Desktop;

public partial class MainWindow : Window
{
    private const string EngineHost = "app.textsvg.example";
    private const string EngineUrl = $"https://{EngineHost}/engine.html";

    private readonly Settings _settings;
    private readonly SettingsStore _settingsStore;
    private readonly ExcelGateway _excel = new(new ExcelLocator(new NativeWindowSource()));
    // Excel's window closing is checked every second (design §5.2); the
    // selection is polled while this window is in the background (§5.4).
    private readonly DispatcherTimer _closeCheck = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer _selectionPoll = new() { Interval = TimeSpan.FromMilliseconds(500) };
    private MainViewModel? _vm;
    private ErrorLineRenderer? _errorLine;
    private bool _settingEditorText;
    private bool _choosingDiagram;
    private bool _polling;
    private bool _vertical;

    public MainWindow(Settings settings, SettingsStore settingsStore)
    {
        _settings = settings;
        _settingsStore = settingsStore;
        InitializeComponent();
        RestoreWindowBounds(settings);
        Topmost = AlwaysOnTopItem.IsChecked = settings.AlwaysOnTop;
        foreach (MenuItem item in LanguageMenu.Items)
        {
            item.IsChecked = (string)item.Tag == settings.Language;
        }

        Editor.Text = MainViewModel.InitialCode;
        Editor.TextChanged += OnEditorTextChanged;
        _errorLine = new ErrorLineRenderer(Editor.TextArea.TextView);
        Editor.TextArea.TextView.BackgroundRenderers.Add(_errorLine);
        Editor.Options.ConvertTabsToSpaces = true;
        Editor.Options.IndentationSize = 4;
        Editor.Options.EnableHyperlinks = false;

        InputBindings.Add(new KeyBinding(new RelayCommand(() => _vm?.CopyCommand.Execute(null)), Key.C, ModifierKeys.Control | ModifierKeys.Shift));

        Loaded += OnLoaded;
        SizeChanged += (_, _) => UpdateOrientation();
        Activated += OnWindowActivated;
        Deactivated += (_, _) => _selectionPoll.Start();
        Closing += OnClosing;
        _closeCheck.Tick += (_, _) => _vm?.CheckExcelClosed();
        _selectionPoll.Tick += OnSelectionPoll;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        IEngineClient engine;
        try
        {
            engine = await StartEngineAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, Strings.Format("EngineFailed", ex.Message), Strings.Get("AppTitle"), MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
            return;
        }

        var vm = new MainViewModel(engine, _excel, new DialogService(this))
        {
            Format = _settings.Format,
            Size = _settings.Size,
            WidthText = _settings.Width,
            AutoDetectSelection = _settings.AutoDetectSelection,
        };
        vm.CodeReplaced += (_, code) => SetEditorText(code);
        vm.GoToLineRequested += (_, line) => GoToLine(line);
        vm.PropertyChanged += OnViewModelPropertyChanged;
        // Reloading the list clears the dropdown's selection; show the current diagram again.
        vm.DiagramOptions.CollectionChanged += (_, _) =>
            Dispatcher.BeginInvoke(ShowCurrentDiagram, DispatcherPriority.Background);
        _vm = vm;
        DataContext = vm;
        await Dispatcher.InvokeAsync(ShowCurrentDiagram, DispatcherPriority.Background);

        await vm.InitializeAsync();
        _closeCheck.Start();
        Editor.Focus();
    }

    /// <summary>Opens the engine page in the preview's WebView2 (design §4.1).</summary>
    private async Task<IEngineClient> StartEngineAsync()
    {
        var environment = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebView2Folder);
        await Preview.EnsureCoreWebView2Async(environment);
        var core = Preview.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(EngineHost, AppPaths.WebFolder, CoreWebView2HostResourceAccessKind.Deny);
        // No other pages and no new windows: the engine works offline.
        core.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith($"https://{EngineHost}/", StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
            }
        };
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.Settings.IsStatusBarEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#endif
        var loaded = new TaskCompletionSource<bool>();
        void OnCompleted(object? s, CoreWebView2NavigationCompletedEventArgs args)
        {
            core.NavigationCompleted -= OnCompleted;
            loaded.TrySetResult(args.IsSuccess);
        }
        core.NavigationCompleted += OnCompleted;
        var client = new EngineClient(core);
        core.Navigate(EngineUrl);
        if (!await loaded.Task)
        {
            throw new EngineLoadException(EngineUrl);
        }
        return client;
    }

    // ── Editor ─────────────────────────────────────────────────────────────

    private void OnEditorTextChanged(object? sender, EventArgs e)
    {
        if (!_settingEditorText)
        {
            _vm?.OnCodeEdited(Editor.Text);
        }
    }

    private void SetEditorText(string code)
    {
        _settingEditorText = true;
        try
        {
            Editor.Document.Text = code;
            Editor.CaretOffset = 0;
            Editor.ScrollToHome();
        }
        finally
        {
            _settingEditorText = false;
        }
    }

    /// <summary>Selects the line and scrolls it to a third of the way down.</summary>
    private void GoToLine(int line)
    {
        var document = Editor.Document;
        if (line >= document.LineCount)
        {
            return;
        }
        var documentLine = document.GetLineByNumber(line + 1);
        Editor.Focus();
        Editor.Select(documentLine.Offset, documentLine.Length);
        var textView = Editor.TextArea.TextView;
        textView.EnsureVisualLines();
        double top = textView.GetVisualTopByDocumentLine(line + 1);
        Editor.ScrollToVerticalOffset(Math.Max(0, top - Editor.ViewportHeight / 3));
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(MainViewModel.HighlightedLine):
                _errorLine!.Line = _vm!.HighlightedLine;
                break;
            case nameof(MainViewModel.CurrentDiagramId):
                ShowCurrentDiagram();
                break;
        }
    }

    // ── Diagram dropdown ───────────────────────────────────────────────────

    private void ShowCurrentDiagram()
    {
        _choosingDiagram = true;
        try
        {
            DiagramSelect.SelectedValue = _vm?.CurrentDiagramId ?? "";
        }
        finally
        {
            _choosingDiagram = false;
        }
    }

    private void OnDiagramDropDownOpened(object? sender, EventArgs e)
    {
        _choosingDiagram = true;
        try
        {
            _vm?.RefreshDiagrams();
        }
        finally
        {
            _choosingDiagram = false;
        }
        ShowCurrentDiagram();
    }

    private async void OnDiagramSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_choosingDiagram || _vm is null || DiagramSelect.SelectedValue is not string id || id == _vm.CurrentDiagramId)
        {
            return;
        }
        await _vm.ChooseDiagramAsync(id);
        // The dropdown stays on the current diagram until the load actually happens.
        await Dispatcher.InvokeAsync(ShowCurrentDiagram, DispatcherPriority.Background);
    }

    // ── Excel ──────────────────────────────────────────────────────────────

    private void OnWindowActivated(object? sender, EventArgs e)
    {
        _selectionPoll.Stop();
        _vm?.OnActivated();
    }

    private async void OnSelectionPoll(object? sender, EventArgs e)
    {
        if (_polling || _vm is null)
        {
            return;
        }
        _polling = true;
        try
        {
            await _vm.PollSelectionAsync();
        }
        finally
        {
            _polling = false;
        }
    }

    // ── Layout ─────────────────────────────────────────────────────────────

    /// <summary>Editor and preview side by side, or stacked when the window is taller than wide.</summary>
    private void UpdateOrientation(bool force = false)
    {
        bool vertical = ActualHeight > ActualWidth;
        if (vertical == _vertical && !force)
        {
            return;
        }
        _vertical = vertical;
        double ratio = Math.Clamp(_settings.EditorRatio, 0.1, 0.9);
        var editor = new GridLength(ratio, GridUnitType.Star);
        var preview = new GridLength(1 - ratio, GridUnitType.Star);
        if (vertical)
        {
            EditorColumn.Width = new GridLength(1, GridUnitType.Star);
            PreviewColumn.Width = SplitterColumn.Width = new GridLength(0);
            EditorRow.Height = editor;
            SplitterRow.Height = GridLength.Auto;
            PreviewRow.Height = preview;
            PlaceParts(stacked: true);
            Splitter.Width = double.NaN;
            Splitter.Height = 6;
            Splitter.ResizeDirection = GridResizeDirection.Rows;
        }
        else
        {
            EditorRow.Height = new GridLength(1, GridUnitType.Star);
            SplitterRow.Height = PreviewRow.Height = new GridLength(0);
            EditorColumn.Width = editor;
            SplitterColumn.Width = GridLength.Auto;
            PreviewColumn.Width = preview;
            PlaceParts(stacked: false);
            Splitter.Height = double.NaN;
            Splitter.Width = 6;
            Splitter.ResizeDirection = GridResizeDirection.Columns;
        }
    }

    /// <summary>Puts the editor, splitter and preview in rows (stacked) or columns.</summary>
    private void PlaceParts(bool stacked)
    {
        foreach (var (element, index) in new (FrameworkElement, int)[] { (EditorBorder, 0), (Splitter, 1), (PreviewBorder, 2) })
        {
            Grid.SetRow(element, stacked ? index : 0);
            Grid.SetColumn(element, stacked ? 0 : index);
        }
    }

    private void OnSplitterDragCompleted(object sender, DragCompletedEventArgs e)
    {
        double editor = _vertical ? EditorRow.ActualHeight : EditorColumn.ActualWidth;
        double preview = _vertical ? PreviewRow.ActualHeight : PreviewColumn.ActualWidth;
        if (editor + preview > 0)
        {
            _settings.EditorRatio = editor / (editor + preview);
        }
    }

    private void RestoreWindowBounds(Settings settings)
    {
        if (settings.WindowWidth is > 0 and var width && settings.WindowHeight is > 0 and var height
            && settings.WindowLeft is double left && settings.WindowTop is double top)
        {
            // Only when the saved place is still on the screen.
            var screen = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
            if (screen.IntersectsWith(new Rect(left, top, width, height)))
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = left;
                Top = top;
                Width = width;
                Height = height;
            }
        }
        if (settings.WindowMaximized)
        {
            WindowState = WindowState.Maximized;
        }
        _vertical = false;
        ContentRendered += (_, _) => UpdateOrientation(force: true);
    }

    // ── Menu ───────────────────────────────────────────────────────────────

    private void OnExitClick(object sender, RoutedEventArgs e) => Close();

    private void OnAlwaysOnTopClick(object sender, RoutedEventArgs e) => Topmost = AlwaysOnTopItem.IsChecked;

    private void OnLanguageClick(object sender, RoutedEventArgs e)
    {
        var chosen = (MenuItem)sender;
        foreach (MenuItem item in LanguageMenu.Items)
        {
            item.IsChecked = item == chosen;
        }
        string language = (string)chosen.Tag;
        if (language != _settings.Language)
        {
            _settings.Language = language;
            _settingsStore.Save(_settings);
            MessageBox.Show(this, Strings.Get("LanguageRestart"), Strings.Get("AppTitle"), MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    // ── Closing ────────────────────────────────────────────────────────────

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        _closeCheck.Stop();
        _selectionPoll.Stop();
        var bounds = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        _settings.WindowLeft = bounds.Left;
        _settings.WindowTop = bounds.Top;
        _settings.WindowWidth = bounds.Width;
        _settings.WindowHeight = bounds.Height;
        _settings.WindowMaximized = WindowState == WindowState.Maximized;
        _settings.AlwaysOnTop = Topmost;
        if (_vm is not null)
        {
            _settings.Format = _vm.Format;
            _settings.Size = _vm.Size;
            _settings.Width = _vm.WidthText;
            _settings.AutoDetectSelection = _vm.AutoDetectSelection;
        }
        _settingsStore.Save(_settings);
        _excel.Dispose();
    }

    /// <summary>The engine page failed to load.</summary>
    private sealed class EngineLoadException(string url) : Exception($"Could not load {url}.");
}
