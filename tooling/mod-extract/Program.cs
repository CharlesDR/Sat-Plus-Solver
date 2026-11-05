using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.MappingsProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.Compression;
using Newtonsoft.Json;

// args: <modsDir> <mode:list|dump|probe> [filter] [usmap]
var dir = args[0]; var mode = args[1]; var filter = args.Length > 2 ? args[2] : "";
var provider = new DefaultFileProvider(dir, SearchOption.AllDirectories, new VersionContainer(EGame.GAME_UE5_3), StringComparer.OrdinalIgnoreCase);
if (args.Length > 3 && args[3].EndsWith(".usmap")) provider.MappingsContainer = new FileUsmapTypeMappingsProvider(args[3]);
provider.Initialize();
var mounted = provider.Mount();
Console.Error.WriteLine($"mounted={mounted} files={provider.Files.Count}");
if (mode == "list") { foreach (var f in provider.Files.Keys.Where(k => k.Contains(filter, StringComparison.OrdinalIgnoreCase)).OrderBy(k => k)) Console.WriteLine(f); return; }
if (mode == "dump") {
  foreach (var f in provider.Files.Keys.Where(k => k.EndsWith(".uasset") && k.Contains(filter, StringComparison.OrdinalIgnoreCase)).OrderBy(k => k)) {
    try { var objs = provider.LoadPackage(f).GetExports(); Console.WriteLine(JsonConvert.SerializeObject(new { file = f, exports = objs }, Formatting.Indented)); }
    catch (Exception e) { Console.WriteLine($"ERR {f}: {e.GetType().Name}: {e.Message}"); }
  }
}
if (mode == "raw") {
  Directory.CreateDirectory(args[3]);
  var rx = new System.Text.RegularExpressions.Regex(filter, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
  foreach (var f in provider.Files.Keys.Where(k => k.EndsWith(".uasset") && rx.IsMatch(k)).OrderBy(k => k)) {
    try { var b = provider.SaveAsset(f); var o = Path.Combine(args[3], f); Directory.CreateDirectory(Path.GetDirectoryName(o)!); File.WriteAllBytes(o, b); }
    catch (Exception e) { Console.WriteLine($"ERR {f}: {e.GetType().Name}: {e.Message}"); }
  }
}
