using TextToSvgDiagramsForExcel.Desktop.Excel;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

public class ExcelLocatorTests
{
    private sealed class FakeWindows : IWindowSource
    {
        public List<TopWindow> Windows { get; } = [];
        public Dictionary<(IntPtr, string), IntPtr> Children { get; } = [];

        public IEnumerable<TopWindow> TopLevelWindows() => Windows;

        public IntPtr FindChild(IntPtr parent, string className) =>
            Children.TryGetValue((parent, className), out var child) ? child : IntPtr.Zero;

        /// <summary>Adds an Excel main window; with a workbook, its XLDESK and EXCEL7 children too.</summary>
        public void AddExcel(int handle, bool visible = true, bool minimized = false, bool workbook = true)
        {
            Windows.Add(new TopWindow(handle, "XLMAIN", visible, minimized));
            Children[(handle, "XLDESK")] = handle + 1;
            if (workbook)
            {
                Children[(handle + 1, "EXCEL7")] = handle + 2;
            }
        }
    }

    private readonly FakeWindows _windows = new();

    private ExcelTarget? Locate() => new ExcelLocator(_windows).Locate();

    [Fact]
    public void FindsNothingWithoutExcel()
    {
        _windows.Windows.Add(new TopWindow(1, "Notepad", true, false));
        Assert.Null(Locate());
    }

    [Fact]
    public void PicksTheFrontmostExcelWindowBehindOtherWindows()
    {
        // This app's window is in front; the next Excel window is the target.
        _windows.Windows.Add(new TopWindow(1, "HwndWrapper", true, false));
        _windows.AddExcel(10);
        _windows.AddExcel(20);

        Assert.Equal(new ExcelTarget(10, 12), Locate());
    }

    [Fact]
    public void SkipsMinimizedAndHiddenWindows()
    {
        _windows.AddExcel(10, minimized: true);
        // Excel hides its window when closed while referenced from outside.
        _windows.AddExcel(20, visible: false);
        _windows.AddExcel(30);

        Assert.Equal(new ExcelTarget(30, 32), Locate());
    }

    [Fact]
    public void FallsBackToTheFrontmostMinimizedWindow()
    {
        _windows.AddExcel(10, visible: false);
        _windows.AddExcel(20, minimized: true);
        _windows.AddExcel(30, minimized: true);

        Assert.Equal(new ExcelTarget(20, 22), Locate());
    }

    [Fact]
    public void ReportsExcelWithoutAWorkbook()
    {
        _windows.AddExcel(10, workbook: false);

        var target = Locate();

        Assert.NotNull(target);
        Assert.False(target.HasWorkbook);
    }
}
