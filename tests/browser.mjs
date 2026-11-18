import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync, zipSync, strToU8 } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url)),
  repo = path.resolve(root, "../..");
const pinned = "0b4653f6e6f15efd88119aad96386fb309e81477";
const originals = new Map(),
  cache = path.join(os.tmpdir(), "spicetify-store-qa", pinned);
await mkdir(cache, { recursive: true });
for (const name of ["autoSkipVideo", "autoSkipExplicit"]) {
  const file = name + ".js",
    saved = path.join(cache, file);
  let bytes = await readFile(saved).catch(() => null);
  if (!bytes) {
    const response = await fetch(
      "https://raw.githubusercontent.com/spicetify/cli/" + pinned + "/Extensions/" + file,
    );
    if (!response.ok) throw new Error("Could not fetch upstream fixture " + file);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(saved, bytes);
  }
  const expected = {
    autoSkipVideo: "9deaf65617d0a23d6facd2fb4535d0eb46ebc471a7796612cc7c5b52c5564079",
    autoSkipExplicit: "bdad05b93baab59a9624c097b0e2ce4a73ae33b20fde6f7bf604917dd1f3b3fb",
  };
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected[name]);
  originals.set(file, bytes);
  console.log(file, createHash("sha256").update(bytes).digest("hex"));
}
const files = {
  "/react.js": [path.join(root, "node_modules/react/umd/react.production.min.js"), "text/javascript"],
  "/react-dom.js": [
    path.join(root, "node_modules/react-dom/umd/react-dom.production.min.js"),
    "text/javascript",
  ],
  "/host.js": [path.join(root, "tests/host.js"), "text/javascript"],
  "/bars.js": [path.join(repo, "Framework/api/08-bars.js"), "text/javascript"],
  "/loader.js": [path.join(repo, "Framework/api/10-apps.js"), "text/javascript"],
  "/spotikit/extensions/spicetify-store/dist/extension.js": [
    path.join(root, "dist/extension.js"),
    "text/javascript",
  ],
  "/spotikit/extensions/spicetify-store/spotikit.json": [
    path.join(root, "spotikit.json"),
    "application/json",
  ],
};
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  if (name === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#191918;color:#fff;font:14px system-ui}#bar{padding:7px 16px;background:#121212}#bar button{color:#eee;background:#353432;border:0;border-radius:15px;padding:6px 12px}</style><div id="bar"></div>' +
      '<div class="main-view-panel"><div class="main-view-container__scroll-node"><main id="root"></main></div></div>' +
      '<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/host.js"></script><script src="/loader.js"></script>',
    );
    return;
  }
  if (!files[name]) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader("Content-Type", files[name][1]);
    res.end(await readFile(files[name][0]));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
  } catch (e) {
    if (process.env.CHROME_PATH || !e.message.includes("Executable doesn't exist")) throw e;
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const context = await browser.newContext({ viewport: { width: 1060, height: 750 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));
  let offline = false,
    revision = 1,
    failUpdate = false;
  const textCss = "body{--ss-fixture:yes}";
  const url = "https://fixtures.example.test/fixture.js";
  await context.route(/^https:/, async (route) => {
    if (offline) {
      await route.abort();
      return;
    }
    const u = new URL(route.request().url()),
      name = u.pathname.split("/").pop();
    const options = { headers: { "access-control-allow-origin": "*" } };
    if (u.pathname === "/repos/spicetify/cli/commits/main")
      await route.fulfill({ ...options, json: { sha: pinned } });
    else if (originals.has(name))
      await route.fulfill({ ...options, body: originals.get(name), contentType: "text/javascript" });
    else if (u.href === url)
      await route.fulfill({ ...options, contentType: "text/javascript",
        body: 'const s=document.createElement("script");s.src="https://fixtures.example.test/payload.js";document.head.appendChild(s);' });
    else if (name === "opaque.mjs")
      await route.fulfill({ ...options, contentType: "text/javascript",
        body: 'const address="https://fixtures.example.test/missing-feature.mjs";import(address).catch(() => {});' });
    else if (name === "payload.js")
      await route.fulfill({
        ...options,
        status: failUpdate ? 503 : 200,
        body: "window.fixtureRevision=" + revision,
        contentType: "text/javascript",
      });
    else if (u.pathname.endsWith("/theme.json"))
      await route.fulfill({
        ...options,
        json: { name: "Test palette", usercss: "user.css", schemes: "color.ini" },
      });
    else if (name === "user.css") await route.fulfill({ ...options, body: textCss, contentType: "text/css" });
    else if (name === "color.ini")
      await route.fulfill({ ...options, body:
        "[Rose]\nbutton=fc9d90\n[Unavailable]\ntext=${ENV}\n[Mint]\nmain=00000000\nbutton=${xrdb:green:40d5aa}" });
    else if (name === "blacklist.json")
      await route.fulfill({ ...options, json: { repos: ["https://github.com/sample/excluded"] } });
    else if (name === "repositories")
      await route.fulfill({ ...options, json: { total_count: 0, items: [] } });
    else await route.fulfill({ ...options, status: 404, body: "" });
  });
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Store sections" })
      .getByRole("button", { name: new RegExp("^" + name) })
      .click();
  const dialog = () => page.getByRole("dialog");
  async function ready() {
    await page.waitForFunction(() => window.qa?.ready === true);
    await page.getByRole("heading", { name: "Spicetify Store", exact: true }).waitFor();
    assert.ok(
      await page.evaluate(() => !!window.Spicetify?.Player),
      "Facade did not start: " + (await page.locator("body").innerText()),
    );
  }
  async function installURL(value, display, kind = "extension") {
    await nav("Browse");
    await button("Import package").click();
    await dialog().getByLabel("Package source").fill(value);
    await button("Find packages", dialog()).click();
    await dialog()
      .getByRole("button", { name: new RegExp(display) })
      .click();
    await button("Install " + kind, dialog()).click();
    await dialog().waitFor({ state: "hidden" });
  }
  async function installStarter(name) {
    await nav("Browse");
    await page.getByRole("button", { name: new RegExp("^" + name) }).click();
    await button("Install extension", dialog()).click();
    await dialog().waitFor({ state: "hidden" });
  }
  async function local(name, body, type = "text/javascript") {
    await nav("Browse");
    await button("Import package").click();
    await dialog()
      .getByLabel("Install local file")
      .setInputFiles({ name, mimeType: type, buffer: Buffer.from(body) });
    await dialog().waitFor({ state: "hidden" });
  }
  const state = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("spotikit-spicetify-store");
          req.onsuccess = () => {
            const db = req.result,
              r = db.transaction("state").objectStore("state").get("library");
            r.onsuccess = () => {
              db.close();
              resolve(r.result);
            };
            r.onerror = () => reject(r.error);
          };
        }),
    );
  await page.goto(base);
  await ready();
  await page.evaluate(() => {
    const scene = document.createElement("section");
    scene.id = "legacy-fixture";
    scene.innerHTML = '<div class="app-layout"><div class="global-nav-bar-search-area"></div>' +
      '<div class="now-playing-bar-left"><div class="now-playing-widget-v2-cover"></div>' +
      '<div class="now-playing-widget-v2-info"></div></div><div class="now-playing-bar-center">' +
      '<span class="playback-position"></span><span class="playback-duration"></span></div>' +
      '<div class="now-playing-bar-extra-controls"></div></div><div class="your-library-row"><div>' +
      '<div class="your-library-row-item"><div role="button" id="library-action"></div></div></div></div>';
    document.body.append(scene);
    const style = document.createElement("style");
    style.textContent = ".Root__top-container .main-nowPlayingBar-extraControls { --audit-controls: verified }";
    scene.append(style);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".now-playing-bar-extra-controls"))
    .getPropertyValue("--audit-controls").trim() === "verified");
  await page.waitForFunction(() => !!document.querySelector(".custom-navlinks-scrollable_container div[role=presentation]"));
  assert.ok(await page.evaluate(() => {
    const grid = document.querySelector(".Root__top-container");
    return grid.querySelector(".main-nowPlayingBar-left .main-coverSlotCollapsed-container") &&
      grid.querySelector(".main-nowPlayingWidget-trackInfo") &&
      grid.querySelector(".main-nowPlayingBar-center .playback-bar__progress-time-elapsed") &&
      grid.querySelector(".main-playbackBarRemainingTime-container") &&
      document.querySelector(".main-yourLibraryX-listItem > div:not(:has([data-skip-in-keyboard-nav])) > div:first-child")?.id === "library-action" &&
      !!grid.querySelector("div.main-nowPlayingBar-extraControls");
  }));
  await page.evaluate(() => {
    const cover = document.querySelector(".main-coverSlotCollapsed-container");
    const tip = Spicetify.Tippy(cover, { ...Spicetify.TippyProps, delay: 0,
      onShow(instance) { instance.setProps({ placement: "right", popperOptions: { modifiers: [{ name: "flip", enabled: false }] } }); } });
    const custom = document.createElement("span");
    custom.textContent = "Track source tooltip";
    tip.popper.querySelector(".main-contextMenu-tippy").appendChild(custom);
    window.qa.tip = tip;
    cover.dispatchEvent(new MouseEvent("mouseenter"));
  });
  await page.getByRole("tooltip").getByText("Track source tooltip").waitFor();
  await page.waitForFunction(() => qa.tip.popper.getAttribute("data-popper-placement") === "right");
  await page.evaluate(() => qa.tip.hide());
  await page.waitForFunction(() => !qa.tip.popper.isConnected);
  assert.ok(await page.evaluate(() => {
    qa.tip.setContent("<b>Plain</b>");
    const box = qa.tip.popper.querySelector('[role="tooltip"]');
    const plain = !box.firstElementChild;
    qa.tip.setProps({ allowHTML: true });
    const html = box.firstElementChild?.tagName === "B";
    qa.tip.destroy();
    return plain && html && qa.tip.state.isDestroyed;
  }));
  await page.evaluate(() => {
    SpotiKit.Icons = { has() { return false; } };
    SpotiKit._internal.trackRemove = (value) => value;
    SpotiKit.Tooltip = { attach() { return { setContent() {}, hide() {}, remove() { qa.nativeTipRemoved = true; } }; } };
  });
  await page.addScriptTag({ url: base + "/bars.js" });
  assert.ok(await page.evaluate(() => {
    const button = new Spicetify.Playbar.Button("First", "", () => {});
    button.label = "Second";
    const singleTip = button.element._tippy === button.tippy && button.tippy.props.content === "Second";
    button.deregister();
    button.register();
    const registered = button.element.isConnected;
    button.deregister();
    return qa.nativeTipRemoved && singleTip && registered && !button.element.isConnected;
  }));
  await page.evaluate(() => document.querySelector("#legacy-fixture").remove());
  console.log("PASS legacy player and navigation mounts, native toolbar lifecycle, tooltip DOM and placement");
  await installStarter("Auto Skip Video");
  await installStarter("Auto Skip Explicit");
  const behavior = await page.evaluate(() => {
    const q = window.qa,
      menu = q.menus.get("Christian mode");
    if (!menu) throw new Error("Missing upstream profile menu");
    menu.onSelect();
    q.track({ is_explicit: "true" });
    q.track({ "media.type": "video" });
    q.track({ "media.type": "video", is_advertisement: "true" });
    return [q.next, localStorage.getItem("ChristianMode")];
  });
  assert.deepEqual(behavior, [2, "1"]);
  console.log(
    "PASS two unchanged upstream scripts, menu toggle, track events, skip and advertisement exception",
  );
  await nav("Installed");
  if (process.env.SPICE_SCREENSHOT) {
    await mkdir(path.dirname(process.env.SPICE_SCREENSHOT), { recursive: true });
    await page.screenshot({ path: process.env.SPICE_SCREENSHOT });
  }
  const row = (name) =>
    page.locator("article").filter({ has: page.getByRole("button", { name, exact: true }) });
  await button("Disable", row("Auto Skip Video")).click();
  await button("Enable", row("Auto Skip Video")).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => {
      qa.track({ "media.type": "video" });
      return qa.next;
    }),
    2,
  );
  await button("Enable", row("Auto Skip Video")).click();
  await page.getByText("Extension · Reload required", { exact: true }).first().waitFor();
  await button("Disable", row("Auto Skip Video")).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  offline = true;
  await page.reload();
  await ready();
  assert.deepEqual(
    await page.evaluate(() => {
      qa.track({ is_explicit: "true" });
      qa.track({ "media.type": "video" });
      return [qa.next, qa.menus.size];
    }),
    [2, 1],
  );
  offline = false;
  console.log("PASS cleanup, single execution and fully offline cached restart");
  await installURL(url, "fixture.js");
  assert.equal(await page.evaluate(() => window.fixtureRevision), 1);
  assert.equal((await state()).installs.find((r) => r.item.name === "fixture.js").codeScope, "captured");
  await nav("Updates");
  let updateRow = page.locator("article").filter({ hasText: "fixture.js" });
  revision = 2;
  failUpdate = true;
  await button("Check", updateRow).click();
  await page.getByRole("alert").filter({ hasText: "503" }).waitFor();
  failUpdate = false;
  const old = (await state()).installs.find((r) => r.item.name === "fixture.js").selected;
  await button("Check", updateRow).click();
  await button("Update", updateRow).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  await updateRow.getByLabel("Pin revision").click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("article button")).some(
      (b) => b.textContent === "Update" && b.disabled,
    ),
  );
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  offline = true;
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => window.fixtureRevision), 1);
  await nav("Updates");
  assert.ok(await updateRow.getByLabel("Pin revision").isChecked());
  offline = false;
  await button("Check", updateRow).click();
  await button("Update", updateRow).waitFor();
  await updateRow.getByLabel("Pin revision").click();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  await button("Update", updateRow).click();
  await button("Roll back", updateRow).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureRevision), 1);
  const newer = (await state()).installs.find((r) => r.item.name === "fixture.js");
  assert.equal(newer.previous, old);
  assert.notEqual(newer.selected, old);
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => window.fixtureRevision), 2);
  await nav("Updates");
  await button("Roll back", updateRow).click();
  await page.getByText("Previous revision selected.").waitFor();
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => window.fixtureRevision), 1);
  console.log("PASS failed update preservation, pin, staged revision, reload and rollback");
  await page.evaluate(() => SpotiKit.Themes.apply("native-previous", "dark"));
  await installURL("https://fixtures.example.test/theme.json", "Test palette", "theme");
  assert.equal(await page.evaluate(() => SpotiKit.Themes.current), null);
  await nav("Installed");
  await row("Test palette").getByLabel("Color scheme").selectOption("Mint");
  assert.deepEqual(await row("Test palette").locator("option").allTextContents(), ["Rose", "Mint"]);
  await button("Test palette", row("Test palette")).click();
  await dialog().getByText("Unsupported color for text in Unavailable").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue("--spice-button").trim() === "#40d5aa",
  );
  await page.evaluate(() => SpotiKit.Themes.apply("later-selection", "blue"));
  await button("Enable", row("Test palette")).waitFor();
  assert.equal(await page.evaluate(() => SpotiKit.Themes.current?.theme), "later-selection");
  await button("Enable", row("Test palette")).click();
  await button("Disable", row("Test palette")).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  await button("Disable", row("Test palette")).click();
  await button("Enable", row("Test palette")).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => SpotiKit.Themes.current?.theme), "later-selection");
  await button("Enable", row("Test palette")).click();
  await button("Disable", row("Test palette")).waitFor();
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  await button("Create snippet").click();
  await dialog().getByLabel("Name", { exact: true }).fill("My snippet");
  await dialog().getByLabel("CSS", { exact: true }).fill("body{--ss-local:active}");
  await button("Save snippet", dialog()).click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--ss-local")),
    "active",
  );
  const appZip = zipSync({
    "qa-app/index.js": strToU8(`function render() {
      if (Spicetify.Platform.History.location.pathname === "/qa-app/broken")
        throw new Error("App render fixture failed");
      const viewport = document.querySelector(".Root__main-view .main-view-container__scroll-node");
      if (!viewport) throw new Error("Missing main scroll container");
      return Spicetify.ReactDOM.createPortal(
        Spicetify.React.createElement("p", null, label()),
        viewport
      );
    }`),
    "qa-app/sub.js": strToU8("function label(){return 'The classic app mounted';}"),
    "qa-app/side.js": strToU8("window.qaAppSide=(window.qaAppSide || 0)+1;"),
    "qa-app/manifest.json": strToU8(
      JSON.stringify({ name: "QA App", subfiles: ["sub.js"], subfiles_extension: ["side.js"] }),
    ),
  });
  await local("qa-app.zip", appZip, "application/zip");
  await nav("Installed");
  await button("Open app", row("QA App")).click();
  const portal = page.locator(".main-view-container__scroll-node > p").filter({ hasText: "The classic app mounted" });
  await portal.waitFor();
  assert.ok(await page.evaluate(() => {
    const copy = { ...Spicetify.ReactDOM };
    return copy.createPortal === SpotiKit.ReactDOM.createPortal &&
      copy.createRoot === SpotiKit.ReactDOM.createRoot;
  }));
  assert.equal(await page.evaluate(() => window.qaAppSide), 1);
  await page.evaluate(() => SpotiKit.Navigation.go("/qa-app/nested"));
  await portal.waitFor();
  await page.evaluate(() => {
    SpotiKit.Apps.register({
      id: "marketplace", name: "Marketplace", button: false,
      component: () => SpotiKit.React.createElement("h1", null, "Native marketplace fixture"),
    });
    SpotiKit.Navigation.go("/qa-app/broken");
  });
  await page.getByRole("alert").getByText("App render fixture failed", { exact: true }).waitFor();
  await portal.waitFor({ state: "detached" });
  await page.evaluate(() => SpotiKit.Apps.open("marketplace"));
  await page.getByRole("heading", { name: "Native marketplace fixture" }).waitFor();
  await page.evaluate(() => SpotiKit.Apps.open("qa-app"));
  await portal.waitFor();
  await page.evaluate(() => SpotiKit.Navigation.go("/qa-app/broken"));
  await button("Open Spicetify Store").click();
  await page.getByRole("heading", { name: "Spicetify Store", exact: true }).waitFor();
  await nav("Profiles");
  await page.getByLabel("Profile name").fill("Listening");
  await button("Save current setup").click();
  await page.getByText("Profile saved.", { exact: true }).waitFor();
  await nav("Settings");
  const getBackup = page.waitForEvent("download");
  await button("Export backup").click();
  const backup = JSON.parse(await readFile(await (await getBackup).path(), "utf8"));
  assert.equal(backup.packages.length, 7);
  await button("Disable all packages").click();
  await button("Disable all", dialog()).click();
  await dialog().waitFor({ state: "hidden" });
  assert.ok((await state()).installs.every((r) => !r.enabled));
  await nav("Profiles");
  await button("Apply profile").click();
  await button("Apply and enable", dialog()).click();
  await dialog().waitFor({ state: "hidden" });
  assert.ok((await state()).installs.every((r) => r.enabled));
  console.log("PASS theme scheme, editable CSS, built ZIP app, nested route, profile switch and backup");
  await installURL("https://fixtures.example.test/opaque.mjs", "opaque.mjs");
  await nav("Installed");
  await row("opaque.mjs").getByText(/External code unverified/).waitFor();
  await nav("Updates");
  await page.locator("article").filter({ hasText: "opaque.mjs" }).getByLabel("Pin stored files only").click();
  await page.waitForFunction(() => [...document.querySelectorAll("article")].find(
    (el) => el.textContent.includes("opaque.mjs"))?.querySelector('input[type="checkbox"]')?.checked);
  await page.getByText("Working…", { exact: true }).waitFor({ state: "hidden" });
  const previous = (await state()).installs.find((r) => r.item.name === "opaque.mjs");
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("spotikit-spicetify-store");
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction("state", "readwrite"), store = tx.objectStore("state");
        const req = store.get("library");
        req.onsuccess = () => {
          const library = req.result, record = library.installs.find((r) => r.item.name === "opaque.mjs");
          delete record.codeScope;
          delete record.skippedSchemes;
          store.put(library, "library");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await ready();
  await nav("Installed");
  await row("opaque.mjs").getByText(/External code unverified/).waitFor();
  await nav("Updates");
  assert.ok(await page.locator("article").filter({ hasText: "opaque.mjs" }).getByLabel("Pin stored files only").isChecked());
  assert.equal((await state()).installs.find((r) => r.item.name === "opaque.mjs").selected, previous.selected);
  console.log("PASS opaque provider failure, stored-file pin, and offline metadata migration for an existing revision");
  await local("failing.js", "throw new Error('child fixture failed')");
  await nav("Installed");
  await row("failing.js")
    .getByText(/child fixture failed/)
    .waitFor();
  assert.equal(await page.evaluate(() => SpotiKit.Apps.list().some((a) => a.id === "spicetify-store")), true);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("qa-interrupted") === "1") {
      localStorage.setItem("spotikit:spicetify-store:attempts", "2");
      sessionStorage.removeItem("qa-interrupted");
    }
  });
  await page.evaluate(() => sessionStorage.setItem("qa-interrupted", "1"));
  await page.reload();
  await page.getByText("Legacy startup is paused").first().waitFor();
  assert.equal(await page.evaluate(() => typeof window.Spicetify), "undefined");
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + "/?conflict");
  await page
    .getByText(/Another Spicetify runtime is active/)
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => window.Spicetify.foreign), true);
  await page.goto(base + "/?safe");
  await page.waitForFunction(() => qa.ready);
  assert.equal(await page.evaluate(() => SpotiKit.Apps.list().length), 0);
  const fresh = await browser.newContext(),
    restore = await fresh.newPage();
  await fresh.route(/^https:/, (route) => route.abort());
  await restore.goto(base);
  await restore.getByRole("heading", { name: "Spicetify Store", exact: true }).waitFor();
  const rnav = (name) =>
    restore
      .getByRole("navigation")
      .getByRole("button", { name: new RegExp("^" + name) })
      .click();
  await rnav("Settings");
  // A Marketplace install receives just the built module. This fixture serves
  // neither the source ZIP nor the license files, and remote requests are offline.
  const version = JSON.parse(await readFile(path.join(root, "spotikit.json"), "utf8")).version;
  async function downloadFromSettings(label, suffix) {
    const [download] = await Promise.all([
      restore.waitForEvent("download"),
      restore.getByRole("button", { name: label, exact: true }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "spicetify-store-" + version + suffix);
    return readFile(await download.path());
  }
  const notices = (await downloadFromSettings("Download licenses", "-licenses.txt")).toString();
  const source = unzipSync(await downloadFromSettings("Download source", "-source.zip"));
  for (const name of [
    "LICENSE.md", "THIRD_PARTY_NOTICES.txt", "licenses/Spicetify-LGPL-2.1.txt",
    "licenses/SpotiKit-AGPL-3.0.txt", "licenses/Spicetify-Marketplace-MIT.txt",
    "src/compat/tooltips.js", "data/icons.json.license", "data/cssMap.json.license", "data/exclusions.json.license",
    "package-lock.json", "tools/build.mjs", "node_modules/tippy.js/headless/dist/tippy-headless.esm.js",
  ]) {
    assert.ok(source[name], "Missing from the delivered source: " + name);
    assert.deepEqual(Buffer.from(source[name]), await readFile(path.join(root, name)), name);
  }
  for (const [name, bytes] of Object.entries(source)) {
    if (name.startsWith("licenses/") || name === "THIRD_PARTY_NOTICES.txt" || name === "LICENSE.md") {
      assert.ok(notices.includes(Buffer.from(bytes).toString()), "Missing from notices: " + name);
    }
  }
  console.log("PASS offline single-file install provides full licenses and the matching source");
  await restore
    .getByLabel("Import backup")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await restore.getByText("Backup merged. New packages are disabled.", { exact: true }).waitFor();
  await rnav("Installed");
  assert.equal(await restore.getByText(/ · Disabled$/).count(), 6);
  assert.equal(await restore.evaluate(() => typeof window.fixtureRevision), "undefined");
  await rnav("Profiles");
  await restore.getByRole("button", { name: "Apply profile" }).click();
  await restore.getByRole("button", { name: "Apply and enable" }).click();
  await restore.getByText("Profile applied.", { exact: true }).waitFor();
  assert.equal(await restore.evaluate(() => window.fixtureRevision), 1);
  const legacy = {
    format: "spicetify-store-legacy",
    version: 1,
    installs: [
      {
        id: "old/test",
        record: { kind: "extension", item: { name: "Recovered legacy item", origin: "spicetify" } },
        files: [{ role: "main", url: "old.js", text: "window.legacyFlag=true;" }],
      },
    ],
  };
  await rnav("Settings");
  await restore
    .getByLabel("Import backup")
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacy)),
    });
  await restore.getByText("Backup merged. New packages are disabled.", { exact: true }).waitFor();
  await rnav("Installed");
  await restore.getByRole("button", { name: "Recovered legacy item", exact: true }).waitFor();
  assert.equal(await restore.evaluate(() => typeof window.legacyFlag), "undefined");
  await fresh.close();
  console.log(
    "PASS fresh-profile offline backup restore, explicit activation, and pre-upgrade export import",
  );
  assert.deepEqual(
    jsErrors.filter((e) => !e.includes("child fixture failed")),
    [],
  );
  console.log(
    "PASS isolated failure, interrupted boot recovery, existing runtime conflict and native safe mode",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  server.close();
}
