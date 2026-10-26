namespace TextToSvgDiagramsForExcel.Desktop.Engine;

/// <summary>
/// An error from the engine. Code is the kind of error (render, stale,
/// notRendered, changed, notFlowchart, table, badRequest, internal, timeout);
/// Line is the 0-based editor line of a render error, when known.
/// </summary>
public sealed class EngineException(string code, string message, int? line = null) : Exception(message)
{
    public string Code { get; } = code;
    public int? Line { get; } = line;
}
