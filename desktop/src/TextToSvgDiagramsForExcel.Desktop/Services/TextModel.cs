using System.IO;
using Microsoft.ML.OnnxRuntimeGenAI;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Generation;

namespace TextToSvgDiagramsForExcel.Desktop.Services;

/// <summary>The local model could not make code; the message is for the user.</summary>
public sealed class TextModelException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Turns text into Mermaid code with a local model (design §14). Nothing leaves this PC.</summary>
public interface ITextModel
{
    /// <summary>The diagram kinds it can make: auto, flowchart, sequence and gantt.</summary>
    IReadOnlyList<string> Kinds { get; }

    /// <summary>The code for the text; throws TextModelException when there is none.</summary>
    Task<string> GenerateAsync(string text, string kind, CancellationToken cancellationToken);
}

/// <summary>
/// The model in models\text-to-mermaid next to the executable (ONNX Runtime GenAI,
/// in this process). It is loaded on first use and kept until the app closes.
/// </summary>
public sealed class LocalTextModel(string folder, Func<string, Task<ParseResult>> parse) : ITextModel, IDisposable
{
    public static string DefaultFolder => Path.Combine(AppContext.BaseDirectory, "models", "text-to-mermaid");

    private Task<OnnxChatModel>? _loading;

    /// <summary>The model in the folder, or null when there is none.</summary>
    public static LocalTextModel? Find(string folder, Func<string, Task<ParseResult>> parse) =>
        File.Exists(Path.Combine(folder, "genai_config.json")) ? new LocalTextModel(folder, parse) : null;

    public IReadOnlyList<string> Kinds { get; } = ["auto", "flowchart", "sequence", "gantt"];

    public async Task<string> GenerateAsync(string text, string kind, CancellationToken cancellationToken)
    {
        var tuned = MermaidPrompt.IsTunedModel(folder);
        GenerationResult result;
        try
        {
            var model = await LoadAsync().WaitAsync(cancellationToken);
            var generator = new MermaidGenerator(model, CheckAsync)
            {
                Tuned = tuned,
                // A tuned model has not learned to fix its answers and gives the same one
                // again, so asking costs time for nothing; the editor shows the error instead.
                MaxRepairs = tuned ? 0 : 2,
            };
            result = await generator.GenerateAsync(text, kind, cancellationToken);
        }
        catch (Exception e) when (e is OnnxRuntimeGenAIException or IOException or UnauthorizedAccessException)
        {
            throw new TextModelException(e.Message, e);
        }
        if (string.IsNullOrWhiteSpace(result.Code))
        {
            throw new TextModelException(Strings.Get("AiNoCode"));
        }
        return result.Code;
    }

    private Task<OnnxChatModel> LoadAsync()
    {
        if (_loading is null || _loading.IsFaulted)
        {
            _loading = Task.Run(() => new OnnxChatModel(folder));
        }
        return _loading;
    }

    private async Task<CodeCheck> CheckAsync(string code, CancellationToken cancellationToken)
    {
        var result = await parse(code);
        return new CodeCheck(result.Valid, result.Type, result.Message);
    }

    public void Dispose()
    {
        if (_loading is { IsCompletedSuccessfully: true } loaded)
        {
            loaded.Result.Dispose();
        }
    }
}
