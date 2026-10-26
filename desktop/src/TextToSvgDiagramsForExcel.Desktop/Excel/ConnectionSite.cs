using TextToSvgDiagramsForExcel.Desktop.Engine;

namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>
/// Port of connectionSite in src/core/flowchartModel.ts. Both are checked
/// against test/fixtures/connectionSite.json. Sites are 0-based; COM's
/// BeginConnect / EndConnect take the site + 1.
/// </summary>
public static class ConnectionSite
{
    /// <summary>
    /// Connection site directions (degrees counterclockwise from the top, in
    /// box-relative units) measured in Excel for shapes whose sites are not
    /// spaced evenly from the top.
    /// </summary>
    private static readonly Dictionary<string, double[]> s_siteAngles = new()
    {
        ["Can"] = [0, 0, 90, 180, 270],
        ["Hexagon"] = [270, 215, 145, 90, 35, 325],
        ["Parallelogram"] = [0, 351, 270, 171, 180, 90],
    };

    /// <summary>
    /// The connection site of a shape of the given type nearest to the point,
    /// other than <paramref name="exclude"/> (the other end of a self-loop).
    /// </summary>
    public static int Nearest(Box box, Point point, int siteCount, string? type = null, int? exclude = null)
    {
        // As "box.width / 2 || 1" in TS: a zero-size box counts as size 2.
        static double Half(double size) => size / 2 is var half && half != 0 && !double.IsNaN(half) ? half : 1;
        double dx = (point.X - (box.Left + box.Width / 2)) / Half(box.Width);
        double dy = (point.Y - (box.Top + box.Height / 2)) / Half(box.Height);
        double angle = Math.Atan2(-dx, -dy) * 180 / Math.PI;
        double[] angles = type is not null && s_siteAngles.TryGetValue(type, out var measured) && measured.Length == siteCount
            ? measured
            : Enumerable.Range(0, siteCount).Select(i => 360.0 / siteCount * i).ToArray();

        double Distance(double a)
        {
            // JavaScript's % keeps the dividend's sign, as C#'s does.
            double d = Math.Abs(a - angle) % 360;
            return Math.Min(d, 360 - d);
        }

        int best = -1;
        for (int i = 0; i < angles.Length; i++)
        {
            if (i != exclude && (best < 0 || Distance(angles[i]) < Distance(angles[best])))
            {
                best = i;
            }
        }
        return Math.Max(best, 0);
    }
}
