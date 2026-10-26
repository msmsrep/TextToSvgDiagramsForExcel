using TextToSvgDiagramsForExcel.Desktop.Excel;

namespace TextToSvgDiagramsForExcel.Desktop.Tests;

public class CellValuesTests
{
    [Fact]
    public void ScalarBecomesOneByOne()
    {
        Assert.Equal([["A"]], CellValues.FromValue2("A", 1, 1));
    }

    [Fact]
    public void EmptyScalarBecomesEmptyString()
    {
        Assert.Equal([[""]], CellValues.FromValue2(null, 1, 1));
    }

    [Fact]
    public void OneBasedArrayBecomesZeroBasedRows()
    {
        // COM returns Value2 as a 1-based array.
        var value2 = (object?[,])Array.CreateInstance(typeof(object), [2, 3], [1, 1]);
        value2[1, 1] = "Task";
        value2[1, 2] = 46000.0;
        value2[1, 3] = true;
        value2[2, 1] = null;
        value2[2, 2] = -2146826246; // #N/A
        value2[2, 3] = "x";

        var rows = CellValues.FromValue2(value2, 2, 3);

        Assert.Equal(
            [
                ["Task", 46000.0, true],
                ["", "#N/A", "x"],
            ],
            rows);
    }

    [Theory]
    [InlineData(-2146826281, "#DIV/0!")]
    [InlineData(-2146826273, "#VALUE!")]
    [InlineData(-2146826265, "#REF!")]
    [InlineData(-2146826259, "#NAME?")]
    [InlineData(-2146826252, "#NUM!")]
    [InlineData(-2146826288, "#NULL!")]
    [InlineData(-2146826246, "#N/A")]
    [InlineData(-2146826243, "#SPILL!")]
    [InlineData(-2146826238, "#CALC!")]
    [InlineData(-1, "#UNKNOWN!")]
    public void ErrorValuesBecomeTheirText(int cvErr, string text)
    {
        Assert.Equal(text, CellValues.Convert(cvErr));
    }

    [Fact]
    public void DatesAndCurrencyBecomeNumbers()
    {
        Assert.Equal(45658.0, CellValues.Convert(new DateTime(2025, 1, 1)));
        Assert.Equal(1.5, CellValues.Convert(1.5m));
    }
}
