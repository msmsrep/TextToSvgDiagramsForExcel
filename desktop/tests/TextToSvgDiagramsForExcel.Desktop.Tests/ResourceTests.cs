using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Xml.Linq;
using TextToSvgDiagramsForExcel.Desktop.Excel;
using TextToSvgDiagramsForExcel.Desktop.Resources;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

public class ResourceTests
{
    private static Dictionary<string, string> Read(string file) =>
        XDocument.Load(Path.Combine(AppContext.BaseDirectory, "resx", file))
            .Root!.Elements("data")
            .ToDictionary(d => (string)d.Attribute("name")!, d => (string)d.Element("value")!);

    [Fact]
    public void EnglishAndJapaneseHaveTheSameKeys()
    {
        var en = Read("Strings.resx");
        var ja = Read("Strings.ja.resx");
        Assert.Equal(en.Keys.Order(), ja.Keys.Order());
        Assert.All(ja, pair => Assert.False(string.IsNullOrWhiteSpace(pair.Value), pair.Key));
    }

    [Fact]
    public void FormatPlaceholdersMatch()
    {
        var en = Read("Strings.resx");
        var ja = Read("Strings.ja.resx");
        static string Placeholders(string text) =>
            string.Join(",", System.Text.RegularExpressions.Regex.Matches(text, @"\{\d+\}").Select(m => m.Value).Order());
        Assert.All(en, pair => Assert.Equal(Placeholders(pair.Value), Placeholders(ja[pair.Key])));
    }

    [Fact]
    public void LooksUpTheChosenLanguage()
    {
        var saved = Strings.Culture;
        try
        {
            Strings.Culture = CultureInfo.GetCultureInfo("ja-JP");
            Assert.Equal("ja", Strings.Locale);
            Assert.Equal("Excel に挿入", Strings.Get("Button_Insert"));
            Strings.Culture = CultureInfo.GetCultureInfo("en-US");
            Assert.Equal("en", Strings.Locale);
            Assert.Equal("Insert to Excel", Strings.Get("Button_Insert"));
            Assert.Equal("Go to line 3", Strings.Format("GoToLine", 3));
        }
        finally
        {
            Strings.Culture = saved;
        }
    }

    [Theory]
    [InlineData("ja", "ja")]
    [InlineData("en", "en")]
    public void ChoosesTheCultureForTheLanguageSetting(string setting, string language)
    {
        Assert.Equal(language, Strings.CultureFor(setting).TwoLetterISOLanguageName);
    }

    [Theory]
    [InlineData("#FF0000", 0x0000FF)]
    [InlineData("#00FF00", 0x00FF00)]
    [InlineData("#123456", 0x563412)]
    [InlineData("bad", 0)]
    public void ConvertsColorsToOfficeBgr(string color, int rgb)
    {
        Assert.Equal(rgb, Office.Rgb(color));
    }

    [Fact]
    public void SettingsSurviveARoundTrip()
    {
        var path = Path.Combine(Path.GetTempPath(), $"settings-{Guid.NewGuid():N}", "settings.json");
        var store = new SettingsStore(path);
        try
        {
            store.Save(new Settings { Format = "svg", Size = "width", Width = "300", Language = "ja", AutoDetectSelection = false });
            var loaded = store.Load();
            Assert.Equal(("svg", "width", "300", "ja", false), (loaded.Format, loaded.Size, loaded.Width, loaded.Language, loaded.AutoDetectSelection));
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(path)!, recursive: true);
        }
    }

    [Fact]
    public void BrokenSettingsFallBackToDefaults()
    {
        var path = Path.Combine(Path.GetTempPath(), $"settings-{Guid.NewGuid():N}.json");
        File.WriteAllText(path, "{ not json");
        try
        {
            Assert.Equal("png", new SettingsStore(path).Load().Format);
        }
        finally
        {
            File.Delete(path);
        }
        Assert.Equal("png", new SettingsStore(path).Load().Format);
    }

    [Fact]
    public void ShapeModelJsonFromTheEngineDeserializes()
    {
        const string json = """
            {"nodes":[{"id":"A","type":"Rectangle","box":{"left":0,"top":0,"width":10,"height":5},"fill":null,
              "line":{"color":"#333333","weight":0.75,"dashStyle":"Solid"},"label":{"text":"A","size":12,"color":"#333333"},"labelPosition":"Middle"}],
             "edges":[{"from":"A","to":"A","begin":{"x":1,"y":2},"end":{"x":3,"y":4},"beginArrow":"None","endArrow":"Triangle",
              "line":{"color":"#333333","weight":1.5,"dashStyle":"Dash"},"connectorType":"Elbow"}],
             "labels":[]}
            """;
        var model = JsonSerializer.Deserialize<Engine.ShapeModel>(json, Engine.EngineJson.Options)!;
        Assert.Null(model.Nodes[0].Fill);
        Assert.Equal("Dash", model.Edges[0].Line.DashStyle);
        Assert.Equal(new Engine.Point(3, 4), model.Edges[0].End);
    }

    [Fact]
    public void InstanceMutexNameIsStableForTheFolder()
    {
        // string.GetHashCode differs between processes, so the name must not depend on it.
        string name = App.InstanceMutexName(@"C:\Users\a\AppData\Local\TextToSvgDiagramsForExcel");
        Assert.Equal("Local\\TextToSvgDiagramsForExcel-", name[..^16]);
        Assert.Equal(name, App.InstanceMutexName(@"c:\users\a\appdata\local\TextToSvgDiagramsForExcel"));
        Assert.NotEqual(name, App.InstanceMutexName(@"C:\Users\b\AppData\Local\TextToSvgDiagramsForExcel"));
    }
}
