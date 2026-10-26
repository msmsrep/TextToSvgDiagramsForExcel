using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace TextToSvgDiagramsForExcel.Desktop.Engine;

/// <summary>
/// Sends JSON requests to engine.ts in WebView2 and matches the responses by
/// ID. Used on the UI thread, where WebView2 raises its events.
/// </summary>
public sealed class EngineClient : IEngineClient
{
    private static readonly TimeSpan s_timeout = TimeSpan.FromSeconds(60);

    private readonly CoreWebView2 _webView;
    private readonly Dictionary<int, TaskCompletionSource<JsonElement>> _pending = [];
    private int _nextId;

    public EngineClient(CoreWebView2 webView)
    {
        _webView = webView;
        _webView.WebMessageReceived += OnWebMessageReceived;
    }

    public Task InitAsync(string locale) => CallAsync("init", new { locale });

    public Task<RenderResult> RenderAsync(string code, int seq) =>
        CallAsync<RenderResult>("render", new { code, seq });

    public Task ClearAsync(int seq) => CallAsync("clear", new { seq });

    public Task<RasterResult> RasterAsync(int seq, string format, double scale) =>
        CallAsync<RasterResult>("raster", new { seq, format, scale });

    public async Task<string> SvgAsync(int seq, double scale) =>
        (await CallAsync<SvgResult>("svg", new { seq, scale })).Svg;

    public Task<OfficeSvgResult> OfficeSvgAsync(int seq) => CallAsync<OfficeSvgResult>("officeSvg", new { seq });

    public Task<ShapeModel> ShapeModelAsync(int seq, double scale) =>
        CallAsync<ShapeModel>("shapeModel", new { seq, scale });

    public async Task<string> FromTableAsync(TableData table, string kind) =>
        (await CallAsync<CodeResult>("fromTable", new { table, kind })).Code;

    public async Task<IReadOnlyList<Template>> TemplatesAsync() =>
        await CallAsync<Template[]>("templates", null);

    private async Task<T> CallAsync<T>(string method, object? parameters)
    {
        var result = await CallAsync(method, parameters);
        return result.Deserialize<T>(EngineJson.Options)
            ?? throw new EngineException("internal", $"Empty result from {method}.");
    }

    private async Task<JsonElement> CallAsync(string method, object? parameters)
    {
        int id = ++_nextId;
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        var request = new JsonObject
        {
            ["id"] = id,
            ["method"] = method,
            ["params"] = parameters is null ? null : JsonSerializer.SerializeToNode(parameters, EngineJson.Options),
        };
        _webView.PostWebMessageAsJson(request.ToJsonString());

        var finished = await Task.WhenAny(tcs.Task, Task.Delay(s_timeout));
        if (finished != tcs.Task)
        {
            _pending.Remove(id);
            throw new EngineException("timeout", $"The engine did not answer ({method}).");
        }
        return await tcs.Task;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the engine page is loaded; navigation elsewhere is blocked.
        using var doc = JsonDocument.Parse(e.WebMessageAsJson);
        var root = doc.RootElement;
        if (!root.TryGetProperty("id", out var idElement) || !idElement.TryGetInt32(out int id)
            || !_pending.Remove(id, out var tcs))
        {
            return;
        }
        if (root.TryGetProperty("error", out var error))
        {
            int? line = error.TryGetProperty("line", out var l) && l.ValueKind == JsonValueKind.Number ? l.GetInt32() : null;
            tcs.SetException(new EngineException(
                error.GetProperty("code").GetString() ?? "internal",
                error.GetProperty("message").GetString() ?? "",
                line));
        }
        else
        {
            tcs.SetResult(root.TryGetProperty("result", out var result) ? result.Clone() : default);
        }
    }
}
