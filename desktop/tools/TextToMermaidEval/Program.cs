// Measures text-to-Mermaid on a set of cases (cases.ja.json):
//   dotnet run --project desktop/tools/TextToMermaidEval -- [--model <folder>] [--repairs 2] [--kind auto|given] [--cases <file>] [--out <folder>]
// --kind given asks the model for each case's diagram type, as when the user picks one in the app.
// Without --model only the rule-based conversion is measured. Code is checked
// with mermaid.parse through scripts/mermaid-validate.mjs (Node, over stdin/stdout).

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TextToSvgDiagramsForExcel.Generation;

var options = ParseArgs(args);
var repoRoot = FindRepoRoot(AppContext.BaseDirectory);
var casesPath = options.GetValueOrDefault("cases") ?? Path.Combine(AppContext.BaseDirectory, "cases.ja.json");
var outDir = options.GetValueOrDefault("out") ?? Path.Combine(repoRoot, "desktop", "out", "eval");
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
var cases = JsonSerializer.Deserialize<List<Case>>(File.ReadAllText(casesPath), json)!;
var given = options.GetValueOrDefault("kind") == "given";

using var mermaid = new MermaidHelper(repoRoot);
var runs = new List<(string Name, List<CaseResult> Results)>
{
    ("rules", await RunRules()),
};
if (options.GetValueOrDefault("model") is { } modelDir)
{
    runs.Add((Path.GetFileName(Path.TrimEndingDirectorySeparator(modelDir)) + (given ? " (type given)" : ""), await RunModel(modelDir)));
}

Directory.CreateDirectory(outDir);
var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
File.WriteAllText(Path.Combine(outDir, $"{stamp}.json"), JsonSerializer.Serialize(runs.Select(r => new { r.Name, r.Results }), json));
var report = Report(runs);
File.WriteAllText(Path.Combine(outDir, $"{stamp}.md"), report, new UTF8Encoding(false));
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine(report);
Console.WriteLine($"Saved to {Path.Combine(outDir, stamp)}.json / .md");
return 0;

async Task<List<CaseResult>> RunRules()
{
    var results = new List<CaseResult>();
    foreach (var c in cases)
    {
        var watch = Stopwatch.StartNew();
        var (code, error) = await mermaid.FromTextAsync(c.Text);
        var check = code is null ? new CodeCheck(false, Message: error) : await mermaid.CheckAsync(code);
        results.Add(Score(c, code ?? "", check, attempts: 1, firstTryValid: check.Valid, watch.Elapsed));
    }
    return results;
}

async Task<List<CaseResult>> RunModel(string modelDir)
{
    Console.Error.WriteLine($"Loading {modelDir} ...");
    var load = Stopwatch.StartNew();
    using var model = new OnnxChatModel(modelDir);
    Console.Error.WriteLine($"Loaded in {load.Elapsed.TotalSeconds:F1}s");
    var generator = new MermaidGenerator(model, (code, _) => mermaid.CheckAsync(code))
    {
        MaxRepairs = int.Parse(options.GetValueOrDefault("repairs") ?? "2"),
        Tuned = MermaidPrompt.IsTunedModel(modelDir),
    };
    Console.Error.WriteLine(generator.Tuned ? "Tuned model: the text alone is sent." : "General model: instructions and examples are sent.");
    var results = new List<CaseResult>();
    foreach (var c in cases)
    {
        var result = await generator.GenerateAsync(c.Text, given ? c.Type : "auto");
        var last = result.Attempts[^1];
        var scored = Score(c, result.Code, last.Check, result.Attempts.Count, result.Attempts[0].Check.Valid, result.Elapsed);
        results.Add(scored with { Answers = result.Attempts.Select(a => a.Answer).ToList() });
        Console.Error.WriteLine($"{c.Id}: {(scored.Ok ? "OK" : "NG")} attempts={result.Attempts.Count} {result.Elapsed.TotalSeconds:F1}s");
    }
    return results;
}

static CaseResult Score(Case c, string code, CodeCheck check, int attempts, bool firstTryValid, TimeSpan elapsed)
{
    var typeOk = check.Valid && MermaidPrompt.MatchesKind(c.Type, check.Type);
    var found = c.Keywords.Count(k => code.Contains(k, StringComparison.OrdinalIgnoreCase));
    var wanted = c.Type switch { "flowchart" => c.Branches, "sequence" => c.Participants, "gantt" => c.Tasks, _ => null };
    int? counted = typeOk && wanted is not null ? Structure.Count(c.Type, code) : null;
    return new CaseResult(
        c.Id,
        c.Type,
        check.Valid,
        check.Type,
        typeOk,
        c.Keywords.Length == 0 ? 1 : (double)found / c.Keywords.Length,
        attempts,
        firstTryValid,
        Math.Round(elapsed.TotalSeconds, 2),
        code,
        check.Message,
        null,
        wanted,
        counted,
        wanted is null ? null : counted >= wanted);
}

static string Report(List<(string Name, List<CaseResult> Results)> runs)
{
    var text = new StringBuilder();
    text.AppendLine("| method | valid | valid & right type | structure | valid on 1st try | keyword recall | avg s | max s |");
    text.AppendLine("|---|---|---|---|---|---|---|---|");
    foreach (var (name, results) in runs)
    {
        var n = results.Count;
        text.AppendLine(
            $"| {name} | {results.Count(r => r.Valid)}/{n} | {results.Count(r => r.Ok)}/{n} " +
            $"| {results.Count(r => r.StructureOk == true)}/{results.Count(r => r.StructureOk is not null)} | {results.Count(r => r.FirstTryValid)}/{n} " +
            $"| {results.Average(r => r.KeywordRecall):P0} | {results.Average(r => r.Seconds):F1} | {results.Max(r => r.Seconds):F1} |");
    }
    foreach (var (name, results) in runs)
    {
        text.AppendLine().AppendLine($"## {name}").AppendLine();
        text.AppendLine("| type | cases | valid & right type | structure |").AppendLine("|---|---|---|---|");
        foreach (var group in results.GroupBy(r => r.Expected))
        {
            text.AppendLine($"| {group.Key} | {group.Count()} | {group.Count(r => r.Ok)} | {group.Count(r => r.StructureOk == true)}/{group.Count(r => r.StructureOk is not null)} |");
        }
        text.AppendLine();
        text.AppendLine("| case | expected | got | ok | structure | recall | attempts | s |");
        text.AppendLine("|---|---|---|---|---|---|---|---|");
        foreach (var r in results)
        {
            text.AppendLine($"| {r.Id} | {r.Expected} | {(r.Valid ? r.Type : "invalid")} | {(r.Ok ? "✓" : "✗")} | {Mark(r)} | {r.KeywordRecall:P0} | {r.Attempts} | {r.Seconds:F1} |");
        }
    }
    return text.ToString();
}

// The structure column of a case: found / wanted, or empty when the case states no count.
static string Mark(CaseResult r) =>
    r.Wanted is null ? "" : $"{(r.StructureOk == true ? "✓" : "✗")} {r.Counted?.ToString() ?? "-"}/{r.Wanted}";

static Dictionary<string, string> ParseArgs(string[] args)
{
    var options = new Dictionary<string, string>();
    for (var i = 0; i + 1 < args.Length; i += 2)
    {
        options[args[i].TrimStart('-')] = args[i + 1];
    }
    return options;
}

static string FindRepoRoot(string start)
{
    for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
    {
        if (File.Exists(Path.Combine(dir.FullName, "scripts", "mermaid-validate.mjs")))
        {
            return dir.FullName;
        }
    }
    throw new InvalidOperationException("Run from inside the repository (scripts/mermaid-validate.mjs not found).");
}

/// <summary>
/// A case. Branches (flowchart), Participants (sequence) and Tasks (gantt) are the least
/// the diagram must have: decisions the text describes, people or systems, and tasks.
/// </summary>
record Case(string Id, string Type, string Text, string[] Keywords, int? Branches = null, int? Participants = null, int? Tasks = null);

record CaseResult(
    string Id,
    string Expected,
    bool Valid,
    string? Type,
    bool Ok,
    double KeywordRecall,
    int Attempts,
    bool FirstTryValid,
    double Seconds,
    string Code,
    string? Error,
    List<string>? Answers,
    int? Wanted = null,
    int? Counted = null,
    bool? StructureOk = null);

/// <summary>Counts what the structure check compares: decisions, participants or tasks.</summary>
static partial class Structure
{
    public static int Count(string kind, string code) => kind switch
    {
        "flowchart" => Decisions(code),
        "sequence" => Participants(code),
        "gantt" => Tasks(code),
        _ => 0,
    };

    /// <summary>Nodes with arrows to two or more different nodes.</summary>
    private static int Decisions(string code)
    {
        var targets = new Dictionary<string, HashSet<string>>();
        foreach (var raw in code.Split('\n').Skip(1))
        {
            // Leave only ids and arrows: drop labels, edge texts and node shapes.
            var line = Shape().Replace(EdgeText().Replace(Quoted().Replace(raw, ""), ""), "");
            var parts = Arrow().Split(line).Select(p => p.Trim()).ToArray();
            for (var i = 0; i + 1 < parts.Length; i++)
            {
                foreach (var from in parts[i].Split('&', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                {
                    foreach (var to in parts[i + 1].Split('&', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                    {
                        if (!targets.TryGetValue(from, out var set))
                        {
                            targets[from] = set = [];
                        }
                        set.Add(to);
                    }
                }
            }
        }
        return targets.Values.Count(t => t.Count >= 2);
    }

    /// <summary>Declared participants, or the names in the messages when none are declared.</summary>
    private static int Participants(string code)
    {
        var names = new HashSet<string>();
        foreach (var raw in code.Split('\n'))
        {
            var line = raw.Trim();
            if (Declared().Match(line) is { Success: true } declared)
            {
                names.Add(declared.Groups[1].Value);
            }
            else if (Message().Match(line) is { Success: true } message)
            {
                names.Add(message.Groups[1].Value.Trim());
                names.Add(message.Groups[2].Value.Trim());
            }
        }
        return names.Count;
    }

    private static int Tasks(string code) =>
        code.Split('\n').Select(l => l.Trim()).Count(l => l.Contains(':') && !GanttSetting().IsMatch(l));

    [GeneratedRegex("\"[^\"]*\"")]
    private static partial Regex Quoted();

    [GeneratedRegex(@"\|[^|]*\|")]
    private static partial Regex EdgeText();

    [GeneratedRegex(@"\[[^\]]*\]|\{[^}]*\}|\([^)]*\)")]
    private static partial Regex Shape();

    [GeneratedRegex(@"--[^-<>|]+-->|-\.[^-<>|]*\.->|==[^=<>|]*==>|-{2,}>|-{3,}|={2,}>|-\.+->")]
    private static partial Regex Arrow();

    [GeneratedRegex(@"^(?:participant|actor)\s+(\S+)")]
    private static partial Regex Declared();

    [GeneratedRegex(@"^([^:]+?)\s*(?:-->>|->>|--\)|-\)|--x|-x|-->|->)\s*([^:]+?)\s*:")]
    private static partial Regex Message();

    [GeneratedRegex(@"^(?:title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|section)\b")]
    private static partial Regex GanttSetting();
}

/// <summary>scripts/mermaid-validate.mjs, run once and asked one line at a time.</summary>
sealed class MermaidHelper : IDisposable
{
    private readonly Process _node;

    public MermaidHelper(string repoRoot)
    {
        var start = new ProcessStartInfo("node", Path.Combine(repoRoot, "scripts", "mermaid-validate.mjs"))
        {
            WorkingDirectory = repoRoot,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
        };
        _node = Process.Start(start) ?? throw new InvalidOperationException("Could not start node.");
    }

    public async Task<CodeCheck> CheckAsync(string code)
    {
        using var doc = await AskAsync(code);
        var root = doc.RootElement;
        return root.GetProperty("valid").GetBoolean()
            ? new CodeCheck(true, root.GetProperty("type").GetString())
            : new CodeCheck(false, Message: root.GetProperty("message").GetString());
    }

    public async Task<(string? Code, string? Error)> FromTextAsync(string text)
    {
        using var doc = await AskAsync(new { fromText = text, kind = "auto" });
        var root = doc.RootElement;
        return root.TryGetProperty("code", out var code) ? (code.GetString(), null) : (null, root.GetProperty("error").GetString());
    }

    private async Task<JsonDocument> AskAsync(object request)
    {
        await _node.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request));
        await _node.StandardInput.FlushAsync();
        var line = await _node.StandardOutput.ReadLineAsync() ?? throw new InvalidOperationException("mermaid-validate.mjs stopped.");
        return JsonDocument.Parse(line);
    }

    public void Dispose()
    {
        _node.StandardInput.Close();
        if (!_node.WaitForExit(5000))
        {
            _node.Kill();
        }
        _node.Dispose();
    }
}
