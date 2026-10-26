using System.Windows;
using System.Windows.Media;
using ICSharpCode.AvalonEdit.Rendering;

namespace TextToSvgDiagramsForExcel.Desktop.Views;

/// <summary>Paints the background of the render error's line (the add-in's backdrop, §4.11).</summary>
public sealed class ErrorLineRenderer(TextView textView) : IBackgroundRenderer
{
    private static readonly Brush s_brush = Freeze(new SolidColorBrush(Color.FromArgb(0x40, 0xE8, 0x11, 0x23)));

    private int? _line;

    /// <summary>The highlighted 0-based line, or null.</summary>
    public int? Line
    {
        get => _line;
        set
        {
            _line = value;
            textView.InvalidateLayer(Layer);
        }
    }

    public KnownLayer Layer => KnownLayer.Background;

    public void Draw(TextView textView, DrawingContext drawingContext)
    {
        if (_line is not int line || textView.Document is not { } document || line >= document.LineCount)
        {
            return;
        }
        var documentLine = document.GetLineByNumber(line + 1);
        foreach (var rect in BackgroundGeometryBuilder.GetRectsFromVisualSegment(textView, textView.GetOrConstructVisualLine(documentLine), 0, 1000))
        {
            drawingContext.DrawRectangle(s_brush, null, new Rect(0, rect.Top, textView.ActualWidth, rect.Height));
        }
    }

    private static Brush Freeze(Brush brush)
    {
        brush.Freeze();
        return brush;
    }
}
