using System.IO;
using TextToSvgDiagramsForExcel.Desktop.Engine;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

public sealed class LocalTextModelTests
{
    private static Task<ParseResult> Parse(string code) => Task.FromResult(new ParseResult(true, "flowchart-v2"));

    [Fact]
    public void FindsNoModelInAFolderWithoutOne()
    {
        var folder = Directory.CreateTempSubdirectory().FullName;
        try
        {
            Assert.Null(LocalTextModel.Find(folder, Parse));
            Assert.Null(LocalTextModel.Find(Path.Combine(folder, "missing"), Parse));
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void FindsAModelFolderByItsGenAiConfig()
    {
        var folder = Directory.CreateTempSubdirectory().FullName;
        try
        {
            File.WriteAllText(Path.Combine(folder, "genai_config.json"), "{}");
            using var model = LocalTextModel.Find(folder, Parse);
            Assert.NotNull(model);
            Assert.Contains("gantt", model.Kinds);
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }
}
