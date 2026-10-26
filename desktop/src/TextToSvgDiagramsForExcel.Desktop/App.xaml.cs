using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop;

public partial class App : Application
{
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    // One instance per user and package, so Excel connections, polling and
    // settings do not overlap (design §6).
    private Mutex? _instanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var store = new SettingsStore(AppPaths.SettingsFile);
        var settings = store.Load();
        Strings.Culture = Strings.CultureFor(settings.Language);
        Thread.CurrentThread.CurrentUICulture = Strings.Culture;

        _instanceMutex = new Mutex(true, $@"Local\TextToSvgDiagramsForExcel-{AppPaths.LocalFolder.GetHashCode():X8}", out bool created);
        if (!created)
        {
            ActivateExistingInstance();
            Shutdown();
            return;
        }

        if (!IsWebView2Installed())
        {
            var answer = MessageBox.Show(
                Strings.Get("WebView2Missing"),
                Strings.Get("WebView2MissingTitle"),
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (answer == MessageBoxResult.Yes)
            {
                Process.Start(new ProcessStartInfo(WebView2DownloadUrl) { UseShellExecute = true });
            }
            Shutdown();
            return;
        }

        MessageFilter.Register();
        var window = new MainWindow(settings, store);
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        MessageFilter.Unregister();
        _instanceMutex?.Dispose();
        base.OnExit(e);
    }

    /// <summary>Whether the WebView2 Runtime is installed; it cannot be installed from an MSIX package.</summary>
    private static bool IsWebView2Installed()
    {
        try
        {
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch (WebView2RuntimeNotFoundException)
        {
            return false;
        }
    }

    private static void ActivateExistingInstance()
    {
        var current = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName(current.ProcessName))
        {
            if (process.Id != current.Id && process.MainWindowHandle != IntPtr.Zero)
            {
                ShowWindow(process.MainWindowHandle, SW_RESTORE_IF_MINIMIZED);
                SetForegroundWindow(process.MainWindowHandle);
                return;
            }
        }
    }

    private const int SW_RESTORE_IF_MINIMIZED = 9;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
}
