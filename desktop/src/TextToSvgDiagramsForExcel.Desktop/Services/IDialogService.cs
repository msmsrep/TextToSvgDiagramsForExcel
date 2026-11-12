using TextToSvgDiagramsForExcel.Desktop.ViewModels;

namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>Text to turn into a diagram and the kind of diagram (auto, flowchart or sequence).</summary>
public sealed record TextRequest(string Text, string Kind);

/// <summary>File dialogs and the clipboard, kept out of the view model for tests.</summary>
public interface IDialogService
{
    /// <summary>Asks where to save and writes the data; false when canceled.</summary>
    bool SaveFile(string defaultName, string filter, byte[] data);

    /// <summary>Asks for a text file and returns its content, or null when canceled.</summary>
    string? OpenText(string filter);

    /// <summary>Puts a PNG image and its SVG on the clipboard.</summary>
    void CopyImage(byte[] png, string svg);

    /// <summary>Asks for text to turn into a diagram, starting with the given values; null when canceled.</summary>
    TextRequest? AskText(string text, string kind, IReadOnlyList<Option> kinds);
}
