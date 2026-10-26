using System.IO;
using System.Text.Json;

namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>Saved between runs. Mermaid code is never saved here.</summary>
public sealed class Settings
{
    public double? WindowLeft { get; set; }
    public double? WindowTop { get; set; }
    public double? WindowWidth { get; set; }
    public double? WindowHeight { get; set; }
    public bool WindowMaximized { get; set; }
    /// <summary>The editor's share of the editor and preview area (0 to 1).</summary>
    public double EditorRatio { get; set; } = 0.4;
    public string Size { get; set; } = "1";
    public string Width { get; set; } = "";
    public string Format { get; set; } = "png";
    public bool AlwaysOnTop { get; set; }
    public bool AutoDetectSelection { get; set; } = true;
    /// <summary>"system", "en" or "ja".</summary>
    public string Language { get; set; } = "system";
}

public sealed class SettingsStore(string path)
{
    private static readonly JsonSerializerOptions s_options = new() { WriteIndented = true };

    public Settings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), s_options) ?? new Settings();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new Settings();
        }
    }

    public void Save(Settings settings)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(settings, s_options));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Settings are a convenience; failing to save them is not an error.
        }
    }
}
