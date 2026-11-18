import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { normalize } from "../src/catalog.js";
import { packageFromReleaseFile, resolvePackage, sha } from "../src/packages.js";
import { findAppRelease, ReleaseFileRequired } from "../src/releases.js";

const repo = "publisher/apps";
const ref = "a".repeat(40);
const source = { repo, branch: "main", kind: "app", source: "https://github.com/" + repo };
const manifest = [
  { name: "Statistics", readme: "stats/README.md" },
  { name: "Library", readme: "library/README.md" },
];
const apps = normalize(manifest, source);
const [stats, library] = apps;
const api = "https://api.github.com/repos/" + repo;
const raw = "https://raw.githubusercontent.com/" + repo + "/" + ref + "/";
const archiveFor = (app) => zipSync({
  [app + "/index.js"]: strToU8("function render() { return null; }"),
  [app + "/manifest.json"]: strToU8(JSON.stringify({ name: app === "stats" ? "Statistics" : "Library" })),
});
const bytes = archiveFor("stats");
const name = "spicetify-stats.release.zip";
const asset = { id: 23, name, size: bytes.byteLength, digest: "sha256:" + await sha(bytes),
  browser_download_url: "https://github.com/" + repo + "/releases/download/stats-v2/" + name };
const release = { tag_name: "stats-v2", assets: [asset] };
const sibling = { tag_name: "library-v9", assets: [{ ...asset, id: 29, name: "library.zip" }] };

test("blocked current release stays selected and a verified local file upgrades the same catalog app", async (t) => {
  const history = [];
  let blocked = true;
  t.mock.method(globalThis, "fetch", async (url) => {
    history.push(url);
    if (url === api + "/commits/main") return Response.json({ sha: ref });
    if (url === raw + "manifest.json") return Response.json(manifest);
    if (url === api + "/releases?per_page=30&page=1") return Response.json([
      sibling, release, { tag_name: "stats-v1", assets: [{ ...asset, browser_download_url: "https://example.test/old.zip" }] },
    ]);
    if (url === asset.browser_download_url) {
      if (blocked) throw new TypeError("Failed to fetch");
      return new Response(bytes);
    }
    throw new Error("Unexpected request: " + url);
  });
  // The branch installer used the catalog display name for the saved route.
  const old = { ...stats, route: "statistics", revision: ref };
  let request;
  await assert.rejects(resolvePackage(old), (e) => {
    assert.ok(e instanceof ReleaseFileRequired);
    assert.equal(e.release.tag, release.tag_name);
    assert.deepEqual(e.release.assets.map((a) => a.url), [asset.browser_download_url]);
    request = e;
    return true;
  });
  assert.deepEqual(history, [api + "/commits/main", raw + "manifest.json", api + "/releases?per_page=30&page=1", asset.browser_download_url]);
  const corrupted = bytes.slice();
  corrupted[0] ^= 1;
  await assert.rejects(packageFromReleaseFile(request, new File([corrupted], name)), /does not match/);
  const pkg = await packageFromReleaseFile(request, new File([bytes], "renamed.zip"));
  assert.equal(pkg.item.id, old.id);
  assert.equal(pkg.item.route, "stats");
  assert.equal(pkg.revision, release.tag_name);
  assert.ok(request.includes(pkg.item));
  blocked = false;
  assert.deepEqual(await resolvePackage(old), pkg);
});

test("release discovery follows pages, distinguishes siblings and ignores drafts", async (t) => {
  const pages = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const n = Number(new URL(url).searchParams.get("page")); pages.push(n);
    return Response.json(n === 1 ? Array(30).fill(sibling) : [{ ...release, draft: true }, release]);
  });
  assert.equal((await findAppRelease(stats, apps)).tag, "stats-v2");
  assert.deepEqual(pages, [1, 2]);
  assert.equal((await findAppRelease(library, apps)).tag, "library-v9");
});

test("an unfinished upload cannot expose an older release as the current build", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([
    { tag_name: "stats-v3", assets: [{ ...asset, state: "open" }] }, release,
  ]));
  await assert.rejects(findAppRelease(stats, apps), /stats-v3 is still being uploaded/);
});

test("branch-only apps still load and a shared root cannot supply its sibling", async (t) => {
  let rootName = "Library";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === api + "/commits/main") return Response.json({ sha: ref });
    if (url === raw + "manifest.json") return Response.json(manifest);
    if (url.startsWith(api + "/releases?")) return Response.json([]);
    const distRef = "b".repeat(40);
    const root = "https://raw.githubusercontent.com/" + repo + "/" + distRef + "/";
    if (url === api + "/commits/dist") return Response.json({ sha: distRef });
    if (url === root + "index.js") return new Response("function render() { return null; }");
    if (url === root + "manifest.json") return Response.json({ name: rootName });
    return new Response(null, { status: 404 });
  });
  await assert.rejects(resolvePackage(stats), /No compatible built app/);
  rootName = "Statistics";
  const pkg = await resolvePackage(stats);
  assert.equal(pkg.item.id, stats.id);
  assert.equal(pkg.revision, "b".repeat(40));
  await assert.rejects(resolvePackage({ ...stats, revision: "stats-v2" }), /no longer lists a release ZIP/);
});

test("a shared release ZIP with another app's manifest is rejected", async (t) => {
  const other = archiveFor("library");
  const wrongAsset = { ...asset, digest: null, size: other.byteLength };
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === api + "/commits/main") return Response.json({ sha: ref });
    if (url === raw + "manifest.json") return Response.json(manifest);
    if (url.startsWith(api + "/releases?")) return Response.json([{ ...release, assets: [wrongAsset] }]);
    if (url === asset.browser_download_url) return new Response(other);
    throw new Error("Unexpected request: " + url);
  });
  await assert.rejects(resolvePackage(stats), /identify a single built app for Statistics/);
});
