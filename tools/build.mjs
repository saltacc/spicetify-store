import { build } from "esbuild";
import { zipSync } from "fflate";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "spotikit.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      const children = await filesIn(name);
      files.push(...children);
    } else if (entry.isFile()) {
      files.push(name);
    }
  }
  return files;
}

async function readFiles(names) {
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, name))]));
  return Object.fromEntries(entries);
}

function archive(files) {
  const ordered = Object.fromEntries(Object.keys(files).sort().map((name) => [name, files[name]]));
  return zipSync(ordered, { level: 9, mtime: new Date(2020, 0, 1) });
}

const shared = await readFiles([
  "spotikit.json", manifest.preview, "README.md", "LICENSE.md", "THIRD_PARTY_NOTICES.txt", "tools/export-legacy.js",
]);
const licenses = await readFiles(await filesIn("licenses"));
const sourceDirs = await Promise.all(["src", "data", "deploy", "tools", "tests"].map(filesIn));
const source = await readFiles(["package.json", "package-lock.json", ...sourceDirs.flat()]);

// Include the installed runtime packages used by this build. The compiler and
// test tools are installed separately from the lockfile when rebuilding.
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev) continue;
  const files = await readFiles(await filesIn(directory));
  Object.assign(source, files);
  const name = directory.slice("node_modules/".length)
    .replaceAll("/node_modules/", "--")
    .replaceAll("@", "")
    .replaceAll("/", "-");
  const notices = Object.keys(files).filter((file) =>
    path.posix.dirname(file) === directory && /^(license|copying|notice)(\.(md|txt))?$/i.test(path.posix.basename(file)),
  ).sort();
  if (!notices.length) throw new Error("Missing distribution license for " + directory);
  for (const file of notices) {
    const suffix = notices.length === 1 ? "" : "-" + path.posix.basename(file);
    licenses["licenses/" + name + suffix + ".txt"] = files[file];
  }
}

const sourceZip = archive({ ...shared, ...source, ...licenses });
const licenseText = [
  "LICENSE.md\n\n" + shared["LICENSE.md"].toString(),
  "THIRD_PARTY_NOTICES.txt\n\n" + shared["THIRD_PARTY_NOTICES.txt"].toString(),
  ...Object.keys(licenses).sort().map((name) => name + "\n\n" + licenses[name].toString()),
].join("\n\n");
const sourceUri = "data:application/zip;base64," + Buffer.from(sourceZip).toString("base64");

await build({
  absWorkingDir: root,
  entryPoints: ["src/extension.jsx"],
  outfile: manifest.main,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  jsxFactory: "h",
  jsxFragment: "Fragment",
  loader: { ".css": "text" },
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: "inline",
  banner: { js: [
    "/*! Spicetify Store " + manifest.version + " | Copyright 2026 the Spicetify Store contributors | AGPL-3.0-only for original store code.",
    " * Includes SpotiKit bridge code (NMWplays and contributors, AGPLv3), Spicetify code and data (Spicetify contributors, LGPL v2.1),",
    " * and Spicetify Marketplace exclusion data (Copyright (c) 2021 CharlieS1103 + theRealPadster, MIT). Provided without warranty.",
    " * Full notices and matching buildable source are embedded in this module. Open Spicetify Store > Settings > Licenses and source.",
    " * The source ZIP is also available directly from the embedded ZIP data URL. */",
  ].join("\n") },
  define: {
    __STORE_LICENSE_TEXT__: JSON.stringify(licenseText),
    __STORE_SOURCE_URI__: JSON.stringify(sourceUri),
  },
});

if (process.argv.includes("--pack")) {
  const release = path.join(root, "release");
  const files = {
    ...shared, ...licenses, "source.zip": sourceZip,
    [manifest.main]: await readFile(path.join(root, manifest.main)),
  };
  const packaged = {};
  for (const [name, bytes] of Object.entries(files)) {
    const entry = "spicetify-store/" + name;
    const target = path.join(release, entry);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    packaged[entry] = bytes;
  }
  const target = path.join(release, "spicetify-store-" + manifest.version + ".zip");
  await writeFile(target, archive(packaged));
  console.log(target);
}
