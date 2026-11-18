import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { classAliases, parseSchemes, colorCss, rewriteCss } from "../src/compat/styles.js";
import { installPlayer } from "../src/compat/player.js";
import { repoName, normalize, excluded, fromInput, httpsUrl } from "../src/catalog.js";
import { dependencyOrder } from "../src/runtime.js";
import { fromZip, localItem, localPackage, makePackage } from "../src/packages.js";
import { codeScope, inspectScript } from "../src/loaders.js";
import { decodeBackup, validateProfile } from "../src/transfers.js";

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
    pkg = await makePackage(item, [{ role: "script", path: "example.js", text: "void 0" }]);
  const data = {
    version: 1,
    format: "spicetify-store-backup",
    packages: [pkg],
    profiles: [],
    installs: [{ item, selected: pkg.digest, enabled: true }],
  };
  assert.equal((await decodeBackup(data)).installs[0].enabled, false);
  const corrupt = structuredClone(data);
  corrupt.packages[0].files[0].text = "void 1";
  await assert.rejects(decodeBackup(corrupt), /integrity/);
  assert.throws(
    () => validateProfile({ name: "Bad", items: [...data.installs, ...data.installs] }),
    /duplicate/,
  );
});
