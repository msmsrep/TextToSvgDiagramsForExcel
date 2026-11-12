using System.Text.RegularExpressions;

namespace TextToSvgDiagramsForExcel.Generation;

/// <summary>The instructions and examples given to the model, and reading the code out of its answer.</summary>
public static partial class MermaidPrompt
{
    // English instructions work better than Japanese ones for small models;
    // labels follow the description's language.
    public const string System = """
        You turn a description into Mermaid diagram code.

        Rules:
        - Answer with one ```mermaid code block and nothing else.
        - Pick the diagram type:
          - flowchart: steps, procedures, decisions, structures and hierarchies.
          - sequenceDiagram: messages or requests between people or systems.
          - gantt: schedules with dates or durations.
        - Write labels in the language of the description. Keep them short; leave out "まず", "次に" and the like.
        - flowchart: begin with `flowchart TD`. Give nodes short IDs and quoted labels: A["label"].
          Decisions use B{"question"} and labeled edges: B -->|"yes"| C.
        - sequenceDiagram: declare each person or system: participant U as User.
          Requests: U->>S: text. Replies: S-->>U: text.
        - gantt: use `dateFormat YYYY-MM-DD`, `section` lines and tasks like `Design :a1, 2026-01-05, 3d`.
          A task after another: `Build :a2, after a1, 5d`.
        - Do not put ; or # in labels.
        """;

    /// <summary>Example conversations shown before the user's text.</summary>
    public static readonly IReadOnlyList<ChatMessage> Examples =
    [
        new(ChatRole.User, "申請者が申請書を作成して提出する。上長が内容を確認し、問題なければ承認、問題があれば差し戻す。承認されたら経理が支払う。"),
        new(ChatRole.Assistant, """
            ```mermaid
            flowchart TD
                A["申請書を作成"] --> B["提出"]
                B --> C{"上長が確認<br>問題ない？"}
                C -->|"はい"| D["承認"]
                C -->|"いいえ"| E["差し戻し"]
                E --> A
                D --> F["経理が支払い"]
            ```
            """),
        new(ChatRole.User, "利用者がアプリでログインすると、アプリは認証サーバーにトークンを要求する。認証サーバーはトークンを返し、アプリはホーム画面を表示する。"),
        new(ChatRole.Assistant, """
            ```mermaid
            sequenceDiagram
                participant U as 利用者
                participant A as アプリ
                participant S as 認証サーバー
                U->>A: ログイン
                A->>S: トークンを要求
                S-->>A: トークン
                A-->>U: ホーム画面を表示
            ```
            """),
    ];

    /// <summary>The conversation for a description; kind is auto, flowchart, sequence or gantt.</summary>
    public static List<ChatMessage> Messages(string text, string kind)
    {
        var request = kind switch
        {
            "flowchart" => $"{text}\n\n(Use a flowchart.)",
            "sequence" => $"{text}\n\n(Use a sequenceDiagram.)",
            "gantt" => $"{text}\n\n(Use a gantt chart.)",
            _ => text,
        };
        return [new(ChatRole.System, System), .. Examples, new(ChatRole.User, request)];
    }

    /// <summary>The follow-up asking the model to fix code mermaid rejected.</summary>
    public static ChatMessage Repair(string error) =>
        new(ChatRole.User, $"""
            Mermaid could not read that code:
            {error}

            Fix the code. Answer with the corrected ```mermaid code block only.
            """);

    /// <summary>True once the answer has a closed code block, so generation can stop.</summary>
    public static bool IsComplete(string answer)
    {
        var start = answer.IndexOf("```", StringComparison.Ordinal);
        return start >= 0 && answer.IndexOf("```", start + 3, StringComparison.Ordinal) > start;
    }

    /// <summary>The Mermaid code in the answer: the first code block, or the text from a diagram keyword on.</summary>
    public static string ExtractCode(string answer)
    {
        var block = CodeBlock().Match(answer);
        if (block.Success)
        {
            return block.Groups[1].Value.Trim();
        }
        // An unclosed block, as when generation hit the token limit.
        var open = answer.IndexOf("```", StringComparison.Ordinal);
        if (open >= 0)
        {
            var newline = answer.IndexOf('\n', open);
            return newline < 0 ? "" : answer[(newline + 1)..].Trim();
        }
        var header = DiagramHeader().Match(answer);
        return header.Success ? answer[header.Index..].Trim() : answer.Trim();
    }

    /// <summary>Mermaid's diagram types (from mermaid.parse) that match a requested kind.</summary>
    public static bool MatchesKind(string kind, string? diagramType) => kind switch
    {
        "flowchart" => diagramType is "flowchart" or "flowchart-v2" or "flowchart-elk",
        "sequence" => diagramType == "sequence",
        "gantt" => diagramType == "gantt",
        _ => true,
    };

    [GeneratedRegex(@"```[a-zA-Z]*[^\S\n]*\n(.*?)```", RegexOptions.Singleline)]
    private static partial Regex CodeBlock();

    [GeneratedRegex(@"^(?:flowchart|graph|sequenceDiagram|gantt|classDiagram|stateDiagram|erDiagram|pie|mindmap|timeline)\b", RegexOptions.Multiline)]
    private static partial Regex DiagramHeader();
}
