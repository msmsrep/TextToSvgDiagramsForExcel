using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>
/// COM objects taken during one operation (sheets, shapes, ranges), released
/// together at its end (design §5.2). Never track the long-lived Application
/// or target window: an RCW is shared by every reference to the same object.
/// </summary>
internal sealed class ComScope : IDisposable
{
    private readonly List<object> _objects = [];

    /// <summary>Tracks the object for release and returns it.</summary>
    public dynamic T(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
        {
            _objects.Add(value);
        }
        return value!;
    }

    public void Dispose()
    {
        for (int i = _objects.Count - 1; i >= 0; i--)
        {
            try
            {
                Marshal.FinalReleaseComObject(_objects[i]);
            }
            catch (ArgumentException)
            {
                // Already released.
            }
        }
        _objects.Clear();
    }
}

internal static class ComTypeName
{
    [ComImport]
    [Guid("00020400-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDispatch
    {
        [PreserveSig]
        int GetTypeInfoCount(out uint count);

        [PreserveSig]
        int GetTypeInfo(uint index, int lcid, out ITypeInfo? typeInfo);
    }

    /// <summary>The object's type name, as VBA's TypeName ("Range", "Picture", "Rectangle"...).</summary>
    public static string Of(object? value)
    {
        if (value is not IDispatch dispatch || dispatch.GetTypeInfo(0, 0, out var info) < 0 || info is null)
        {
            return "";
        }
        try
        {
            info.GetDocumentation(-1, out string name, out _, out _, out _);
            return name ?? "";
        }
        finally
        {
            Marshal.ReleaseComObject(info);
        }
    }
}

/// <summary>Excel's Application events (DIID_AppEvents). Only the events used are declared.</summary>
[ComVisible(true)]
[Guid("00024413-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface IAppEvents
{
    [DispId(0x619)]
    void SheetActivate([MarshalAs(UnmanagedType.IDispatch)] object sheet);

    [DispId(0x620)]
    void WorkbookActivate([MarshalAs(UnmanagedType.IDispatch)] object workbook);
}

/// <summary>Receives Application events through a connection point.</summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
public sealed class AppEventsSink : IAppEvents
{
    private readonly Action<object> _onSheetActivate;
    private readonly Action<object> _onWorkbookActivate;
    private IConnectionPoint? _connectionPoint;
    private int _cookie;

    internal AppEventsSink(Action<object> onSheetActivate, Action<object> onWorkbookActivate)
    {
        _onSheetActivate = onSheetActivate;
        _onWorkbookActivate = onWorkbookActivate;
    }

    public void SheetActivate(object sheet) => _onSheetActivate(sheet);

    public void WorkbookActivate(object workbook) => _onWorkbookActivate(workbook);

    /// <summary>Subscribes to the application's events.</summary>
    internal void Advise(object application)
    {
        var container = (IConnectionPointContainer)application;
        var iid = typeof(IAppEvents).GUID;
        container.FindConnectionPoint(ref iid, out var connectionPoint);
        if (connectionPoint is null)
        {
            throw new COMException("AppEvents connection point not found.");
        }
        connectionPoint.Advise(this, out _cookie);
        _connectionPoint = connectionPoint;
    }

    internal void Unadvise()
    {
        if (_connectionPoint is null)
        {
            return;
        }
        try
        {
            _connectionPoint.Unadvise(_cookie);
        }
        catch (Exception e) when (e is COMException or InvalidComObjectException)
        {
            // Excel is gone.
        }
        finally
        {
            Marshal.ReleaseComObject(_connectionPoint);
            _connectionPoint = null;
        }
    }
}
