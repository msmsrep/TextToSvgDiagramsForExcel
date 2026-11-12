using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;
using TextToSvgDiagramsForExcel.Desktop.ViewModels;

namespace TextToSvgDiagramsForExcel.Desktop.Views;

/// <summary>
/// Asks for text to turn into a diagram (New > From text). With the local model
/// checked, Create makes the code here, and the dialog stays open while the model
/// works; Cancel or closing stops it.
/// </summary>
public partial class FromTextWindow : Window
{
    private readonly IReadOnlyList<Option> _kinds;
    private readonly TextAiChoice? _ai;
    private CancellationTokenSource? _generating;

    public FromTextWindow(string text, string kind, IReadOnlyList<Option> kinds, TextAiChoice? ai = null)
    {
        InitializeComponent();
        _kinds = kinds;
        _ai = ai;
        Input.Text = text;
        if (ai is not null)
        {
            UseAiCheck.Visibility = Visibility.Visible;
            UseAiCheck.IsChecked = ai.Use;
        }
        ShowKinds(kind);
        UpdateCreateButton();
        // Ctrl+Enter creates, as Enter adds a line.
        InputBindings.Add(new KeyBinding(new RelayCommand(Create), Key.Enter, ModifierKeys.Control));
        Closing += OnClosing;
        Loaded += (_, _) =>
        {
            Input.Focus();
            Input.SelectAll();
        };
    }

    public string Text => Input.Text;

    public string Kind => KindSelect.SelectedValue as string ?? "auto";

    public bool UseAi => _ai is not null && UseAiCheck.IsChecked == true;

    /// <summary>The local model's code, when it made the diagram.</summary>
    public string? Code { get; private set; }

    private void ShowKinds(string kind)
    {
        KindSelect.ItemsSource = UseAi ? _ai!.Kinds : _kinds;
        KindSelect.SelectedValue = kind;
        if (KindSelect.SelectedIndex < 0)
        {
            KindSelect.SelectedIndex = 0;
        }
        Hint.Text = Strings.Get(UseAi ? "FromText_HintAi" : "FromText_Hint");
    }

    private void OnUseAiChanged(object sender, RoutedEventArgs e)
    {
        if (IsInitialized)
        {
            ShowKinds(Kind);
            StatusPanel.Visibility = Visibility.Collapsed;
        }
    }

    private void OnTextChanged(object sender, TextChangedEventArgs e) => UpdateCreateButton();

    private void UpdateCreateButton() =>
        CreateButton.IsEnabled = _generating is null && !string.IsNullOrWhiteSpace(Input.Text);

    private void OnCreateClick(object sender, RoutedEventArgs e) => Create();

    private async void Create()
    {
        if (!CreateButton.IsEnabled)
        {
            return;
        }
        if (!UseAi)
        {
            DialogResult = true;
            return;
        }

        using var generating = new CancellationTokenSource();
        _generating = generating;
        SetWorking(true);
        ShowStatus(Strings.Get("FromText_Generating"), working: true);
        try
        {
            Code = await _ai!.Model.GenerateAsync(Input.Text, Kind, generating.Token);
        }
        catch (OperationCanceledException)
        {
            // Canceled or closed: the dialog is gone or the user stopped it.
            return;
        }
        catch (TextModelException ex)
        {
            ShowStatus(Strings.Format("AiError", ex.Message), working: false);
            return;
        }
        finally
        {
            _generating = null;
            if (IsLoaded)
            {
                SetWorking(false);
            }
        }
        // Closed just as the model finished (while its code was being checked).
        if (!generating.IsCancellationRequested)
        {
            DialogResult = true;
        }
    }

    private void SetWorking(bool working)
    {
        Input.IsReadOnly = working;
        KindSelect.IsEnabled = !working;
        UseAiCheck.IsEnabled = !working;
        UpdateCreateButton();
    }

    private void ShowStatus(string text, bool working)
    {
        StatusPanel.Visibility = Visibility.Visible;
        Progress.Visibility = working ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Text = text;
        StatusText.Foreground = working ? SystemColors.ControlTextBrush : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0xC4, 0x2B, 0x1C));
    }

    // Cancel (or Esc, or the close box) while the model works stops it and closes.
    private void OnClosing(object? sender, CancelEventArgs e) => _generating?.Cancel();
}
