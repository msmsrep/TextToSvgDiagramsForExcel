using System.Text;
using System.Text.Json;
using Microsoft.ML.OnnxRuntimeGenAI;

namespace TextToSvgDiagramsForExcel.Generation;

/// <summary>
/// A model in ONNX Runtime GenAI's format (a folder with genai_config.json),
/// run in this process: nothing is sent anywhere and no local server is started.
/// </summary>
public sealed class OnnxChatModel : IChatModel, IDisposable
{
    private readonly Model _model;
    private readonly Tokenizer _tokenizer;
    private readonly ChatFormat _format;
    // ONNX Runtime GenAI runs one generation at a time per model here.
    private readonly SemaphoreSlim _gate = new(1, 1);

    public OnnxChatModel(string folder)
    {
        _format = ChatFormat.For(ReadModelType(folder));
        _model = new Model(folder);
        _tokenizer = new Tokenizer(_model);
    }

    /// <summary>genai_config.json's model.type, such as "qwen2" or "phi3".</summary>
    public static string ReadModelType(string folder)
    {
        using var config = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(folder, "genai_config.json")));
        return config.RootElement.GetProperty("model").GetProperty("type").GetString() ?? "";
    }

    public async Task<string> CompleteAsync(
        IReadOnlyList<ChatMessage> messages,
        int maxTokens,
        Func<string, bool>? stopWhen = null,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await Task.Run(() => Generate(_format.Render(messages), maxTokens, stopWhen, cancellationToken), cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private string Generate(string prompt, int maxTokens, Func<string, bool>? stopWhen, CancellationToken cancellationToken)
    {
        using var sequences = _tokenizer.Encode(prompt);
        using var options = new GeneratorParams(_model);
        options.SetSearchOption("max_length", sequences[0].Length + maxTokens);
        // Greedy decoding: the same text gives the same code.
        options.SetSearchOption("do_sample", false);
        using var generator = new Generator(_model, options);
        generator.AppendTokenSequences(sequences);
        using var stream = _tokenizer.CreateStream();

        var answer = new StringBuilder();
        while (!generator.IsDone())
        {
            cancellationToken.ThrowIfCancellationRequested();
            generator.GenerateNextToken();
            var sequence = generator.GetSequence(0);
            answer.Append(stream.Decode(sequence[^1]));
            if (stopWhen?.Invoke(answer.ToString()) == true)
            {
                break;
            }
        }
        return _format.Clean(answer.ToString());
    }

    public void Dispose()
    {
        _tokenizer.Dispose();
        _model.Dispose();
        _gate.Dispose();
    }
}

/// <summary>How a model family writes a conversation as text.</summary>
internal sealed record ChatFormat(Func<IReadOnlyList<ChatMessage>, string> Render, string[] EndMarkers)
{
    /// <summary>
    /// Phi-3 / Phi-4 (model type "phi3"); Qwen3 and later ("qwen3", "qwen3_5_text") with
    /// thinking turned off; ChatML (Qwen2 and most others) otherwise.
    /// </summary>
    public static ChatFormat For(string modelType) =>
        modelType.StartsWith("phi", StringComparison.OrdinalIgnoreCase) ? Phi
        : modelType.StartsWith("qwen3", StringComparison.OrdinalIgnoreCase) ? ChatMlNoThinking
        : ChatMl;

    public static readonly ChatFormat ChatMl = new(messages => RenderChatMl(messages, ""), ["<|im_end|>", "<|endoftext|>"]);

    /// <summary>An empty thinking block, as Qwen3's template writes for enable_thinking=false.</summary>
    public static readonly ChatFormat ChatMlNoThinking = new(
        messages => RenderChatMl(messages, "<think>\n\n</think>\n\n"),
        ["<|im_end|>", "<|endoftext|>"]);

    private static string RenderChatMl(IReadOnlyList<ChatMessage> messages, string answerStart)
    {
        var text = new StringBuilder();
        foreach (var m in messages)
        {
            text.Append($"<|im_start|>{Name(m.Role)}\n{m.Text}<|im_end|>\n");
        }
        return text.Append("<|im_start|>assistant\n").Append(answerStart).ToString();
    }

    public static readonly ChatFormat Phi = new(
        messages =>
        {
            var text = new StringBuilder();
            foreach (var m in messages)
            {
                text.Append($"<|{Name(m.Role)}|>{m.Text}<|end|>");
            }
            return text.Append("<|assistant|>").ToString();
        },
        ["<|end|>", "<|endoftext|>"]);

    /// <summary>The answer without an end marker the tokenizer left in.</summary>
    public string Clean(string answer)
    {
        foreach (var marker in EndMarkers)
        {
            var i = answer.IndexOf(marker, StringComparison.Ordinal);
            if (i >= 0)
            {
                answer = answer[..i];
            }
        }
        // A model that thinks anyway: keep only what follows the thinking.
        var thought = answer.LastIndexOf("</think>", StringComparison.Ordinal);
        if (thought >= 0)
        {
            answer = answer[(thought + "</think>".Length)..];
        }
        return answer.Trim();
    }

    private static string Name(ChatRole role) => role switch
    {
        ChatRole.System => "system",
        ChatRole.User => "user",
        _ => "assistant",
    };
}
