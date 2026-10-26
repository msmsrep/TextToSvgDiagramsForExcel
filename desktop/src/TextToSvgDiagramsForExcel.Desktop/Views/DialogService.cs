using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using TextToSvgDiagramsForExcel.Desktop.Services;

namespace TextToSvgDiagramsForExcel.Desktop.Views;

public sealed class DialogService(Window owner) : IDialogService
{
    public bool SaveFile(string defaultName, string filter, byte[] data)
    {
        var dialog = new SaveFileDialog { FileName = defaultName, Filter = filter, AddExtension = true };
        if (dialog.ShowDialog(owner) != true)
        {
            return false;
        }
        File.WriteAllBytes(dialog.FileName, data);
        return true;
    }

    public string? OpenText(string filter)
    {
        var dialog = new OpenFileDialog { Filter = filter };
        return dialog.ShowDialog(owner) == true ? File.ReadAllText(dialog.FileName, Encoding.UTF8) : null;
    }

    public void CopyImage(byte[] png, string svg)
    {
        var data = new DataObject();
        // Apps that keep transparency read "PNG"; others read the bitmap.
        data.SetData("PNG", new MemoryStream(png));
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = new MemoryStream(png);
        bitmap.EndInit();
        bitmap.Freeze();
        data.SetImage(bitmap);
        data.SetData("image/svg+xml", new MemoryStream(new UTF8Encoding(false).GetBytes(svg)));
        Clipboard.SetDataObject(data, copy: true);
    }
}
