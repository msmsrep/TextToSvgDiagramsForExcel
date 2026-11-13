using TextToSvgDiagramsForExcel.Desktop.ViewModels;

namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>
/// Text to turn into a diagram and the kind of diagram (auto, flowchart, sequence or gantt).
/// UseAi is true when the local model made Code in the dialog; otherwise Code is null and
/// the rules make the diagram.
/// </summary>
public sealed record TextRequest(string Text, string Kind, bool UseAi = false, string? Code = null);

/// <summary>The local model offered in the "From text" dialog, whether it starts checked, and its kinds.</summary>
public sealed record TextAiChoice(ITextModel Model, bool Use, IReadOnlyList<Option> Kinds);

/// <summary>File dialogs and the clipboard, kept out of the view model for tests.</summary>
public interface IDialogService
{
    /// <summary>Asks where to save and writes the data; false when canceled.</summary>
    bool SaveFile(string defaultName, string filter, byte[] data);

    /// <summary>Asks for a text file and returns its content, or null when canceled.</summary>
    string? OpenText(string filter);

    /// <summary>Puts a PNG image and its SVG on the clipboard.</summary>
    void CopyImage(byte[] png, string svg);

    /// <summary>
    /// Asks for text to turn into a diagram, starting with the given values; null when
    /// canceled. With ai, the dialog can make the code with the local model while it
    /// stays open, showing that it is working and letting the user cancel.
    /// </summary>
    TextRequest? AskText(string text, string kind, IReadOnlyList<Option> kinds, TextAiChoice? ai = null);
}
