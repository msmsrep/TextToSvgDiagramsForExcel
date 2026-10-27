using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
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

        _instanceMutex = new Mutex(true, InstanceMutexName(AppPaths.LocalFolder), out bool created);
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

        DispatcherUnhandledException += OnDispatcherUnhandledException;
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

    /// <summary>
    /// The single-instance mutex's name for the settings folder (one per user
    /// and package). string.GetHashCode differs between processes, so the
    /// name uses a stable hash.
    /// </summary>
    internal static string InstanceMutexName(string localFolder)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(localFolder.ToUpperInvariant()));
        return $@"Local\TextToSvgDiagramsForExcel-{Convert.ToHexString(hash, 0, 8)}";
    }

    /// <summary>Shows errors no operation handled instead of closing the app.</summary>
    private void OnDispatcherUnhandledException(object sender, System.Windows.Threading.DispatcherUnhandledExceptionEventArgs e)
    {
        e.Handled = true;
        MessageBox.Show(
            MainWindow,
            Strings.Format("UnexpectedError", e.Exception.Message),
            Strings.Get("AppTitle"),
            MessageBoxButton.OK,
            MessageBoxImage.Error);
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
                // Restoring a window that is not minimized would undo its maximizing.
                if (IsIconic(process.MainWindowHandle))
                {
                    ShowWindow(process.MainWindowHandle, SW_RESTORE);
                }
                SetForegroundWindow(process.MainWindowHandle);
                return;
            }
        }
    }

    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);
}
