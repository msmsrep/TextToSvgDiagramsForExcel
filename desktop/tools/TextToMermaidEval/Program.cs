// Measures text-to-Mermaid on a set of cases (cases.ja.json):
//   dotnet run --project desktop/tools/TextToMermaidEval -- [--model <folder>] [--repairs 2] [--cases <file>] [--out <folder>]
// Without --model only the rule-based conversion is measured. Code is checked
// with mermaid.parse through scripts/mermaid-validate.mjs (Node, over stdin/stdout).

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using TextToSvgDiagramsForExcel.Generation;

var options = ParseArgs(args);
var repoRoot = FindRepoRoot(AppContext.BaseDirectory);
var casesPath = options.GetValueOrDefault("cases") ?? Path.Combine(AppContext.BaseDirectory, "cases.ja.json");
var outDir = options.GetValueOrDefault("out") ?? Path.Combine(repoRoot, "desktop", "out", "eval");
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
var cases = JsonSerializer.Deserialize<List<Case>>(File.ReadAllText(casesPath), json)!;

using var mermaid = new MermaidHelper(repoRoot);
var runs = new List<(string Name, List<CaseResult> Results)>
{
    ("rules", await RunRules()),
};
if (options.GetValueOrDefault("model") is { } modelDir)
{
    runs.Add((Path.GetFileName(Path.TrimEndingDirectorySeparator(modelDir)), await RunModel(modelDir)));
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
    };
    var results = new List<CaseResult>();
    foreach (var c in cases)
    {
        var result = await generator.GenerateAsync(c.Text, "auto");
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
        null);
}

static string Report(List<(string Name, List<CaseResult> Results)> runs)
{
    var text = new StringBuilder();
    text.AppendLine("| method | valid | valid & right type | valid on 1st try | keyword recall | avg s | max s |");
    text.AppendLine("|---|---|---|---|---|---|---|");
    foreach (var (name, results) in runs)
    {
        var n = results.Count;
        text.AppendLine(
            $"| {name} | {results.Count(r => r.Valid)}/{n} | {results.Count(r => r.Ok)}/{n} | {results.Count(r => r.FirstTryValid)}/{n} " +
            $"| {results.Average(r => r.KeywordRecall):P0} | {results.Average(r => r.Seconds):F1} | {results.Max(r => r.Seconds):F1} |");
    }
    foreach (var (name, results) in runs)
    {
        text.AppendLine().AppendLine($"## {name}").AppendLine();
        text.AppendLine("| case | expected | got | ok | recall | attempts | s |");
        text.AppendLine("|---|---|---|---|---|---|---|");
        foreach (var r in results)
        {
            text.AppendLine($"| {r.Id} | {r.Expected} | {(r.Valid ? r.Type : "invalid")} | {(r.Ok ? "✓" : "✗")} | {r.KeywordRecall:P0} | {r.Attempts} | {r.Seconds:F1} |");
        }
    }
    return text.ToString();
}

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

record Case(string Id, string Type, string Text, string[] Keywords);

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
    List<string>? Answers);

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
