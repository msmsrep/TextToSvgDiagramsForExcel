using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using TextToSvgDiagramsForExcel.Desktop.ViewModels;

namespace TextToSvgDiagramsForExcel.Desktop.Views;

/// <summary>Asks for text to turn into a diagram (New > From text).</summary>
public partial class FromTextWindow : Window
{
    public FromTextWindow(string text, string kind, IReadOnlyList<Option> kinds)
    {
        InitializeComponent();
        Input.Text = text;
        KindSelect.ItemsSource = kinds;
        KindSelect.SelectedValue = kind;
        if (KindSelect.SelectedIndex < 0)
        {
            KindSelect.SelectedIndex = 0;
        }
        UpdateCreateButton();
        // Ctrl+Enter creates, as Enter adds a line.
        InputBindings.Add(new KeyBinding(new RelayCommand(Create), Key.Enter, ModifierKeys.Control));
        Loaded += (_, _) =>
        {
            Input.Focus();
            Input.SelectAll();
        };
    }

    public string Text => Input.Text;

    public string Kind => KindSelect.SelectedValue as string ?? "auto";

    private void OnTextChanged(object sender, TextChangedEventArgs e) => UpdateCreateButton();

    private void UpdateCreateButton() => CreateButton.IsEnabled = !string.IsNullOrWhiteSpace(Input.Text);

    private void OnCreateClick(object sender, RoutedEventArgs e) => Create();

    private void Create()
    {
        if (CreateButton.IsEnabled)
        {
            DialogResult = true;
        }
    }
}
