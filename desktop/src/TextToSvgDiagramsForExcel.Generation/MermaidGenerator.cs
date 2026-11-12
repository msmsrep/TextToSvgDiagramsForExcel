namespace TextToSvgDiagramsForExcel.Generation;

/// <summary>mermaid.parse's verdict on code: the diagram type, or the error.</summary>
public sealed record CodeCheck(bool Valid, string? Type = null, string? Message = null);

/// <summary>One answer of the model and how it was judged.</summary>
public sealed record Attempt(string Answer, string Code, CodeCheck Check, TimeSpan Elapsed);

/// <summary>The generated code (the last attempt's), whether it is valid, and every attempt.</summary>
public sealed record GenerationResult(string Code, bool Valid, IReadOnlyList<Attempt> Attempts)
{
    public TimeSpan Elapsed => Attempts.Aggregate(TimeSpan.Zero, (sum, a) => sum + a.Elapsed);
}

/// <summary>
/// Turns text into Mermaid code with a model, checks the code, and on an error
/// shows the error to the model and asks again (design §14).
/// </summary>
public sealed class MermaidGenerator(IChatModel model, Func<string, CancellationToken, Task<CodeCheck>> check)
{
    /// <summary>Answers longer than this are cut off (a diagram of about 40 nodes fits).</summary>
    public int MaxTokens { get; init; } = 768;

    /// <summary>How many times an invalid answer is sent back to be fixed.</summary>
    public int MaxRepairs { get; init; } = 2;

    public async Task<GenerationResult> GenerateAsync(string text, string kind, CancellationToken cancellationToken = default)
    {
        var messages = MermaidPrompt.Messages(text.Trim(), kind);
        var attempts = new List<Attempt>();
        while (true)
        {
            var started = DateTime.UtcNow;
            var answer = await model.CompleteAsync(messages, MaxTokens, MermaidPrompt.IsComplete, cancellationToken);
            var code = MermaidPrompt.ExtractCode(answer);
            var result = string.IsNullOrWhiteSpace(code)
                ? new CodeCheck(false, Message: "The answer has no Mermaid code.")
                : await check(code, cancellationToken);
            if (result.Valid && !MermaidPrompt.MatchesKind(kind, result.Type))
            {
                result = new CodeCheck(false, result.Type, $"The diagram is a {result.Type}, not a {kind}.");
            }
            attempts.Add(new Attempt(answer, code, result, DateTime.UtcNow - started));

            if (result.Valid || attempts.Count > MaxRepairs)
            {
                return new GenerationResult(code, result.Valid, attempts);
            }
            messages.Add(new ChatMessage(ChatRole.Assistant, $"```mermaid\n{code}\n```"));
            messages.Add(MermaidPrompt.Repair(result.Message ?? ""));
        }
    }
}
