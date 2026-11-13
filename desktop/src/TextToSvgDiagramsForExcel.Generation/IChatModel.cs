namespace TextToSvgDiagramsForExcel.Generation;

public enum ChatRole
{
    System,
    User,
    Assistant,
}

public sealed record ChatMessage(ChatRole Role, string Text);

/// <summary>A language model that answers a conversation.</summary>
public interface IChatModel
{
    /// <summary>
    /// The assistant's answer to the messages, at most maxTokens long. Generation
    /// stops early once stopWhen returns true for the text so far. With temperature 0
    /// the same messages give the same answer; above 0 the answer varies from call to call.
    /// </summary>
    Task<string> CompleteAsync(
        IReadOnlyList<ChatMessage> messages,
        int maxTokens,
        Func<string, bool>? stopWhen = null,
        CancellationToken cancellationToken = default,
        double temperature = 0);
}
