using System.Text.Json;

namespace TextToSvgDiagramsForExcel.Desktop.Engine;

// Shapes of the engine's results (src/engine/engine.ts). JSON uses camelCase.

/// <summary>The rendered diagram's number and actual size in px (null without a viewBox).</summary>
public sealed record RenderResult(int Seq, double? Width, double? Height);

/// <summary>A PNG or JPEG and its display size in px.</summary>
public sealed record RasterResult(string Base64, double Width, double Height);

public sealed record SvgResult(string Svg);

/// <summary>SVG simplified for Excel's Convert to Shape, and its size in px.</summary>
public sealed record OfficeSvgResult(string Svg, double Width, double Height);

public sealed record CodeResult(string Code);

public sealed record Template(string Id, string Name, string Code);

/// <summary>A selected cell range, as tableToMermaid's TableData.</summary>
public sealed record TableData(
    object[][] Values,
    string[][] Text,
    string[][] NumberFormat,
    int FirstRow,
    bool Date1904);

// The flowchart as Excel shapes (flowchartModel.ts). Coordinates are in
// points from the diagram's top-left.

public sealed record Box(double Left, double Top, double Width, double Height);

public sealed record Point(double X, double Y);

/// <summary>Solid fill; transparency 0 (opaque) to 1.</summary>
public sealed record Fill(string Color, double Transparency);

/// <summary>Outline; DashStyle is "Solid" or "Dash".</summary>
public sealed record Line(string Color, double Weight, string DashStyle);

public sealed record Label(string Text, double Size, string Color);

/// <summary>LabelPosition is "Middle", or "Top" for subgraph titles.</summary>
public sealed record ShapeNode(string Id, string Type, Box Box, Fill? Fill, Line? Line, Label Label, string LabelPosition);

/// <summary>Arrowheads are "None", "Triangle", "Oval" or "Diamond"; ConnectorType is "Straight" or "Elbow".</summary>
public sealed record ShapeEdge(
    string From,
    string To,
    Point Begin,
    Point End,
    string BeginArrow,
    string EndArrow,
    Line Line,
    string ConnectorType);

public sealed record ShapeTextBox(Box Box, Fill? Fill, Label Label);

/// <summary>Subgraphs come first (outermost first) so they end up behind the nodes.</summary>
public sealed record ShapeModel(IReadOnlyList<ShapeNode> Nodes, IReadOnlyList<ShapeEdge> Edges, IReadOnlyList<ShapeTextBox> Labels);

public static class EngineJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
