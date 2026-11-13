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
/// asks again (design §14): a general model is shown the error. A tuned model that chose
/// the diagram type itself is asked once more for that type; otherwise it gets the same
/// request with some chance in its choice of words.
/// </summary>
public sealed class MermaidGenerator(IChatModel model, Func<string, CancellationToken, Task<CodeCheck>> check)
{
    /// <summary>Answers longer than this are cut off (a diagram of about 40 nodes fits).</summary>
    public int MaxTokens { get; init; } = 768;

    /// <summary>How many times the model is asked again after an invalid answer.</summary>
    public int MaxRepairs { get; init; } = 2;

    /// <summary>True for a model tuned for this task: it gets the text without instructions or examples.</summary>
    public bool Tuned { get; init; }

    /// <summary>
    /// The temperature of a tuned model's retries. It has not learned to fix an answer and
    /// without chance would repeat it; its slips are small (one wrong token), so another
    /// draw of the same request usually works.
    /// </summary>
    public double RetryTemperature { get; init; } = 0.7;

    public async Task<GenerationResult> GenerateAsync(string text, string kind, CancellationToken cancellationToken = default)
    {
        var messages = Tuned ? MermaidPrompt.TunedMessages(text.Trim(), kind) : MermaidPrompt.Messages(text.Trim(), kind);
        var attempts = new List<Attempt>();
        var temperature = 0.0;
        var typeAdded = false;
        while (true)
        {
            var started = DateTime.UtcNow;
            var answer = await model.CompleteAsync(messages, MaxTokens, MermaidPrompt.IsComplete, cancellationToken, temperature);
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
            if (!Tuned)
            {
                messages.Add(new ChatMessage(ChatRole.Assistant, $"```mermaid\n{code}\n```"));
                messages.Add(MermaidPrompt.Repair(result.Message ?? ""));
            }
            else if (kind == "auto" && !typeAdded && MermaidPrompt.KindOf(code) is { } chosen)
            {
                // The model picked a type and then slipped. Asked for that type, as when the user
                // picks one, it is steadier, so this retry is without chance.
                messages = MermaidPrompt.TunedMessages(text.Trim(), chosen);
                typeAdded = true;
                temperature = 0;
            }
            else
            {
                temperature = RetryTemperature;
            }
        }
    }
}
