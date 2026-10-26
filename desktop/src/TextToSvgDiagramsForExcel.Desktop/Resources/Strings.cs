using System.Globalization;
using System.Resources;
using System.Windows.Markup;

namespace TextToSvgDiagramsForExcel.Desktop.Resources;

/// <summary>
/// UI text from Strings.resx / Strings.ja.resx. The language is chosen at
/// startup (design §6.3); changing it takes effect after a restart.
/// </summary>
public static class Strings
{
    private static readonly ResourceManager s_resources =
        new("TextToSvgDiagramsForExcel.Desktop.Resources.Strings", typeof(Strings).Assembly);

    public static CultureInfo Culture { get; set; } = CultureInfo.CurrentUICulture;

    /// <summary>"ja" or "en", for the engine's messages.</summary>
    public static string Locale => Culture.TwoLetterISOLanguageName == "ja" ? "ja" : "en";

    public static string Get(string key) => s_resources.GetString(key, Culture) ?? key;

    public static string Format(string key, params object[] args) =>
        string.Format(Culture, Get(key), args);

    /// <summary>The UI culture for the "Language" setting ("system", "en" or "ja").</summary>
    public static CultureInfo CultureFor(string language) => language switch
    {
        "ja" => CultureInfo.GetCultureInfo("ja-JP"),
        "en" => CultureInfo.GetCultureInfo("en-US"),
        _ => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ja"
            ? CultureInfo.GetCultureInfo("ja-JP")
            : CultureInfo.GetCultureInfo("en-US"),
    };
}

/// <summary>XAML markup extension for UI text: {res:Loc Key}.</summary>
[MarkupExtensionReturnType(typeof(string))]
public sealed class LocExtension : MarkupExtension
{
    public LocExtension()
    {
    }

    public LocExtension(string key)
    {
        Key = key;
    }

    public string Key { get; set; } = "";

    public override object ProvideValue(IServiceProvider serviceProvider) => Strings.Get(Key);
}
