using System.IO;
using Windows.ApplicationModel;
using Windows.Storage;

namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>
/// Where the app keeps settings, WebView2 data and temporary files. Packaged
/// (MSIX), writes to AppData are redirected to a per-package location Excel
/// may not see, so the real ApplicationData folders are used instead.
/// </summary>
public static class AppPaths
{
    private const string UnpackagedFolderName = "TextToSvgDiagramsForExcel";

    private static readonly Lazy<bool> s_isPackaged = new(() =>
    {
        try
        {
            return Package.Current is not null;
        }
        catch (InvalidOperationException)
        {
            // No package identity: running outside MSIX (development).
            return false;
        }
    });

    public static bool IsPackaged => s_isPackaged.Value;

    /// <summary>Settings and WebView2 data; removed with the app.</summary>
    public static string LocalFolder => IsPackaged
        ? ApplicationData.Current.LocalFolder.Path
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), UnpackagedFolderName);

    /// <summary>Temporary image files handed to Excel.</summary>
    public static string TempFolder => IsPackaged
        ? ApplicationData.Current.TemporaryFolder.Path
        : Path.Combine(Path.GetTempPath(), UnpackagedFolderName);

    public static string SettingsFile => Path.Combine(LocalFolder, "settings.json");

    public static string WebView2Folder => Path.Combine(LocalFolder, "WebView2");

    /// <summary>The engine page's folder, next to the executable.</summary>
    public static string WebFolder => Path.Combine(AppContext.BaseDirectory, "web");
}
