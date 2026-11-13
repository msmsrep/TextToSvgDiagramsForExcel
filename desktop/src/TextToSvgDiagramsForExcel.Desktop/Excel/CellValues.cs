namespace TextToSvgDiagramsForExcel.Desktop.Excel;

/// <summary>
/// Converts COM's Range.Value2 to the form Office.js returns in Range.values
/// (design §5.6): a 0-based 2D array, "" for empty cells, and error values as
/// their text ("#N/A").
/// </summary>
public static class CellValues
{
    // CVErr values are 0x800A0000 + the xlErr code.
    private const int CvErrBase = unchecked((int)0x800A0000);

    private static readonly Dictionary<int, string> s_errors = new()
    {
        [2000] = "#NULL!",
        [2007] = "#DIV/0!",
        [2015] = "#VALUE!",
        [2023] = "#REF!",
        [2029] = "#NAME?",
        [2036] = "#NUM!",
        [2042] = "#N/A",
        [2043] = "#GETTING_DATA",
        [2045] = "#SPILL!",
        [2046] = "#CONNECT!",
        [2047] = "#BLOCKED!",
        [2048] = "#UNKNOWN!",
        [2049] = "#FIELD!",
        [2050] = "#CALC!",
    };

    /// <summary>
    /// Value2 of a range with the given size: a scalar for one cell, or a
    /// 1-based object[,] for more.
    /// </summary>
    public static object[][] FromValue2(object? value2, int rows, int columns)
    {
        var result = new object[rows][];
        if (value2 is object?[,] array)
        {
            int r0 = array.GetLowerBound(0);
            int c0 = array.GetLowerBound(1);
            for (int r = 0; r < rows; r++)
            {
                result[r] = new object[columns];
                for (int c = 0; c < columns; c++)
                {
                    result[r][c] = Convert(array[r0 + r, c0 + c]);
                }
            }
        }
        else
        {
            result[0] = [Convert(value2)];
        }
        return result;
    }

    /// <summary>One cell's value: strings, numbers and booleans as they are, "" when empty.</summary>
    public static object Convert(object? value) => value switch
    {
        null => "",
        // Error cells come back as Int32 (VT_ERROR); numbers are always double.
        int error => ErrorText(error),
        double or bool or string => value,
        DateTime date => date.ToOADate(),
        decimal money => (double)money,
        _ => value.ToString() ?? "",
    };

    /// <summary>
    /// The 0-based first and last rows and columns that have values (anything
    /// but ""), or null when every cell is empty.
    /// </summary>
    public static (int Top, int Left, int Bottom, int Right)? Bounds(object[][] values)
    {
        int top = -1, left = int.MaxValue, bottom = -1, right = -1;
        for (int r = 0; r < values.Length; r++)
        {
            for (int c = 0; c < values[r].Length; c++)
            {
                if (values[r][c] is "")
                {
                    continue;
                }
                if (top < 0)
                {
                    top = r;
                }
                bottom = r;
                left = Math.Min(left, c);
                right = Math.Max(right, c);
            }
        }
        return top < 0 ? null : (top, left, bottom, right);
    }

    /// <summary>The block of the given size from the 0-based row and column.</summary>
    public static object[][] Slice(object[][] values, int top, int left, int rows, int columns) =>
        values.Skip(top).Take(rows).Select(row => row.Skip(left).Take(columns).ToArray()).ToArray();

    public static string ErrorText(int cvErr) =>
        s_errors.TryGetValue(cvErr - CvErrBase, out var text) ? text : "#UNKNOWN!";
}
