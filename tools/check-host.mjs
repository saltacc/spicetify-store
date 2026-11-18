// Run inside the SpotiKit source checkout. Only a temporary copy of an input archive is patched.
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
const root = fileURLToPath(new URL("../", import.meta.url)),
  dir = await mkdtemp(path.join(os.tmpdir(), "spice-host-"));
try {
  const hostProject = path
    .resolve(root, "../../SpotiKit.csproj")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
  const csproj =
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><ProjectReference Include="' +
    hostProject +
    '"/></ItemGroup></Project>';
  await writeFile(path.join(dir, "Check.csproj"), csproj);
  await writeFile(
    path.join(dir, "Program.cs"),
    [
      "using System.IO.Compression;",
      "using SpotiKit.Services;",
      'var root = args[0]; var zipPath = args[1]; var archive = Path.Combine(root, "xpui.spa");',
      'var paths = new SpotiKitPaths(root, Path.Combine(root, "settings.json"), null, root);',
      "ZipFile.ExtractToDirectory(zipPath, paths.ExtensionsDir);",
      'var addons = new AddonCatalog(paths).Load(); const string main = "spicetify-store/dist/extension.js";',
      'if (!addons.Extensions.SequenceEqual(new[]{main}) || addons.Skipped.Count > 0) throw new Exception(string.Join(", ", addons.Skipped));',
      "var framework = FrameworkPackage.Bundled; XpuiPatcher.Inject(archive, framework.LoaderScript, framework.Version, addons:addons);",
      'var inspection = XpuiPatcher.Inspect(archive); if (!inspection.HasSpotiKit || inspection.ForeignMods.Count != 0) throw new Exception("Host inspection failed");',
      "using var zip = ZipFile.OpenRead(archive); using var packaged = zip.GetEntry(XpuiPatcher.ExtensionsPrefix + main)!.Open(); using var contents = new MemoryStream(); packaged.CopyTo(contents);",
      'if (!contents.ToArray().SequenceEqual(File.ReadAllBytes(Path.Combine(paths.ExtensionsDir,main)))) throw new Exception("Installed bundle differs from release");',
      'using var cfg = new StreamReader(zip.GetEntry(XpuiPatcher.ConfigScriptEntry)!.Open()); if (!cfg.ReadToEnd().Contains(main)) throw new Exception("The local loader configuration omitted the extension");',
      'Console.WriteLine($"PASS SpotiKit {framework.Version} AddonCatalog, XPUI injection, loader config and byte-for-byte installed bundle");',
    ].join("\n"),
  );
  const target = path.join(dir, "xpui.spa");
  if (process.argv[2]) await copyFile(process.argv[2], target);
  else await writeFile(target, zipSync({ "index.html": strToU8("<html><body></body></html>") }));
  const { version } = JSON.parse(await readFile(path.join(root, "spotikit.json"), "utf8"));
  const result = spawnSync(
    process.env.DOTNET || "dotnet",
    [
      "run",
      "--project",
      path.join(dir, "Check.csproj"),
      "--",
      dir,
      path.join(root, "release", "spicetify-store-" + version + ".zip"),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status) process.exitCode = result.status;
} finally {
  await rm(dir, { recursive: true, force: true });
}
