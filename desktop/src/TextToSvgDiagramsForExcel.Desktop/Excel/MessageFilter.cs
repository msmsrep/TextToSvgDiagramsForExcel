using System.Runtime.InteropServices;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>
/// Retries COM calls that Excel rejects while busy (for example, while a cell
/// is being edited) for a few seconds. During polling and event handling
/// (<see cref="Quiet"/>) calls give up at once so the UI thread is not blocked.
/// </summary>
internal sealed class MessageFilter : IOleMessageFilter
{
    private const int SERVERCALL_ISHANDLED = 0;
    private const int SERVERCALL_RETRYLATER = 2;
    private const int PENDINGMSG_WAITDEFPROCESS = 2;
    private const int RetryIntervalMs = 100;
    private const int RetryLimitMs = 5000;

    [ThreadStatic]
    private static int s_quietDepth;

    /// <summary>Whether rejected calls are given up at once.</summary>
    public static bool IsQuiet => s_quietDepth > 0;

    /// <summary>Gives up rejected calls at once until disposed.</summary>
    public static IDisposable Quiet(bool quiet = true)
    {
        if (!quiet)
        {
            return NoScope.Instance;
        }
        s_quietDepth++;
        return new QuietScope();
    }

    /// <summary>Registers the filter for the calling (STA) thread.</summary>
    public static void Register() => NativeMethods.CoRegisterMessageFilter(new MessageFilter(), out _);

    public static void Unregister() => NativeMethods.CoRegisterMessageFilter(null, out _);

    int IOleMessageFilter.HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) =>
        SERVERCALL_ISHANDLED;

    int IOleMessageFilter.RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType)
    {
        if (rejectType == SERVERCALL_RETRYLATER && !IsQuiet && tickCount < RetryLimitMs)
        {
            return RetryIntervalMs;
        }
        // Cancel: the call fails with RPC_E_CALL_REJECTED.
        return -1;
    }

    int IOleMessageFilter.MessagePending(IntPtr taskCallee, int tickCount, int pendingType) =>
        PENDINGMSG_WAITDEFPROCESS;

    private sealed class QuietScope : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (!_disposed)
            {
                _disposed = true;
                s_quietDepth--;
            }
        }
    }

    private sealed class NoScope : IDisposable
    {
        public static readonly NoScope Instance = new();

        public void Dispose()
        {
        }
    }
}

internal static class ComErrors
{
    public const int RPC_E_CALL_REJECTED = unchecked((int)0x80010001);
    public const int RPC_E_DISCONNECTED = unchecked((int)0x80010108);
    public const int RPC_S_SERVER_UNAVAILABLE = unchecked((int)0x800706BA);
    public const int RPC_E_SERVERFAULT = unchecked((int)0x80010105);
    public const int CO_E_OBJNOTCONNECTED = unchecked((int)0x800401FD);

    /// <summary>The COM error behind late-bound calls, which may wrap it.</summary>
    public static Exception Unwrap(Exception e) =>
        e is System.Reflection.TargetInvocationException { InnerException: { } inner } ? Unwrap(inner) : e;

    /// <summary>Excel has quit or its objects are gone.</summary>
    public static bool IsDisconnected(Exception e)
    {
        e = Unwrap(e);
        return e is InvalidComObjectException
            || e is COMException && e.HResult is RPC_E_DISCONNECTED or RPC_S_SERVER_UNAVAILABLE or CO_E_OBJNOTCONNECTED;
    }

    public static bool IsRejected(Exception e) => Unwrap(e).HResult == RPC_E_CALL_REJECTED;
}
