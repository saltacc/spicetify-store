import storeManifest from "../spotikit.json" with { type: "json" };
import bundledCompatibility from "../data/compatibility.json" with { type: "json" };
import { openLibrary, emptyState } from "./storage.js";
import { catalogPage, download, fromInput, excluded, initialExclusions, json, mergeCatalogItems, upstream } from "./catalog.js";
import { localItem, localPackage, makePackage, packageFromReleaseFile, resolvePackage } from "./packages.js";
import { ReleaseFileRequired } from "./releases.js";
import { parseSchemes } from "./compat/styles.js";
import { compatibilityModule, compatibilityUrl, readCompatibilityRules, retainedCompatibility } from "./compatibility.js";
import { codeScope } from "./loaders.js";
import { createRuntime, dependencyOrder } from "./runtime.js";
import { snapshot, validateProfile, decodeBackup, readLegacy, decodeLegacy } from "./transfers.js";

const prefix = "spotikit:spicetify-store:",
  day = 86400000;
const keyOf = (state, id) => {
  const r = state.installs.find((r) => r.item.id === id);
  if (!r) throw new Error("This item is no longer installed.");
  return r;
};
const enabledTheme = (state) => state.installs.find((r) => r.enabled && r.item.kind === "theme");
function switchTheme(state, rec) {
  if (rec.enabled && rec.item.kind === "theme")
    for (const other of state.installs)
      if (other !== rec && other.item.kind === "theme") other.enabled = false;
}
function describeRevision(rec, pkg) {
  rec.codeScope = pkg.codeScope ?? codeScope(pkg.files);
  rec.compatibilitySupported = !!compatibilityModule(pkg);
  rec.skippedSchemes = [];
  rec.schemes = pkg.files.filter((f) => f.role === "schemes")
    .flatMap((f) => [...parseSchemes(f.text, rec.skippedSchemes).keys()]);
  if (!rec.schemes.includes(rec.scheme)) rec.scheme = rec.schemes[0] || "";
}
function choose(rec, pkg) {
  if (rec.selected !== pkg.digest) {
    rec.previous = rec.selected || null;
    rec.previousScheme = rec.scheme || "";
    rec.selected = pkg.digest;
  }
  rec.item = pkg.item;
  const compatibility = retainedCompatibility(rec);
  if (Object.keys(compatibility).length) rec.compatibility = compatibility;
  else delete rec.compatibility;
  describeRevision(rec, pkg);
}
function starterItems() {
  return [
    [
      "autoSkipExplicit",
      "Auto Skip Explicit",
      "Skip tracks marked explicit. Toggle Christian mode in the profile menu.",
    ],
    ["autoSkipVideo", "Auto Skip Video", "Skip video tracks when they appear in the queue."],
  ].map(([file, name, description]) => {
    const url = "https://raw.githubusercontent.com/spicetify/cli/main/Extensions/" + file + ".js";
    return {
      id: "url|" + url,
      name,
      description,
      kind: "extension",
      authors: ["khanhas"],
      source: url,
      base: url,
      spec: [{ role: "script", path: url }],
    };
  });
}
export class Manager {
  constructor(host, ctx) {
    this.host = host;
    this.ctx = ctx;
    this.state = emptyState();
    this.listeners = new Set();
    this.tasks = Promise.resolve();
    this.rules = initialExclusions;
    this.compatibilityRules = readCompatibilityRules(bundledCompatibility);
    this.errors = new Map();
    this.candidates = new Map();
    this.log = [];
    this.phase = "Opening the library";
    this.paused = false;
    this.closed = false;
    this.runtime = createRuntime(host, (id, msg) => this.diagnose(id, msg));
  }
  notify() {
    if (!this.closed) for (const listener of this.listeners) listener();
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  diagnose(id, message) {
    const text = String(message).slice(0, 1400);
    if (id) this.errors.set(id, text);
    if (this.log.at(-1)?.message !== text || this.log.at(-1)?.id !== id)
      this.log.push({ time: new Date().toISOString(), id, message: text });
    this.log = this.log.slice(-80);
    this.notify();
  }
  async start() {
    try {
      this.db = await openLibrary();
      if (this.closed) {
        this.db.close();
        return;
      }
      this.state = await this.db.state();
      // Older entries predate compatibility and file diagnostics. Derive
      // them from the selected cache, including for disabled and pinned items.
      for (const rec of this.state.installs) {
        if (rec.codeScope && rec.skippedSchemes && typeof rec.compatibilitySupported === "boolean") continue;
        const pkg = await this.db.package(rec.selected);
        if (pkg) {
          try { describeRevision(rec, pkg); } catch (e) { this.diagnose(rec.item.id, e.message); }
        }
      }
      const cached = await this.db.cache("exclusions");
      if (this.closed) return;
      if (Array.isArray(cached?.rules)) this.rules = [...initialExclusions, ...cached.rules];
      const attempts = Number(localStorage.getItem(prefix + "attempts")) || 0;
      this.paused =
        localStorage.getItem(prefix + "paused") === "1" ||
        attempts >= 2 ||
        !!this.host.safeMode ||
        !!this.host.Marketplace?.safeMode;
      if (attempts >= 2) localStorage.setItem(prefix + "paused", "1");
      if (this.paused) {
        this.phase = "Legacy startup is paused";
        this.notify();
        return;
      }
      await this.loadCompatibility();
      if (this.closed) return;
      this.runtime.init();
      if (this.state.installs.some((r) => r.enabled))
        localStorage.setItem(prefix + "attempts", String(attempts + 1));
      this.phase = "Ready";
      this.watchNativeThemes();
      await this.queue(() => this.reconcile());
      if (this.closed) return;
      this.completedBoot = () => localStorage.removeItem(prefix + "attempts");
      window.addEventListener("pagehide", this.completedBoot, { once: true });
      this.bootTimer = setTimeout(this.completedBoot, 4000);
      this.backgroundTimer = setTimeout(
        () => this.background().catch((e) => this.diagnose(null, e.message)),
        1500,
      );
    } catch (e) {
      if (!this.closed) {
        this.phase = e.message;
        this.diagnose(null, e.message);
      }
    }
    this.notify();
  }
  async loadCompatibility() {
    const key = "compatibility-v1";
    try {
      const cached = await this.db.cache(key);
      if (cached) this.compatibilityRules = readCompatibilityRules(cached);
    } catch {
      // Use the bundled list when the saved list is unavailable.
    }
    if (this.closed) return;
    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(2200)]);
    try {
      const blob = await download(compatibilityUrl, { signal, limit: 64 * 1024 });
      const feed = JSON.parse(await blob.text());
      const rules = readCompatibilityRules(feed);
      if (this.closed) return;
      this.compatibilityRules = rules;
      await this.db.putCache(key, feed);
    } catch {
      // Keep the last valid local rules when the service or cache is unavailable.
    }
  }
  queue(fn) {
    const task = this.tasks.then(() => {
      if (this.closed) throw new Error("Store is closed.");
      return fn();
    });
    this.tasks = task.catch(() => {});
    return task;
  }
  async persist(state, packages = [], prune = false) {
    this.ctx.signal.throwIfAborted();
    state.sequence = this.state.sequence + 1;
    await this.db.save(state, packages, prune);
    this.state = state;
    this.notify();
  }
  change(fn) {
    return this.queue(async () => {
      if (!this.db) throw new Error("The library is unavailable.");
      const next = structuredClone(this.state),
        packages = (await fn(next)) || [];
      await this.persist(next, packages, true);
      await this.reconcile();
      this.notify();
    });
  }
  allowed(item) {
    if (excluded(item, this.rules)) throw new Error("The upstream Marketplace excludes this source.");
  }
  async reconcile() {
    if (this.phase !== "Ready" || this.paused || this.closed) return;
    const { ordered, errors } = dependencyOrder(this.state.installs);
    for (const [id, msg] of errors) this.diagnose(id, msg);
    const wanted = new Set(ordered.map((r) => r.item.id));
    for (const id of this.runtime.active.keys()) if (!wanted.has(id)) this.runtime.stop(id);
    this.runtime.configure(this.state.installs);
    const started = new Set();
    for (const rec of ordered) {
      if (this.closed) return;
      const id = rec.item.id;
      try {
        this.allowed(rec.item);
        for (const dep of rec.item.dependencies || []) {
          const target = ordered.find((r) => [r.item.id, r.item.name, r.item.repo].includes(dep));
          if (!target || !started.has(target.item.id)) throw new Error("Dependency must be running: " + dep);
        }
        const pkg = await this.db.package(rec.selected);
        if (!pkg || pkg.item.id !== id) throw new Error("Missing cached files. Reinstall this package.");
        await this.runtime.activate(rec, pkg, this.compatibilityMode(rec));
        if (this.runtime.active.has(id)) started.add(id);
      } catch (e) {
        this.runtime.stop(id);
        this.diagnose(id, e.message);
      }
    }
    await this.syncNativeTheme(started.has(enabledTheme(this.state)?.item.id));
    this.runtime.order(ordered.map((r) => r.item.id));
    this.notify();
  }
  nativeThemes() {
    return Object.entries(this.host.Marketplace?.installed?.() || {})
      .filter(([, rec]) => rec.enabled && (rec.kind || rec.item?.kind) === "theme")
      .map(([id]) => id);
  }
  watchNativeThemes() {
    const changed = () => {
      if (this.closed || this.changingTheme || !this.claimedTheme || !enabledTheme(this.state)) return;
      if (this.host.Themes?.current || this.nativeThemes().length) {
        this.claimedTheme = false;
        this.change((state) => {
          const active = enabledTheme(state);
          if (active) active.enabled = false;
          delete state.previousNative;
        }).catch((e) => this.diagnose(null, e.message));
      }
    };
    this.offThemes = [
      this.host.Themes?.on?.("change", changed),
      this.host.Marketplace?.on?.("installed", changed),
    ];
  }
  async syncNativeTheme(hasTheme) {
    const old = this.state.previousNative;
    if ((hasTheme && this.claimedTheme) || (!hasTheme && !old)) return;
    this.changingTheme = true;
    try {
      if (hasTheme) {
        const local = this.host.Themes?.current,
          market = this.nativeThemes();
        if (!old) await this.persist({ ...this.state, previousNative: { local, market } });
        for (const id of market) await this.host.Marketplace.setEnabled(id, false);
        if (local) this.host.Themes.reset();
        this.claimedTheme = true;
      } else {
        this.claimedTheme = false;
        if (!this.host.Themes?.current && !this.nativeThemes().length) {
          if (old.local?.theme) await this.host.Themes.apply(old.local.theme, old.local.scheme);
          for (const id of old.market || [])
            if (this.host.Marketplace?.installed?.()[id]) await this.host.Marketplace.setEnabled(id, true);
        }
        const next = { ...this.state };
        delete next.previousNative;
        await this.persist(next);
      }
    } finally {
      this.changingTheme = false;
    }
  }
  status(rec) {
    const id = rec.item.id,
      run = this.runtime.active.get(id),
      ran = this.runtime.executed.get(id);
    if (this.errors.has(id) && rec.enabled) return "Failed";
    if (ran && (!run || run.digest !== rec.selected || !rec.enabled)) return "Reload required";
    if (run && !run.started) return "Starting";
    if (run) return rec.codeScope === "runtime" ? "External code unverified" : "Running";
    if (!rec.enabled) return "Disabled";
    return this.phase === "Ready" ? "Waiting" : "Paused";
  }
  get reloadNeeded() {
    return [...this.runtime.executed].some(
      ([id, rev]) =>
        !this.runtime.active.has(id) || this.state.installs.find((r) => r.item.id === id)?.selected !== rev,
    );
  }
  starter() {
    return starterItems().filter((i) => !excluded(i, this.rules));
  }
  async browse(kind, page = 1, refresh = false) {
    const key = kind + "|" + page,
      cached = await this.db?.cache(key);
    const clean = (v) => ({ ...v, items: v.items.filter((i) => !excluded(i, this.rules)) });
    if (!refresh && cached && Date.now() - cached.time < day / 4) return clean(cached);
    try {
      const result = await catalogPage(kind, page, this.ctx.signal);
      const time = Date.now();
      const items = result.items.map((item) => ({ ...item, catalogFetchedAt: time }));
      const entry = { ...result, time, items };
      if (result.partial && cached) {
        entry.items = mergeCatalogItems([...cached.items, ...items]);
      }
      await this.db?.putCache(key, entry);
      return clean(entry);
    } catch (e) {
      if (cached) return clean({ ...cached, warning: e.message + " Showing the saved catalog." });
      throw e;
    }
  }
  async lookup(value) {
    const items = (await fromInput(value, this.ctx.signal)).filter((i) => !excluded(i, this.rules));
    if (!items.length) throw new Error("This source has no supported catalog entries.");
    return mergeCatalogItems(items);
  }
  async saveSource(address) {
    const items = await this.lookup(address);
    const time = Date.now();
    return this.change((s) => {
      const saved = { address: address.trim(), items, time };
      s.sources = [...(s.sources || []).filter((src) => src.address !== saved.address), saved];
    });
  }
  forgetSource(address) {
    return this.change((s) => {
      s.sources = (s.sources || []).filter((src) => src.address !== address);
    });
  }
  sourceItems(kind) {
    return (this.state.sources || []).flatMap((src) =>
      src.items
        .filter((item) => item.kind === kind && !excluded(item, this.rules))
        .map((item) => ({ ...item, catalogFetchedAt: Number.isFinite(src.time) ? src.time : 0 })),
    );
  }
  async install(item) {
    this.allowed(item);
    return this.installPackage(await resolvePackage(item, this.ctx.signal), true, { newOnly: true });
  }
  async installReleaseFile(request, file) {
    this.allowed(request.item);
    return this.installPackage(await packageFromReleaseFile(request, file, this.ctx.signal), true, { newOnly: true });
  }
  async importFile(file) {
    return this.installPackage(await localPackage(file, this.ctx.signal));
  }
  installPackage(pkg, enabled = true, { newOnly = false } = {}) {
    return this.change((state) => {
      this.allowed(pkg.item);
      let rec = state.installs.find((r) => r.item.id === pkg.item.id);
      if (rec && newOnly) throw new Error("This package is already installed. Open Updates to change its revision.");
      if (!rec) {
        rec = { item: pkg.item, enabled, pinned: false, auto: false };
        state.installs.push(rec);
      }
      choose(rec, pkg);
      switchTheme(state, rec);
      this.errors.delete(pkg.item.id);
      return [pkg];
    });
  }
  snippet(name, text, id) {
    if (!name?.trim() || !text?.trim()) throw new Error("Enter a snippet name and CSS.");
    const item = id
      ? { ...keyOf(this.state, id).item, name: name.trim() }
      : localItem(name.trim(), "snippet");
    return makePackage(item, [{ role: "style", path: "snippet.css", text }]).then((pkg) =>
      this.installPackage(pkg),
    );
  }
  enable(id, enabled) {
    return this.change((s) => {
      const rec = keyOf(s, id);
      if (enabled) this.allowed(rec.item);
      rec.enabled = enabled;
      switchTheme(s, rec);
      this.errors.delete(id);
    });
  }
  remove(id) {
    return this.change((s) => {
      s.installs = s.installs.filter((r) => r.item.id !== id);
      this.candidates.delete(id);
      this.errors.delete(id);
    });
  }
  move(id, delta) {
    return this.change((s) => {
      const rec = keyOf(s, id),
        from = s.installs.indexOf(rec),
        to = Math.max(0, Math.min(s.installs.length - 1, from + delta));
      s.installs.splice(from, 1);
      s.installs.splice(to, 0, rec);
    });
  }
  scheme(id, value) {
    return this.change((s) => {
      const r = keyOf(s, id);
      if (!r.schemes.includes(value)) throw new Error("Unknown scheme.");
      r.scheme = value;
    });
  }
  preference(id, field, value) {
    return this.change((s) => {
      if (!["auto", "pinned"].includes(field)) throw new Error("Invalid update preference.");
      keyOf(s, id)[field] = !!value;
    });
  }
  compatibilityMode(rec) {
    return rec.compatibilitySupported === true && (rec.compatibility?.[rec.selected] ??
      (this.compatibilityRules.get(rec.item.id)?.has(rec.selected) === true));
  }
  setCompatibilityMode(id, value) {
    return this.change((s) => {
      const rec = keyOf(s, id);
      if (!rec.compatibilitySupported) throw new Error("Compatibility mode requires a supported JavaScript module.");
      if (value !== null && typeof value !== "boolean") throw new Error("Invalid compatibility setting.");
      const choices = retainedCompatibility(rec);
      if (value === null) delete choices[rec.selected];
      else choices[rec.selected] = value;
      if (Object.keys(choices).length) rec.compatibility = choices;
      else delete rec.compatibility;
      this.errors.delete(id);
    });
  }
  autoCheck(value) {
    return this.change((s) => {
      s.autoCheck = !!value;
    });
  }
  async check(id) {
    const rec = keyOf(this.state, id);
    if (!rec.item.source) return;
    this.allowed(rec.item);
    let candidate;
    try {
      const pkg = await resolvePackage(rec.item, this.ctx.signal, { allowRename: true });
      if (pkg.digest !== rec.selected) candidate = { pkg, from: rec.selected };
    } catch (e) {
      if (!(e instanceof ReleaseFileRequired)) throw e;
      if (!e.includes(rec.item)) candidate = { request: e, from: rec.selected };
    }
    if (this.state.installs.find((r) => r.item.id === id)?.selected !== rec.selected) return false;
    if (candidate) this.candidates.set(id, candidate);
    else this.candidates.delete(id);
    this.notify();
    return !!candidate;
  }
  async checkAll(auto = false) {
    const failures = [];
    for (const rec of this.state.installs.filter((r) => r.item.source)) {
      try {
        if ((await this.check(rec.item.id)) && auto && rec.auto && !rec.pinned && this.candidates.get(rec.item.id)?.pkg)
          await this.update(rec.item.id);
      } catch (e) {
        failures.push(rec.item.name + " — " + e.message);
        this.diagnose(null, failures.at(-1));
      }
    }
    if (failures.length) throw new Error(failures.join("\n"));
  }
  update(id, selectedRelease, file) {
    return this.change(async (s) => {
      const r = keyOf(s, id),
        candidate = this.candidates.get(id);
      if (r.pinned) throw new Error("Unpin this item before updating.");
      if (!candidate || candidate.from !== r.selected) throw new Error("Check for updates again.");
      if (selectedRelease && (selectedRelease.from !== candidate.from || selectedRelease.request.key !== candidate.request?.key))
        throw new Error("The available release changed. Check for updates again.");
      if (candidate.request && !file) throw candidate.request;
      const pkg = candidate.pkg || await packageFromReleaseFile(candidate.request, file, this.ctx.signal);
      this.allowed(pkg.item);
      choose(r, pkg);
      this.candidates.delete(id);
      this.errors.delete(id);
      return [pkg];
    });
  }
  rollback(id) {
    return this.change(async (s) => {
      const r = keyOf(s, id),
        pkg = await this.db.package(r.previous);
      if (!pkg) throw new Error("Previous revision is unavailable.");
      const scheme = r.previousScheme;
      choose(r, pkg);
      if (r.schemes.includes(scheme)) r.scheme = scheme;
      this.errors.delete(id);
      this.candidates.delete(id);
    });
  }
  async background() {
    try {
      const data = await json(upstream + "resources/blacklist.json", { signal: this.ctx.signal });
      if (
        Array.isArray(data?.repos) &&
        data.repos.some((r) => typeof r === "string" && r.startsWith("https://github.com/"))
      ) {
        this.rules = [...initialExclusions, ...data.repos];
        await this.db.putCache("exclusions", { rules: data.repos });
        await this.queue(() => this.reconcile());
      }
    } catch (e) {
      if (!this.closed) this.diagnose(null, "Exclusions refresh: " + e.message);
    }
    if (this.state.autoCheck && !this.closed) await this.checkAll(true);
  }
  saveProfile(name) {
    return this.change((s) => {
      s.profiles.push(snapshot(name, s.installs));
    });
  }
  deleteProfile(id) {
    return this.change((s) => {
      s.profiles = s.profiles.filter((p) => p.id !== id);
    });
  }
  importProfile(data) {
    if (data?.format !== "spicetify-store-profile" || data.version !== 1)
      throw new Error("Unsupported profile file.");
    const p = validateProfile(data.profile);
    return this.change((s) => {
      s.profiles.push({ ...p, id: crypto.randomUUID() });
    });
  }
  applyProfile(id) {
    return this.change(async (s) => {
      const p = s.profiles.find((p) => p.id === id);
      if (!p) throw new Error("Profile not found.");
      const staged = [],
        order = [];
      for (const entry of p.items) {
        this.allowed(entry.item);
        let pkg = await this.db.package(entry.selected);
        if (!pkg && entry.item.source) pkg = await resolvePackage(entry.item, this.ctx.signal, { allowRename: true });
        if (!pkg || pkg.digest !== entry.selected || pkg.item.id !== entry.item.id)
          throw new Error(
            "Exact revision unavailable for " +
              entry.item.name +
              ". Import a backup containing this revision.",
          );
        staged.push(pkg);
        const prior = s.installs.find((r) => r.item.id === entry.item.id);
        const compatibility = { ...prior?.compatibility };
        delete compatibility[entry.selected];
        Object.assign(compatibility, entry.compatibility);
        const rec = { ...prior, ...entry, compatibility,
          selected: prior?.selected, previous: prior?.previous };
        choose(rec, pkg);
        order.push(rec);
      }
      const ids = new Set(order.map((r) => r.item.id));
      s.installs = [
        ...order,
        ...s.installs.filter((r) => !ids.has(r.item.id)).map((r) => ({ ...r, enabled: false })),
      ];
      return staged;
    });
  }
  async backup() {
    return this.queue(async () => {
      const { installs, profiles, autoCheck } = this.state;
      const wanted = new Set(
        [
          ...installs.flatMap((r) => [r.selected, r.previous]),
          ...profiles.flatMap((p) => p.items.map((r) => r.selected)),
        ].filter(Boolean),
      );
      const packages = (await Promise.all([...wanted].map((id) => this.db.package(id)))).filter(Boolean);
      return {
        format: "spicetify-store-backup",
        version: 1,
        installs,
        profiles,
        autoCheck,
        sources: this.state.sources || [],
        packages,
      };
    });
  }
  async importBackup(data) {
    if (data?.format === "spicetify-store-legacy") return this.migrate(data);
    const { packages, installs, profiles, autoCheck, sources } = await decodeBackup(data);
    return this.change((s) => {
      for (const pkg of packages) this.allowed(pkg.item);
      for (const r of installs) {
        if (s.installs.some((i) => i.item.id === r.item.id)) continue;
        describeRevision(r, packages.find((p) => p.digest === r.selected));
        s.installs.push(r);
      }
      for (const p of profiles) if (!s.profiles.some((i) => i.id === p.id)) s.profiles.push(p);
      s.sources = [
        ...(s.sources || []),
        ...sources.filter((src) => !(s.sources || []).some((old) => old.address === src.address)),
      ];
      s.autoCheck = autoCheck;
      return packages;
    });
  }
  async migrate(data) {
    const packages = data ? await decodeLegacy(data) : await readLegacy();
    if (!packages.length)
      throw new Error(
        "No surviving legacy packages were found. A pre-upgrade backup or a fresh import is needed.",
      );
    return this.change((s) => {
      for (const pkg of packages) {
        this.allowed(pkg.item);
        if (s.installs.some((r) => r.item.id === pkg.item.id)) continue;
        const r = { enabled: false, auto: false, pinned: false };
        choose(r, pkg);
        s.installs.push(r);
      }
      return packages;
    });
  }
  setPaused(value) {
    if (value) localStorage.setItem(prefix + "paused", "1");
    else localStorage.removeItem(prefix + "paused");
    localStorage.removeItem(prefix + "attempts");
    location.reload();
  }
  disableAll() {
    return this.change((s) => {
      for (const r of s.installs) r.enabled = false;
    });
  }
  report() {
    return {
      version: storeManifest.version,
      host: this.host.version,
      phase: this.phase,
      aliases: this.runtime.aliasCount,
      capabilities: this.runtime.api?.test?.(),
      installs: this.state.installs.map((r) => ({
        id: r.item.id,
        name: r.item.name,
        selected: r.selected,
        running: this.runtime.active.get(r.item.id)?.digest || this.runtime.executed.get(r.item.id),
        status: this.status(r),
        compatibilityMode: r.compatibilitySupported ? this.compatibilityMode(r) : undefined,
        codeScope: r.codeScope,
        skippedSchemes: r.skippedSchemes,
      })),
      events: this.log,
    };
  }
  close() {
    this.closed = true;
    if (this.completedBoot) {
      window.removeEventListener("pagehide", this.completedBoot);
      this.completedBoot();
    }
    clearTimeout(this.bootTimer);
    clearTimeout(this.backgroundTimer);
    for (const off of this.offThemes || []) if (typeof off === "function") off();
    this.runtime.close();
    this.listeners.clear();
    this.tasks.finally(() => this.db?.close());
  }
}
