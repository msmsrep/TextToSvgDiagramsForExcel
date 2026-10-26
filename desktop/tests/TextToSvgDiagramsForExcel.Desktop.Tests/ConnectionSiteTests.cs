using System.IO;
using System.Text.Json;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Excel;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

/// <summary>The same cases as connectionSite in test/flowchartModel.test.ts.</summary>
public class ConnectionSiteTests
{
    public sealed record Case(string Name, Box Box, Point Point, int SiteCount, string? Type, int? Exclude, int Expected)
    {
        public override string ToString() => Name;
    }

    private sealed record Fixture(Case[] Cases);

    public static TheoryData<Case> Cases()
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "connectionSite.json"));
        var fixture = JsonSerializer.Deserialize<Fixture>(json, EngineJson.Options)!;
        var data = new TheoryData<Case>();
        foreach (var c in fixture.Cases)
        {
            data.Add(c);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void MatchesTheTypeScriptResults(Case c)
    {
        Assert.Equal(c.Expected, ConnectionSite.Nearest(c.Box, c.Point, c.SiteCount, c.Type, c.Exclude));
    }
}
