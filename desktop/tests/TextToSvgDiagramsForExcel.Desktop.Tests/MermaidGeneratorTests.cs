using TextToSvgDiagramsForExcel.Generation;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

public class MermaidPromptTests
{
    [Theory]
    [InlineData("Here:\n```mermaid\nflowchart TD\n  A-->B\n```\nDone.", "flowchart TD\n  A-->B")]
    [InlineData("```\nsequenceDiagram\n  A->>B: hi\n```", "sequenceDiagram\n  A->>B: hi")]
    [InlineData("```mermaid\nflowchart TD\n  A-->B", "flowchart TD\n  A-->B")]
    [InlineData("Sure.\nflowchart TD\n  A-->B", "flowchart TD\n  A-->B")]
    [InlineData("```mermaid", "")]
    public void ExtractsTheCode(string answer, string code) =>
        Assert.Equal(code, MermaidPrompt.ExtractCode(answer));

    [Theory]
    [InlineData("```mermaid\nA", false)]
    [InlineData("```mermaid\nA\n```", true)]
    [InlineData("no code", false)]
    public void TellsWhenTheBlockIsClosed(string answer, bool complete) =>
        Assert.Equal(complete, MermaidPrompt.IsComplete(answer));

    [Fact]
    public void PutsTheSystemPromptAndExamplesBeforeTheRequest()
    {
        var messages = MermaidPrompt.Messages("手順", "sequence");

        Assert.Equal(ChatRole.System, messages[0].Role);
        Assert.Equal(MermaidPrompt.Examples, messages.Skip(1).Take(MermaidPrompt.Examples.Count));
        Assert.Equal(new ChatMessage(ChatRole.User, "手順\n\n(Use a sequenceDiagram.)"), messages[^1]);
        Assert.Equal("手順", MermaidPrompt.Messages("手順", "auto")[^1].Text);
    }

    [Fact]
    public void GivesATunedModelTheTextAlone()
    {
        Assert.Equal([new ChatMessage(ChatRole.User, "手順\n\n(Use a gantt chart.)")], MermaidPrompt.TunedMessages("手順", "gantt"));
        Assert.Equal([new ChatMessage(ChatRole.User, "手順")], MermaidPrompt.TunedMessages("手順", "auto"));
    }

    [Fact]
    public void ExamplesAreValidCodeBlocks()
    {
        foreach (var answer in MermaidPrompt.Examples.Where(m => m.Role == ChatRole.Assistant))
        {
            Assert.True(MermaidPrompt.IsComplete(answer.Text));
            Assert.Matches("^(flowchart|sequenceDiagram)", MermaidPrompt.ExtractCode(answer.Text));
        }
    }

    [Fact]
    public void FormatsChatMlAndPhiConversations()
    {
        ChatMessage[] messages = [new(ChatRole.System, "s"), new(ChatRole.User, "u")];

        Assert.Equal(
            "<|im_start|>system\ns<|im_end|>\n<|im_start|>user\nu<|im_end|>\n<|im_start|>assistant\n",
            ChatFormat.For("qwen2").Render(messages));
        Assert.Equal("<|system|>s<|end|><|user|>u<|end|><|assistant|>", ChatFormat.For("phi3").Render(messages));
        Assert.Equal("code", ChatFormat.For("phi3").Clean(" code<|end|>junk"));
        Assert.EndsWith("<|im_start|>assistant\n<think>\n\n</think>\n\n", ChatFormat.For("qwen3_5_text").Render(messages));
        Assert.Equal("code", ChatFormat.For("qwen3").Clean("<think>hmm</think>\ncode<|im_end|>"));
    }
}

public class MermaidGeneratorTests
{
    /// <summary>A model that gives the queued answers in order and records what it was asked.</summary>
    private sealed class ScriptedModel(params string[] answers) : IChatModel
    {
        private readonly Queue<string> _answers = new(answers);
        public List<IReadOnlyList<ChatMessage>> Asked { get; } = [];

        public Task<string> CompleteAsync(IReadOnlyList<ChatMessage> messages, int maxTokens, Func<string, bool>? stopWhen, CancellationToken cancellationToken)
        {
            Asked.Add(messages.ToList());
            return Task.FromResult(_answers.Dequeue());
        }
    }

    private static Func<string, CancellationToken, Task<CodeCheck>> Checker(Func<string, CodeCheck> check) =>
        (code, _) => Task.FromResult(check(code));

    private static readonly Func<string, CancellationToken, Task<CodeCheck>> s_validIfNoBug =
        Checker(code => code.Contains("BUG") ? new CodeCheck(false, Message: "Parse error on line 2") : new CodeCheck(true, "flowchart-v2"));

    [Fact]
    public async Task ReturnsTheFirstValidAnswer()
    {
        var model = new ScriptedModel("```mermaid\nflowchart TD\n  A-->B\n```");

        var result = await new MermaidGenerator(model, s_validIfNoBug).GenerateAsync(" text ", "auto");

        Assert.True(result.Valid);
        Assert.Equal("flowchart TD\n  A-->B", result.Code);
        Assert.Single(result.Attempts);
        Assert.Equal("text", model.Asked[0][^1].Text);
    }

    [Fact]
    public async Task SendsTheErrorBackAndUsesTheFixedCode()
    {
        var model = new ScriptedModel("```mermaid\nflowchart TD\n  BUG\n```", "```mermaid\nflowchart TD\n  A-->B\n```");

        var result = await new MermaidGenerator(model, s_validIfNoBug).GenerateAsync("text", "auto");

        Assert.True(result.Valid);
        Assert.Equal(2, result.Attempts.Count);
        var retry = model.Asked[1];
        Assert.Equal(new ChatMessage(ChatRole.Assistant, "```mermaid\nflowchart TD\n  BUG\n```"), retry[^2]);
        Assert.Contains("Parse error on line 2", retry[^1].Text);
    }

    [Fact]
    public async Task GivesUpAfterTheRepairLimitWithTheLastCode()
    {
        var model = new ScriptedModel("```\nflowchart TD\nBUG 1\n```", "```\nflowchart TD\nBUG 2\n```");

        var result = await new MermaidGenerator(model, s_validIfNoBug) { MaxRepairs = 1 }.GenerateAsync("text", "auto");

        Assert.False(result.Valid);
        Assert.Equal("flowchart TD\nBUG 2", result.Code);
        Assert.Equal(2, result.Attempts.Count);
    }

    [Fact]
    public async Task TreatsAnswersWithoutCodeAndTheWrongTypeAsErrors()
    {
        var model = new ScriptedModel("```mermaid", "```\nflowchart TD\n A-->B\n```", "```\nsequenceDiagram\n A->>B: x\n```");
        var check = Checker(code => new CodeCheck(true, code.StartsWith("sequence") ? "sequence" : "flowchart-v2"));

        var result = await new MermaidGenerator(model, check).GenerateAsync("text", "sequence");

        Assert.True(result.Valid);
        Assert.Equal("The answer has no Mermaid code.", result.Attempts[0].Check.Message);
        Assert.Equal("The diagram is a flowchart-v2, not a sequence.", result.Attempts[1].Check.Message);
    }
}
