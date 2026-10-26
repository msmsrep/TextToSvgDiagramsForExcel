namespace TextToSvgDiagramsForExcel.Desktop.Engine;

/// <summary>Requests to the rendering engine in WebView2 (src/engine/engine.ts).</summary>
public interface IEngineClient
{
    /// <summary>Sets the language of the engine's messages ("en" or "ja"); called first.</summary>
    Task InitAsync(string locale);

    /// <summary>Renders the editor's text and shows it in the preview.</summary>
    Task<RenderResult> RenderAsync(string code, int seq);

    /// <summary>Shows the hint instead of a diagram; renders before seq are discarded.</summary>
    Task ClearAsync(int seq);

    Task<RasterResult> RasterAsync(int seq, string format, double scale);

    Task<string> SvgAsync(int seq, double scale);

    Task<OfficeSvgResult> OfficeSvgAsync(int seq);

    Task<ShapeModel> ShapeModelAsync(int seq, double scale);

    Task<string> FromTableAsync(TableData table, string kind);

    Task<IReadOnlyList<Template>> TemplatesAsync();
}
