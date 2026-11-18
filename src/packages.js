import { unzipSync } from "fflate";
import { parse, walk } from "css-tree";
import { commit, download, httpsUrl, json, listingKey, MAX_BYTES, normalize, raw, upstream } from "./catalog.js";
import { isSpicyLyrics, spicyLyricsRelease } from "./compat/spicy-lyrics.js";
import { parseSchemes, rewriteCss } from "./compat/styles.js";
import { codeScope, executable, inspectScript } from "./loaders.js";
import { appNames, appSlug, findAppRelease, ReleaseFileRequired } from "./releases.js";
import { decodeText, pathLookup, readText, relativePath } from "./package-files.js";

const encoder = new TextEncoder();
const roles = new Set(["script", "module", "loader", "app", "subfile", "style", "schemes", "asset"]);
const kinds = new Set(["theme", "app", "snippet", "extension"]);
const mimeTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  css: "text/css",
  ico: "image/x-icon",
};
function ext(path) {
  return path.split(/[?#]/)[0].split(".").pop().toLowerCase();
}
export async function sha(text) {
  const bytes = await crypto.subtle.digest("SHA-256", typeof text === "string" ? encoder.encode(text) : text);
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function isVerifiedSpicyLyricsModule(file) {
  return file?.role === "module" && file.path === spicyLyricsRelease.path &&
    typeof file.text === "string" && spicyLyricsRelease.sha256.includes(await sha(file.text));
}
function dataUrl(bytes, mime) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return "data:" + mime + ";base64," + btoa(binary);
}
export function localItem(name, kind, id = crypto.randomUUID()) {
  return { id: "local|" + id, kind, name, description: "", authors: [], source: null, spec: [] };
}
export function validateItem(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.name !== "string" ||
    !item.name ||
    !kinds.has(item.kind)
  )
    throw new Error("Invalid package metadata.");
  if (
    item.id.length > 4096 ||
    item.name.length > 500 ||
    (item.route != null && typeof item.route !== "string")
  )
    throw new Error("Invalid package identity.");
  for (const list of [item.authors, item.dependencies])
    if (
      list != null &&
      (!Array.isArray(list) || list.length > 256 || !list.every((v) => typeof v === "string"))
    )
      throw new Error("Invalid author or dependency list.");
  if (item.description != null && typeof item.description !== "string")
    throw new Error("Invalid package description.");
  if (
    !Array.isArray(item.spec) ||
    !item.spec.every((f) => f && typeof f.path === "string" && typeof f.role === "string")
  )
    throw new Error("Invalid package file list.");
  for (const path of [item.source, item.base, item.preview, item.readme]) if (path) httpsUrl(path);
  if (item.repo && !/^[\w.-]+\/[\w.-]+$/.test(item.repo)) throw new Error("Invalid source repository.");
  return item;
}
export async function makePackage(item, files, revision = "") {
  validateItem(item);
  if (!Array.isArray(files) || !files.length || files.length > 512)
    throw new Error("The package has an invalid file count.");
  let size = 0;
  for (const f of files) {
    if (!f || !roles.has(f.role) || typeof f.path !== "string" || typeof f.text !== "string")
      throw new Error("Invalid package file.");
    if (item.kind === "snippet" && f.role !== "style" && f.role !== "asset")
      throw new Error("A snippet can contain only CSS and assets.");
    size += encoder.encode(f.text).length;
    if (size > MAX_BYTES * 1.5) throw new Error("Package exceeds the size limit.");
    if (f.role === "schemes") parseSchemes(f.text);
    if (
      f.role === "asset" &&
      !/^data:(image\/(png|jpeg|gif|webp|svg\+xml|x-icon)|font\/(woff2?|ttf|otf));base64,/.test(f.text)
    )
      throw new Error("Unsupported package asset.");
  }
  const required = { extension: "script", snippet: "style", theme: "style", app: "app" }[item.kind];
  if (!files.some((f) => required === "script" ? executable(f) : f.role === required))
    throw new Error("The package is missing its " + required + " file.");
  if (!item.spec.length && !item.source)
    item = {
      ...item,
      spec: files.filter((f) => f.role !== "asset").map(({ role, path }) => ({ role, path })),
    };
  const descriptor = [
    item.id,
    item.kind,
    item.route || null,
    item.dependencies || [],
    files.map((f) => [f.role, f.path, f.text]),
  ];
  const digest = await sha(JSON.stringify(descriptor));
  return { item, files, digest, revision, codeScope: codeScope(files) };
}
export function zipApps(bytes) {
  if (bytes.byteLength > MAX_BYTES) throw new Error("ZIP exceeds the download size limit.");
  let total = 0,
    count = 0;
  const seen = new Set();
  const entries = unzipSync(bytes, {
    filter(f) {
      const name = f.name.replaceAll("\\", "/");
      const directory = name.endsWith("/");
      const path = relativePath(directory ? name.slice(0, -1) : name);
      if (directory || path.startsWith("__MACOSX/")) return false;
      if (++count > 512 || seen.has(path))
        throw new Error("Invalid or duplicate ZIP entry.");
      seen.add(path);
      total += f.originalSize;
      if (total > MAX_BYTES) throw new Error("Uncompressed ZIP exceeds the package size limit.");
      return true;
    },
  });
  const files = new Map(), folders = new Set();
  for (const [name, bytes] of Object.entries(entries)) {
    const path = name.replaceAll("\\", "/");
    if (/(^|\/)index\.js$/i.test(path)) folders.add(path.slice(0, -8));
    if (/\.(?:css|m?js|json)$/i.test(path)) files.set(path, { text: decodeText(bytes) });
    else if (mimeTypes[ext(path)]) files.set(path, { asset: dataUrl(bytes, mimeTypes[ext(path)]) });
  }
  const findFolder = pathLookup(folders);
  return [...folders].map((folder) => {
    const texts = new Map(), assets = new Map();
    for (const [name, file] of files) {
      if (findFolder(name.slice(0, folder.length)) !== folder) continue;
      const relative = name.slice(folder.length);
      if (texts.has(relative) || assets.has(relative)) throw new Error("Duplicate app file " + relative + ".");
      if (file.asset !== undefined) assets.set(relative, file.asset);
      else texts.set(relative, file.text);
    }
    const manifestPath = pathLookup(texts)("manifest.json");
    if (manifestPath === null) throw new Error("Ambiguous app file manifest.json.");
    const manifest = manifestPath ? JSON.parse(texts.get(manifestPath)) : {};
    return { folder: folder.split("/").filter(Boolean).pop(), manifest, texts, assets };
  });
}
function appFiles(item, folder, manifest, texts, assets) {
  const files = [];
  const findText = pathLookup(texts);
  function take(role, requested, optional = false) {
    const path = findText(relativePath(requested));
    if (path === null) throw new Error("Ambiguous app file " + requested + ".");
    if (path) files.push({ role, path, text: texts.get(path) });
    else if (!optional) throw new Error("Missing app file " + requested + ".");
  }
  take("app", "index.js");
  for (const path of manifest.subfiles || []) take("subfile", path);
  take("style", "style.css", true);
  for (const path of manifest.subfiles_extension || []) take("script", path);
  if (
    !/\brender\b/.test(
      files
        .filter((f) => ["app", "subfile"].includes(f.role))
        .map((f) => f.text)
        .join("\n"),
    )
  )
    throw new Error("This app needs a built index.js with a render function.");
  for (const [path, text] of assets) files.push({ role: "asset", path, text });
  return makePackage(
    { ...item, route: item.route || folder || item.name, kind: "app" },
    files,
    item.revision,
  );
}
function matchesApp(names, folder, manifest) {
  const declared = [manifest.name, manifest.id].filter((v) => typeof v === "string" && v.trim());
  return declared.length ? declared.some((v) => names.has(appSlug(v))) : names.has(appSlug(folder));
}

export async function fromZip(bytes, name, external, requireMatch = false) {
  const apps = zipApps(bytes);
  const names = external && appNames(external);
  const matches = names ? apps.filter((a) =>
    matchesApp(names, a.folder, a.manifest) || (!requireMatch && names.has(appSlug(a.folder)))) : [];
  const selected = matches.length || requireMatch ? matches : apps;
  if (selected.length !== 1)
    throw new Error(external ? "Could not identify a single built app for " + external.name + " in this ZIP."
      : "Select a ZIP containing a single built app.");
  const app = selected[0],
    item = external || localItem(app.manifest.name || app.folder || name, "app");
  return appFiles(item, app.folder, app.manifest, app.texts, app.assets);
}
async function readLocalPackage(file) {
  if (file.size > MAX_BYTES) throw new Error("File exceeds the size limit.");
  if (ext(file.name) === "zip")
    return fromZip(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/i, ""));
  if (!/\.(?:m?js|css)$/i.test(file.name)) throw new Error("Choose a JavaScript, CSS or built app ZIP file.");
  const kind = ext(file.name) === "css" ? "snippet" : "extension";
  return makePackage(localItem(file.name, kind), [
    { role: kind === "snippet" ? "style" : "script", path: file.name, text: await readText(file) },
  ]);
}
async function fetchedStyles(text, address, signal, budget, visited = new Set()) {
  if (visited.has(address) || visited.size > 8)
    throw new Error("CSS imports form a cycle or are nested too deeply.");
  const chain = new Set([...visited, address]);
  const urls = new Map();
  walk(parse(text, { parseCustomProperty: true }), (node) => {
    if (node.type === "Url") urls.set(node.value, null);
    if (node.type === "Atrule" && node.name === "import" && node.prelude?.children?.first?.type === "String")
      urls.set(node.prelude.children.first.value, null);
  });
  for (const path of urls.keys()) {
    if (!path || /^(?:data:|blob:|#)/i.test(path)) continue;
    const url = httpsUrl(path, address);
    // Keep expressly remote resources remote. Bundle relative companions for offline use.
    if (/^(?:https?:)?\/\//i.test(path)) {
      urls.set(path, url);
      continue;
    }
    let resource = await download(url, { signal, limit: budget.left, optional: true });
    if (
      !resource &&
      !path.replace(/^\.\//, "").includes("/") &&
      /\/user\.css$/i.test(new URL(address).pathname)
    )
      resource = await download(httpsUrl("assets/" + path, address), {
        signal,
        limit: budget.left,
        optional: true,
      });
    if (!resource) throw new Error("Missing stylesheet asset " + path);
    budget.left -= resource.size;
    if (ext(path) === "css") {
      const css = await fetchedStyles(await readText(resource), url, signal, budget, chain);
      urls.set(path, dataUrl(encoder.encode(css), "text/css"));
    } else
      urls.set(
        path,
        dataUrl(
          new Uint8Array(await resource.arrayBuffer()),
          mimeTypes[ext(path)] || "application/octet-stream",
        ),
      );
  }
  return rewriteCss(text, new Map(), "stylesheet", (s) => urls.get(s));
}

async function readReleaseZip(item, release, blob, filename) {
  if (blob.size > MAX_BYTES) throw new Error("Release ZIP exceeds the package size limit.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = "sha256:" + await sha(bytes);
  const asset = release.assets.find((a) =>
    (a.size == null || a.size === bytes.byteLength) && (a.digest ? a.digest === digest : a.name === filename));
  if (!asset) throw new Error("This file does not match the published ZIP for " + item.name + " " + release.tag + ".");
  return fromZip(bytes, asset.name, { ...item, revision: release.tag, releaseAsset: asset.key }, release.shared);
}

export async function packageFromReleaseFile(request, file, signal) {
  signal?.throwIfAborted();
  return captureLoaders(await readReleaseZip(request.item, request.release, file, file.name), signal);
}

async function builtApp(item, apps, original, signal) {
  const repo = item.repo;
  const release = await findAppRelease(item, apps, signal);
  if (release) {
    if (release.assets.length > 1) throw new ReleaseFileRequired(item, release);
    const [asset] = release.assets;
    if (asset.size > MAX_BYTES) throw new Error("Release ZIP exceeds the package size limit.");
    let blob;
    try {
      blob = await download(asset.url, { signal });
    } catch (e) {
      signal?.throwIfAborted();
      throw new ReleaseFileRequired(item, release);
    }
    return readReleaseZip(item, release, blob, asset.name);
  }
  // Older records stored only the tag or the full commit of the branch build.
  if (original.revision && (original.releaseAsset || !/^[a-f\d]{40}$/i.test(original.revision)))
    throw new Error("The publisher no longer lists a release ZIP for " + item.name + ". The installed release is " + original.revision + ".");
  let last;
  const names = appNames(item);
  const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const folders = [...new Set([slug, ...names])].filter(Boolean).map((name) => name + "/").concat("");
  const hints = [item.branch, "dist"].filter(Boolean);
  for (const branch of new Set(hints)) {
    try {
      const ref = await commit(repo, branch, signal);
      for (const folder of folders) {
        const base = raw(repo, ref, folder);
        const index = await download(httpsUrl("index.js", base), { signal, optional: true });
        if (!index) continue;
        const manifest = (await json(httpsUrl("manifest.json", base), { signal, optional: true })) || {};
        if (apps.length > 1 && !matchesApp(names, folder.slice(0, -1), manifest)) continue;
        const texts = new Map([["index.js", await readText(index)]]);
        for (const declared of [
          ...(manifest.subfiles || []),
          ...(manifest.subfiles_extension || []),
          "style.css",
        ]) {
          const path = relativePath(declared);
          const url = raw(repo, ref, folder + path),
            file = await download(url, { signal, optional: path === "style.css" });
          if (file)
            texts.set(
              path,
              path === "style.css"
                ? await fetchedStyles(await readText(file), url, signal, { left: MAX_BYTES })
                : await readText(file),
            );
        }
        return appFiles({ ...item, revision: ref, buildBranch: branch }, folder.slice(0, -1) || slug, manifest, texts, new Map());
      }
    } catch (e) {
      signal?.throwIfAborted();
      last = e;
    }
  }
  throw new Error(
    "No compatible built app could be downloaded. Import its release ZIP." + (last ? " " + last.message : ""),
  );
}

function selectManifestEntry(entries, original, allowRename) {
  const key = listingKey(original);
  const item = entries.findLast((entry) => listingKey(entry) === key);
  if (item) return item;

  if (allowRename) {
    const matches = entries.filter((entry) => entry.id === original.id);
    if (matches.length === 1 && matches[0].branch === original.branch) return matches[0];
  }
  throw new Error("This listing changed or was removed from the source manifest. Refresh the catalog and try again.");
}

async function readPublishedPackage(original, signal, allowRename) {
  let item = validateItem(original);
  const discoverApp = item.kind === "app" && !item.spec.some((f) => f.role === "archive");
  if (discoverApp && !item.repo) throw new Error("Import a built app ZIP for this source.");
  let revision = "",
    base = item.base || item.source;
  if (item.repo) {
    const rootRef = await commit(item.repo, item.manifestBranch || item.branch, signal);
    const manifestUrl = raw(item.repo, rootRef, item.manifestPath || "manifest.json");
    const refreshed = normalize(await json(manifestUrl, { signal }), {
      repo: item.repo,
      branch: item.manifestBranch || item.branch,
      kind: item.kind,
      source: item.source,
      manifestPath: item.manifestPath,
    });
    item = selectManifestEntry(refreshed, item, allowRename);
    if (discoverApp) return builtApp(item, refreshed.filter((entry) => entry.kind === "app"), original, signal);
    revision = item.branch === item.manifestBranch ? rootRef : await commit(item.repo, item.branch, signal);
    base = raw(item.repo, revision, item.manifestPath || "manifest.json");
  } else if (item.id.startsWith("community-snippet|")) {
    const fresh = (await json(upstream + "resources/snippets.json", { signal })).find(
      (s) => "community-snippet|" + s.title === item.id,
    );
    if (!fresh) throw new Error("Snippet no longer exists in the catalog.");
    item = { ...item, spec: [{ role: "style", path: "snippet.css", text: fresh.code }] };
  } else if (
    item.source &&
    /\.json$/i.test(new URL(item.source).pathname) &&
    !item.id.startsWith("local|")
  ) {
    const fresh = normalize(await json(item.source, { signal }), { source: item.source, kind: item.kind });
    item = selectManifestEntry(fresh, item, allowRename);
  }
  let direct;
  if (item.id.startsWith("url|") && item.source) {
    const url = new URL(item.source),
      match =
        url.hostname === "raw.githubusercontent.com" &&
        url.pathname.match(/^\/([^/]+\/[^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/);
    if (match) {
      revision = await commit(match[1], decodeURIComponent(match[2]), signal);
      direct = raw(match[1], revision, match[3].split("/").map(decodeURIComponent).join("/"));
    }
  }
  const budget = { left: MAX_BYTES },
    files = [];
  for (const f of item.spec) {
    const url = direct || httpsUrl(f.path, base);
    const blob =
      typeof f.text === "string" ? new Blob([f.text]) : await download(url, { signal, limit: budget.left });
    budget.left -= blob.size;
    if (budget.left < 0) throw new Error("Package exceeds the size limit.");
    if (f.role === "archive") return fromZip(new Uint8Array(await blob.arrayBuffer()), item.name, item);
    let text = await readText(blob);
    if (f.role === "style") text = await fetchedStyles(text, url, signal, budget);
    files.push({ role: f.role, path: f.path, text });
  }
  return makePackage(item, files, revision);
}

// Only installation and update checks fetch executable payloads. Restoring or
// opening an existing revision always uses its recorded bytes.
async function captureLoaders(pkg, signal) {
  if (!pkg.files.some((f) => executable(f) && inspectScript(f).direct)) return pkg;
  const files = [];
  let remaining = MAX_BYTES - pkg.files.reduce((n, f) => n + encoder.encode(f.text).length, 0);
  for (const original of pkg.files) {
    let file = original;
    const visited = new Set();
    while (executable(file)) {
      const target = inspectScript(file).direct;
      if (!target) break;
      if (visited.has(target.url) || visited.size >= 5) throw new Error("Remote script loader chain is cyclic or too deep.");
      visited.add(target.url);
      // The historical script role infers module mode from .mjs.
      if (!target.module && /\.mjs(?:$|[?#])/i.test(target.url)) break;
      const body = await download(target.url, { signal, limit: remaining });
      remaining -= body.size;
      const child = { role: target.module ? "module" : "script", path: target.url, text: await readText(body) };
      // Blob URLs change the base of import.meta and relative module imports.
      // Keep the original loader when its target needs the original URL.
      if (inspectScript(child).needsOrigin && !inspectScript(child).direct) break;
      files.push({ ...file, role: "loader" });
      file = child;
    }
    files.push(file);
  }
  return files.length === pkg.files.length ? pkg : makePackage(pkg.item, files, pkg.revision);
}

export async function resolvePackage(item, signal, { allowRename = false } = {}) {
  if (isSpicyLyrics(item)) {
    validateItem(item);
    // The official endpoint selects a release at request time. Only store the reviewed one.
    const file = {
      role: "module",
      path: spicyLyricsRelease.path,
      text: await readText(await download(spicyLyricsRelease.download, { signal })),
    };
    if (!(await isVerifiedSpicyLyricsModule(file)))
      throw new Error(`The publisher is no longer serving the verified Spicy Lyrics ${spicyLyricsRelease.version} module.`);
    return makePackage({ ...item, version: spicyLyricsRelease.version }, [file], spicyLyricsRelease.version);
  }
  return captureLoaders(await readPublishedPackage(item, signal, allowRename), signal);
}

export async function localPackage(file, signal) {
  return captureLoaders(await readLocalPackage(file), signal);
}
