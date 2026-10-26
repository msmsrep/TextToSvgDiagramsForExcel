namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>A top-level window as seen by the locator.</summary>
public sealed record TopWindow(IntPtr Handle, string ClassName, bool Visible, bool Minimized);

/// <summary>Window enumeration, replaceable in tests.</summary>
public interface IWindowSource
{
    /// <summary>Top-level windows in Z order, frontmost first.</summary>
    IEnumerable<TopWindow> TopLevelWindows();

    /// <summary>The first child window of the class, or zero.</summary>
    IntPtr FindChild(IntPtr parent, string className);
}

public sealed class NativeWindowSource : IWindowSource
{
    public IEnumerable<TopWindow> TopLevelWindows()
    {
        var windows = new List<TopWindow>();
        // EnumWindows lists top-level windows in Z order.
        NativeMethods.EnumWindows((hwnd, _) =>
        {
            windows.Add(new TopWindow(
                hwnd,
                NativeMethods.ClassName(hwnd),
                NativeMethods.IsWindowVisible(hwnd),
                NativeMethods.IsIconic(hwnd)));
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    public IntPtr FindChild(IntPtr parent, string className) =>
        NativeMethods.FindWindowEx(parent, IntPtr.Zero, className, null);
}

/// <summary>The Excel window to work with: its main window and, when a workbook is open, its workbook window.</summary>
public sealed record ExcelTarget(IntPtr MainWindow, IntPtr WorkbookWindow)
{
    public bool HasWorkbook => WorkbookWindow != IntPtr.Zero;
}

/// <summary>
/// Picks the Excel the user used last (design §5.1): the frontmost visible,
/// non-minimized Excel main window (XLMAIN), or else the frontmost minimized
/// one. GetActiveObject is not used since it returns the first registered
/// instance, not the active one.
/// </summary>
public sealed class ExcelLocator(IWindowSource windows)
{
    public const string MainWindowClass = "XLMAIN";
    public const string DeskClass = "XLDESK";
    public const string WorkbookWindowClass = "EXCEL7";

    /// <summary>The target, or null when no Excel window is shown.</summary>
    public ExcelTarget? Locate()
    {
        var excelWindows = windows.TopLevelWindows()
            .Where(w => w.ClassName == MainWindowClass && w.Visible)
            .ToList();
        var main = excelWindows.FirstOrDefault(w => !w.Minimized) ?? excelWindows.FirstOrDefault();
        if (main is null)
        {
            return null;
        }
        var desk = windows.FindChild(main.Handle, DeskClass);
        var workbook = desk == IntPtr.Zero ? IntPtr.Zero : windows.FindChild(desk, WorkbookWindowClass);
        return new ExcelTarget(main.Handle, workbook);
    }
}
