import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { classAliases, parseSchemes, colorCss, rewriteCss } from "../src/compat/styles.js";
import { installPlayer } from "../src/compat/player.js";
import { spicyLyricsRelease } from "../src/compat/spicy-lyrics.js";
import { scopedWindow } from "../src/compat/window.js";
import { compatibilityModule, readCompatibilityRules } from "../src/compatibility.js";
import { repoName, normalize, excluded, excludedFromListings, fromInput, httpsUrl, mergeCatalogItems } from "../src/catalog.js";
import { dependencyOrder } from "../src/runtime.js";
import { fromZip, localItem, localPackage, makePackage, resolvePackage } from "../src/packages.js";
import { codeScope, inspectScript } from "../src/loaders.js";
import { decodeBackup, validateProfile } from "../src/transfers.js";

test("a scoped module sees the live Store API through its own window binding", () => {
  const page = {
    Spicetify: {},
    document: {},
    matchMedia() {
      assert.equal(this, page);
      return { matches: true };
    },
  };
  const host = {};
  Object.defineProperty(page, "SpotiKit", { value: host });
  const source = `
    const detected = Object.getOwnPropertyNames(window).some(k => k.toLowerCase() === "spotikit");
    window.SpicyLyrics = { scoped: !detected };
    return {
      detectsHost: detected || "SpotiKit" in window,
      sameAPI: window.Spicetify === globalThis.Spicetify,
      sameDocument: window.document === globalThis.document,
      matches: window.matchMedia("(min-width: 1px)").matches,
    };`;
  const run = new Function("globalThis", scopedWindow(source));
  assert.deepEqual(run(page), { detectsHost: false, sameAPI: true, sameDocument: true, matches: true });
  assert.equal(page.SpotiKit, host);
  assert.deepEqual(page.SpicyLyrics, { scoped: true });
});

test("compatibility rules match exact revisions and require a supported module", () => {
  const item = localItem("Compatibility fixture", "extension", "compatibility-fixture");
  const digest = "a".repeat(64);
  const feed = { version: 1, extensions: [{ id: item.id, revisions: [digest] }] };
  const rules = readCompatibilityRules(feed);
  assert.equal(rules.get(item.id).has(digest), true);
  assert.equal(rules.get(item.id).has("b".repeat(64)), false);
  assert.throws(() => readCompatibilityRules({ ...feed, version: 2 }), /Invalid compatibility list/);
  assert.throws(() => readCompatibilityRules({ version: 1, extensions: [{ id: item.id, revisions: ["latest"] }] }), /Invalid compatibility entry/);

  const file = { role: "script", path: "compatibility.mjs", text: "export const foo = window.fetch;" };
  const check = (overrides) => compatibilityModule({ item, files: [{ ...file, ...overrides }] });
  assert.deepEqual(check(), file);
  assert.equal(check({ path: "compatibility.js" }), null);
  assert.equal(check({ text: "import('https://fixtures.example.test/child.mjs');" }), null);
  assert.equal(check({ text: "export const window = {};" }), null);
});

test("Spicy Lyrics download rejects a module that differs from the reviewed release", async (t) => {
  const [item] = normalize({ name: "Spicy Lyrics", main: "./builds/spicy-lyrics.mjs" }, {
    repo: "Spikerko/spicy-lyrics", branch: "main", source: "https://github.com/Spikerko/spicy-lyrics",
  });
  const request = t.mock.method(globalThis, "fetch", async () => new Response("export default 'different release';"));
  await assert.rejects(resolvePackage(item), /no longer serving the verified Spicy Lyrics 6\.5\.10 module/);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(request.mock.calls[0].arguments[0], spicyLyricsRelease.download);
});

test("Player.data distinguishes player initialization from an empty playback update", async () => {
  const listeners = new Map();
  const hostPlayer = {
    state: null,
    on(type, listener) {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
  };
  const api = {}, stops = [];
  const origin = { _state: null };
  let signalReady;
  installPlayer({
    api,
    SpotiKit: { Player: hostPlayer, Navigation: { on: () => () => {} } },
    P: { PlayerAPI: origin },
    internal: {
      waitFor(check) {
        return new Promise((resolve) => {
          signalReady = () => { assert.ok(check()); resolve(); };
        });
      },
    },
    own: (stop) => stops.push(stop),
    lazyValue() {},
  });

  assert.equal(api.Player.data, undefined);
  // On desktop this notification initializes the native player, before Spicetify subscribes.
  origin._state = { item: null };
  listeners.get("state")?.(null);
  assert.equal(api.Player.data, undefined);
  signalReady();
  await Promise.resolve();

  const playing = { item: { uri: "spotify:track:fixture" }, isPaused: false };
  hostPlayer.state = playing;
  assert.equal(api.Player.data, playing);

  const seen = [];
  api.Player.addEventListener("onplaypause", (event) => seen.push([event.data, api.Player.data]));
  const paused = { ...playing, isPaused: true };
  for (const state of [paused, null, playing]) {
    hostPlayer.state = state;
    listeners.get("state")(state);
    listeners.get("playpause")(state);
  }
  assert.deepEqual(seen, [[paused, paused], [null, null], [playing, playing]]);
  for (const stop of stops.reverse()) stop();
  assert.equal(listeners.size, 0);
});

test("multi-entry manifests preserve branch, file order and distinct identities", () => {
  const source = { repo: "a/b", branch: "main", source: "https://github.com/a/b" };
  const [script, theme] = normalize(
    [
      { name: "Tool", main: "tool.js" },
      {
        name: "Colors",
        usercss: "theme.css",
        schemes: "color.ini",
        include: ["one.js", "two.js"],
        branch: "dist",
      },
    ],
    source,
  );
  assert.equal(script.kind, "extension");
  assert.equal(theme.kind, "theme");
  assert.deepEqual(
    theme.spec.map((f) => f.path),
    ["theme.css", "color.ini", "one.js", "two.js"],
  );
  assert.equal(theme.manifestBranch, "main");
  assert.match(theme.base, /\/dist\/manifest.json$/);
  assert.notEqual(script.id, theme.id);
});
test("listing exclusions are per entry and use the newest copy of its manifest metadata", () => {
  const source = { repo: "a/b", branch: "main", source: "https://github.com/a/b" };
  const [hidden, sibling, malformed] = normalize([
    { name: "Tool", main: "tool.js", excludeFromListings: ["spotikit", 1, "other-client"] },
    { name: "Other tool", main: "other.js", excludeFromListings: ["other-client"] },
    { name: "Another tool", main: "another.js", excludeFromListings: "spotikit" },
  ], source);
  assert.deepEqual(hidden.excludeFromListings, ["spotikit", "other-client"]);
  assert.deepEqual([hidden, sibling, malformed].map(excludedFromListings), [true, false, false]);
  const visible = { ...hidden, excludeFromListings: [] };
  const catalog = { ...hidden, catalogFetchedAt: 20 };
  assert.deepEqual(mergeCatalogItems([catalog, { ...visible, catalogFetchedAt: 10 }]), [catalog]);
  const refreshed = { ...visible, catalogFetchedAt: 30 };
  assert.deepEqual(mergeCatalogItems([refreshed, catalog]), [refreshed]);
});
test("catalog variants share an installed package ID and resolve the selected manifest entry", async (t) => {
  const source = { repo: "a/b", branch: "main", source: "https://github.com/a/b" };
  const regular = { name: "Tool", main: "tool.js" };
  const historical = { ...regular, name: "Tool (Historical)", branch: "historical" };
  const localized = { ...regular, name: "Outil" };
  const cards = normalize([regular, historical, localized], source);
  assert.equal(new Set(cards.map((item) => item.id)).size, 1);
  assert.deepEqual(mergeCatalogItems([...cards, ...cards]), cards);

  const older = cards.map((item) => ({ ...item, catalogFetchedAt: 1 }));
  const refreshed = { ...cards[0], catalogFetchedAt: 2 };
  assert.deepEqual(mergeCatalogItems([...older, refreshed]), [refreshed]);

  const [main, history] = ["a".repeat(40), "b".repeat(40)];
  let manifest = [localized, regular, historical];
  t.mock.method(globalThis, "fetch", async (url) => {
    switch (url) {
      case "https://api.github.com/repos/a/b/commits/main": return Response.json({ sha: main });
      case "https://api.github.com/repos/a/b/commits/historical": return Response.json({ sha: history });
      case `https://raw.githubusercontent.com/a/b/${main}/manifest.json`: return Response.json(manifest);
      case `https://raw.githubusercontent.com/a/b/${main}/tool.js`: return new Response('"regular";');
      case `https://raw.githubusercontent.com/a/b/${history}/tool.js`: return new Response('"historical";');
      default: throw new Error("Unexpected request: " + url);
    }
  });
  const [recent, olderBranch, translation] = await Promise.all(cards.map((item) => resolvePackage(item)));
  assert.deepEqual([recent, olderBranch, translation].map((pkg) => pkg.item.name), ["Tool", "Tool (Historical)", "Outil"]);
  assert.deepEqual([recent, olderBranch, translation].map((pkg) => pkg.revision), [main, history, main]);
  assert.equal(olderBranch.files[0].text, '"historical";');
  assert.equal(recent.digest, translation.digest);

  manifest = [{ ...regular, name: "Renamed Tool" }];
  await assert.rejects(resolvePackage(cards[0]), /listing changed or was removed/);
  await assert.rejects(resolvePackage(cards[1], undefined, { allowRename: true }), /listing changed or was removed/);
  const renamed = await resolvePackage(cards[0], undefined, { allowRename: true });
  assert.equal(renamed.item.name, "Renamed Tool");
  assert.equal(renamed.digest, recent.digest);
});
test("direct repository and file imports respect sources and wildcard exclusions", async () => {
  assert.equal(repoName(" https://github.com/a/b.git "), "a/b");
  assert.equal(repoName("../b"), null);
  assert.throws(() => httpsUrl("http://example.com"));
  assert.throws(() => httpsUrl("https://someone@example.com/file"));
  const [item] = await fromInput("https://github.com/a/b/blob/main/custom.js");
  assert.equal(item.base, "https://raw.githubusercontent.com/a/b/main/custom.js");
  assert.equal(excluded(item, ["https://github.com/a/*"]), true);
  assert.equal(excluded(item, ["https://github.com/not-a/*"]), false);
});
test("translate class selectors and real asset tokens without changing data or text", () => {
  const aliases = classAliases(
    { x: "new", z: "newer", k: "other" },
    { x: "old", z: "ambiguous", k: "ambiguous" },
  );
  assert.deepEqual([...aliases], [["old", "new"]]);
  const input = '.old:hover,[title=".old"] { background: url("asset.png"); content: ".old"; }';
  const out = rewriteCss(input, aliases, "stylesheet", (v) => (v === "asset.png" ? "x.png" : null));
  assert.match(out, /\.new:hover/);
  assert.match(out, /\[title="\.old"\]/);
  assert.match(out, /url\(x.png\)/);
  assert.match(out, /content: ".old"/);
});
test("INI schemes generate both color formats and reject unresolved colors", () => {
  const colors = parseSchemes("[A]\ntext=abc\nbutton = 0, 128, 255\n[B]\nmain=000000");
  assert.equal(colors.size, 2);
  assert.match(colorCss(colors.get("A")), /--spice-rgb-button:0,128,255/);
  assert.throws(() => parseSchemes("[A]\ntext=\${env:COLOR}"), /Unsupported color/);
});
test("cross-build aliases require the stable target and respect an exact native mapping", () => {
  const aliases = classAliases({ root: "app-layout", bar: "now-playing-bar-extra-controls" }, {});
  assert.equal(aliases.get("Root__top-container"), "app-layout");
  assert.equal(aliases.has("main-nowPlayingBar-left"), false);
  assert.equal(rewriteCss("div.main-nowPlayingBar-extraControls", aliases, "selectorList"),
    "div.now-playing-bar-extra-controls");
  assert.equal(classAliases({ root: "app-layout", x: "other-grid" }, { x: "Root__top-container" })
    .get("Root__top-container"), "other-grid");
  const windows = classAliases({ xwwlUJUZLpjPnZByq04Y: "track-list-row", ofahUhwV8VMlglXFA3hw: "entity-card" });
  assert.equal(rewriteCss(".main-card-card .main-trackList-trackListRow:hover", windows, "selectorList"),
    ".entity-card .track-list-row:hover");
  assert.equal(classAliases({}).has("main-card-card"), false);
  assert.equal(classAliases({ card: "entity-card", old: "another-card" }, { old: "main-card-card" })
    .get("main-card-card"), "another-card");
});
test("palettes isolate unusable sections and honor RGB and Xresources literals", () => {
  const skipped = [];
  const palettes = parseSchemes([
    "[First]", "main=12345678 ; alpha", "[Invalid]", "main=${CUSTOM}", "button=fff",
    "[wal16]", "text=${xrdb:color15:FFFFFF}", "main=${xrdb:color0:0, 64, 255}", "[Last]", "main=00000000",
  ].join("\n"), skipped);
  assert.deepEqual([...palettes.keys()], ["First", "wal16", "Last"]);
  assert.deepEqual(skipped, ["Unsupported color for main in Invalid"]);
  assert.equal(palettes.get("First").main, "#123456");
  assert.match(colorCss(palettes.get("wal16")), /--spice-rgb-main:0,64,255/);
  assert.equal(palettes.get("Last").main, "#000000");
  assert.throws(() => parseSchemes("[Bad]\nmain=\n"), /main in Bad/);
});
test("loader inspection distinguishes executable loads from text, API fetches and extra side effects", () => {
  const script = (text) => ({ role: "script", path: "test.js", text });
  const pages = "https://example.test/feature.js";
  const classic = 'function load(src) { const el=document.createElement("script"); el.src=src; ' +
    'el.defer=true; el.type="text/javascript"; document.getElementsByTagName("head")[0].appendChild(el); }' +
    'load("' + pages + '");';
  assert.deepEqual(inspectScript(script(classic)).direct, { url: pages, module: false });
  assert.equal(inspectScript(script(classic + "window.started=true;")).direct, undefined);
  assert.equal(codeScope([script(classic + "window.started=true;")]), "runtime");
  assert.equal(codeScope([script('/* import("https://invalid.tld/x") */ fetch("https://example.test/data");')]), "package");
  assert.equal(inspectScript(script('import("./local.mjs")')).needsOrigin, true);
  assert.equal(inspectScript(script('import(url)')).needsOrigin, true);
  assert.equal(inspectScript(script('import("https://example.test/a.js", { with: { type: "json" } })')).direct, undefined);
});
test("remote module revisions include executable bytes and restore without a network request", async (t) => {
  let body = 'export const version = 1';
  const transport = t.mock.method(globalThis, "fetch", async () => new Response(body));
  const wrapper = new File(['import(`https://example.test/feature.js?t=${Date.now()}`)'], "wrapper.mjs");
  const pkg = await localPackage(wrapper);
  assert.equal(pkg.codeScope, "captured");
  assert.deepEqual(pkg.files.map((f) => f.role), ["loader", "module"]);
  assert.equal(pkg.files[1].path, "https://example.test/feature.js");
  const changed = await makePackage(pkg.item, [pkg.files[0], { ...pkg.files[1], text: "export const version = 2" }]);
  assert.notEqual(pkg.digest, changed.digest);
  const backup = { format: "spicetify-store-backup", version: 1, packages: [pkg], installs: [], profiles: [] };
  assert.equal((await decodeBackup(backup)).packages[0].digest, pkg.digest);
  assert.equal(transport.mock.callCount(), 1);
  body = 'import data from "./child.js";';
  const relative = await localPackage(wrapper);
  assert.equal(relative.codeScope, "runtime");
  assert.deepEqual(relative.files.map((f) => f.role), ["script"]);
  body = 'import("https://example.test/feature.js")';
  await assert.rejects(localPackage(wrapper), /cyclic/);
});
test("dependency ordering is deterministic and isolates failures", () => {
  const r = (id, dependencies = []) => ({ enabled: true, item: { id, name: id, dependencies } });
  const { ordered, errors } = dependencyOrder([
    r("Z", ["A"]),
    r("X", ["Y"]),
    r("Y", ["X"]),
    r("A"),
    r("B"),
    r("C", ["missing"]),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.item.id),
    ["A", "Z", "B"],
  );
  assert.deepEqual([...errors.keys()].sort(), ["C", "X", "Y"]);
});
test("app ZIP validates paths, sidecars and one built entry", async () => {
  const zip = zipSync({
    "demo/index.js": strToU8("function render(){return sub();}"),
    "demo/sub.js": strToU8("function sub(){return null;}"),
    "demo/helper.js": strToU8("void 0"),
    "demo/manifest.json": strToU8(
      JSON.stringify({ name: "Demo", subfiles: ["sub.js"], subfiles_extension: ["helper.js"] }),
    ),
  });
  const pkg = await fromZip(zip, "demo");
  assert.deepEqual(
    pkg.files.map((f) => f.role),
    ["app", "subfile", "script"],
  );
  assert.equal(pkg.item.route, "demo");
  await assert.rejects(fromZip(zipSync({ "../index.js": strToU8("bad") }), "bad"), /Invalid/);
});
test("Windows app ZIPs preserve declared order, original filenames and BOM-marked text", async () => {
  const manifest = { name: "Mélodie", subfiles: ["Ui\\B.js", "Ui/A.js"], subfiles_extension: ["HELPER.JS"] };
  const zip = zipSync({
    "demo\\": new Uint8Array(),
    "demo\\INDEX.JS": Buffer.from("\ufefffunction render(){return label();}\r\n", "utf16le"),
    "Demo\\MANIFEST.JSON": Buffer.from("\ufeff" + JSON.stringify(manifest), "utf16le"),
    "DEMO/ui/b.js": strToU8("\ufeffconst note = '音';"),
    "demo\\UI\\A.JS": Buffer.from("\ufefffunction label(){return note;}", "utf16le").swap16(),
    "demo\\Style.CSS": strToU8("p { color: red }"),
    "demo\\Helper.js": strToU8("void 0"),
    "demo\\Assets\\Cover.PNG": Uint8Array.of(1, 2, 3),
    "__MACOSX\\other\\index.js": strToU8("ignored"),
  });
  const pkg = await fromZip(zip, "local");
  assert.equal(pkg.item.name, "Mélodie");
  assert.deepEqual(pkg.files.map((f) => [f.role, f.path]), [
    ["app", "INDEX.JS"], ["subfile", "ui/b.js"], ["subfile", "UI/A.JS"], ["style", "Style.CSS"],
    ["script", "Helper.js"], ["asset", "Assets/Cover.PNG"],
  ]);
  assert.equal(pkg.files[0].text, "function render(){return label();}\r\n");
  assert.equal(pkg.files[1].text, "const note = '音';");
  assert.equal(pkg.files[2].text, "function label(){return note;}");
  assert.equal(pkg.files.at(-1).text, "data:image/png;base64,AQID");
  const css = "body { --label: '音' }";
  const local = await localPackage(new File([Buffer.from("\ufeff" + css, "utf16le")], "snippet.CSS"));
  assert.equal(local.files[0].text, css);
});
test("ZIP lookup preserves case-sensitive siblings and refuses ambiguous or duplicate files", async () => {
  const index = strToU8("function render(){return null;}");
  const files = { "demo/index.js": index, "demo/UI.js": strToU8("upper"), "demo/ui.js": strToU8("lower") };
  const pack = (path) => zipSync({ ...files, "demo/manifest.json": strToU8(JSON.stringify({ subfiles: [path] })) });
  assert.equal((await fromZip(pack("UI.js"), "app")).files[1].text, "upper");
  assert.equal((await fromZip(pack("ui.js"), "app")).files[1].text, "lower");
  await assert.rejects(fromZip(pack("Ui.Js"), "app"), /Ambiguous app file/);
  await assert.rejects(fromZip(zipSync({ ...files, "demo\\UI.js": strToU8("duplicate") }), "app"), /duplicate/);
  await assert.rejects(fromZip(zipSync({ ...files, "Demo/UI.js": strToU8("duplicate") }), "app"), /Duplicate/);
  const siblings = zipSync({
    "one/index.js": index, "one/manifest.json": strToU8('{"name":"First","subfiles":["ui.js"]}'),
    "one/ui.js": strToU8("first"), "ONE/index.js": index,
    "ONE/manifest.json": strToU8('{"name":"Second","subfiles":["ui.js"]}'), "ONE/ui.js": strToU8("second"),
  });
  const second = await fromZip(siblings, "apps", localItem("Second", "app"), true);
  assert.equal(second.files[1].text, "second");
});
test("backup verification is atomic, detects changed bytes and disables imported scripts", async () => {
  const item = localItem("Example", "extension", "demo"),
    pkg = await makePackage(item, [{ role: "script", path: "example.mjs", text: "void 0" }]);
  const compatibility = { [pkg.digest]: false };
  const data = {
    version: 1,
    format: "spicetify-store-backup",
    packages: [pkg],
    profiles: [],
    installs: [{ item, selected: pkg.digest, enabled: true, compatibility }],
  };
  const [restored] = (await decodeBackup(data)).installs;
  assert.equal(restored.enabled, false);
  assert.deepEqual(restored.compatibility, compatibility);
  assert.deepEqual(validateProfile({ name: "Saved", items: data.installs }).items[0].compatibility, compatibility);
  const corrupt = structuredClone(data);
  corrupt.packages[0].files[0].text = "void 1";
  await assert.rejects(decodeBackup(corrupt), /integrity/);
  assert.throws(
    () => validateProfile({ name: "Bad", items: [...data.installs, ...data.installs] }),
    /duplicate/,
  );
});
