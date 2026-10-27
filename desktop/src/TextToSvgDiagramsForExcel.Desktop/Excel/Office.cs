using System.Globalization;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>Office and Excel constants used through late binding (values from the type libraries).</summary>
internal static class Office
{
    public const string AltTextTitle = "Mermaid Diagram";

    public const int MsoTrue = -1;
    public const int MsoFalse = 0;

    // MsoShapeType: the shapes listed as diagrams (design §5.3).
    public const int MsoAutoShape = 1;
    public const int MsoGroup = 6;
    public const int MsoPicture = 13;
    public const int MsoGraphic = 28;
    public static readonly int[] DiagramShapeTypes = [MsoPicture, MsoGraphic, MsoGroup, MsoAutoShape];

    // MsoConnectorType
    public const int MsoConnectorStraight = 1;
    public const int MsoConnectorElbow = 2;

    // MsoTextOrientation, MsoAutoSize, MsoVerticalAnchor, MsoParagraphAlignment
    public const int MsoTextOrientationHorizontal = 1;
    public const int MsoAutoSizeNone = 0;
    public const int MsoAnchorTop = 1;
    public const int MsoAnchorMiddle = 3;
    public const int MsoAlignCenter = 2;

    // MsoLineDashStyle
    public const int MsoLineSolid = 1;
    public const int MsoLineDash = 4;

    /// <summary>MsoAutoShapeType for the shape model's types (Office.js GeometricShapeType names).</summary>
    public static readonly Dictionary<string, int> AutoShapeTypes = new()
    {
        ["Rectangle"] = 1, // msoShapeRectangle
        ["Parallelogram"] = 2, // msoShapeParallelogram
        ["Trapezoid"] = 3, // msoShapeTrapezoid
        ["Diamond"] = 4, // msoShapeDiamond
        ["RoundRectangle"] = 5, // msoShapeRoundedRectangle
        ["Ellipse"] = 9, // msoShapeOval
        ["Hexagon"] = 10, // msoShapeHexagon
        ["Can"] = 13, // msoShapeCan
        ["FlowChartPredefinedProcess"] = 65, // msoShapeFlowchartPredefinedProcess
        ["FlowChartDocument"] = 67, // msoShapeFlowchartDocument
        ["FlowChartTerminator"] = 69, // msoShapeFlowchartTerminator
        ["FlowChartManualOperation"] = 72, // msoShapeFlowchartManualOperation
    };

    /// <summary>MsoArrowheadStyle for the shape model's arrowheads.</summary>
    public static readonly Dictionary<string, int> ArrowheadStyles = new()
    {
        ["None"] = 1, // msoArrowheadNone
        ["Triangle"] = 2, // msoArrowheadTriangle
        ["Diamond"] = 5, // msoArrowheadDiamond
        ["Oval"] = 6, // msoArrowheadOval
    };

    /// <summary>"#RRGGBB" as an Office RGB value, which is in BGR order.</summary>
    public static int Rgb(string color)
    {
        var hex = color.TrimStart('#');
        if (hex.Length != 6 || !int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int rgb))
        {
            return 0;
        }
        int r = (rgb >> 16) & 0xFF;
        int g = (rgb >> 8) & 0xFF;
        int b = rgb & 0xFF;
        return r | (g << 8) | (b << 16);
    }
}
