namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>File dialogs and the clipboard, kept out of the view model for tests.</summary>
public interface IDialogService
{
    /// <summary>Asks where to save and writes the data; false when canceled.</summary>
    bool SaveFile(string defaultName, string filter, byte[] data);

    /// <summary>Asks for a text file and returns its content, or null when canceled.</summary>
    string? OpenText(string filter);

    /// <summary>Puts a PNG image and its SVG on the clipboard.</summary>
    void CopyImage(byte[] png, string svg);
}
