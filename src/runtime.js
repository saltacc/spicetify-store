import { createFacade } from "./compat/index.js";
import { isSpicyLyrics } from "./compat/spicy-lyrics.js";
import { colorCss, defaultColors, installAliases, parseSchemes, rewriteCss } from "./compat/styles.js";
import { scopedWindow } from "./compat/window.js";
import { compatibilityModule } from "./compatibility.js";
import { executable, isModuleFile } from "./loaders.js";
import { pathLookup } from "./package-files.js";
import { isVerifiedSpicyLyricsModule } from "./packages.js";

const ledgerKey = Symbol.for("spotikit.spicetify-store.executions");
const reserved = new Set(
  "home search collection playlist album artist show episode track user genre section concert concerts preferences settings marketplace spicetify-store lyrics queue made-for-you browse charts new-releases radio folder station genre-view collection-tracks blend daily-mix fullscreen buddy-feed profile login device devices notifications credits premium download downloads wrapped".split(
    " ",
  ),
);

export function dependencyOrder(installs) {
  const ordered = [],
    errors = new Map(),
    seen = new Set(),
    visiting = new Set();
  function visit(rec) {
    const id = rec.item.id;
    if (seen.has(id)) return;
    if (visiting.has(id)) throw new Error("Dependency cycle at " + rec.item.name);
    visiting.add(id);
    try {
      for (const dep of rec.item.dependencies || []) {
        const matches = installs.filter(
          (r) => r.item.id === dep || r.item.name === dep || r.item.repo === dep,
        );
        if (matches.length !== 1 || !matches[0].enabled)
          throw new Error("Enable the required package " + dep);
        const target = matches[0];
        visit(target);
        if (errors.has(target.item.id)) throw new Error("Dependency unavailable: " + dep);
      }
      ordered.push(rec);
    } catch (e) {
      errors.set(id, e.message);
    }
    visiting.delete(id);
    seen.add(id);
  }
  for (const rec of installs) if (rec.enabled) visit(rec);
  return { ordered, errors };
}

export function createRuntime(host, diagnose) {
  const active = new Map(),
    sources = new Map(),
    globalStops = [];
  const executed = (window[ledgerKey] ||= new Map());
  let api,
    aliases = new Map(),
    closed = false;
  function dispose(stops) {
    for (const stop of stops.splice(0).reverse())
      try {
        stop();
      } catch (e) {
        diagnose(null, e.message);
      }
  }
  function sourceFor(stack) {
    if (document.currentScript?.dataset.spiceToken)
      return sources.get(document.currentScript.dataset.spiceToken);
    const match = String(stack || "").match(/spicetify-store-child\/([a-f\d-]{36})/);
    return match && sources.get(match[1]);
  }
  function own(stop) {
    if (typeof stop !== "function") return;
    const source = sourceFor(new Error().stack);
    if (!source) globalStops.push(stop);
    else if (active.get(source.run.id) === source.run) source.run.stops.push(stop);
    else stop();
  }
  function css(text, id) {
    const el = document.createElement("style");
    el.dataset.spiceOwner = id;
    el.textContent = text;
    (document.body || document.head).append(el);
    return el;
  }
  function init() {
    if (window.Spicetify)
      throw new Error(
        "Another Spicetify runtime is active. Apply SpotiKit 0.9.1 without the old bridge and reload Spotify.",
      );
    aliases = installAliases(host, (stop) => globalStops.push(stop));
    api = createFacade(host, own, (text) => {
      const el = css(text, "compat");
      globalStops.push(() => el.remove());
      return el;
    });
    window.Spicetify = api;
    const colors = css(colorCss(defaultColors(host)), "colors");
    globalStops.push(() => colors.remove());
    const off = host.Palettes?.on?.("change", () => {
      colors.textContent = colorCss(defaultColors(host));
    });
    if (typeof off === "function") globalStops.push(off);
    function failed(event) {
      const source = sourceFor(event.filename || event.reason?.stack || event.error?.stack);
      if (!source) return;
      const message = event.message || event.reason?.message || String(event.reason || "Script error");
      source.failure = message;
      diagnose(source.run.id, message);
    }
    window.addEventListener("error", failed);
    window.addEventListener("unhandledrejection", failed);
    globalStops.push(() => {
      window.removeEventListener("error", failed);
      window.removeEventListener("unhandledrejection", failed);
    });
  }
  function stop(id) {
    const run = active.get(id);
    if (!run) return;
    active.delete(id);
    dispose(run.stops);
    run.styles.forEach((el) => el.remove());
  }
  function blobSource(run, text) {
    const token = crypto.randomUUID(),
      entry = { run, token };
    sources.set(token, entry);
    const body = text + "\n//# sourceURL=spicetify-store-child/" + token + ".js\n";
    entry.url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
    run.stops.push(() => URL.revokeObjectURL(entry.url));
    return entry;
  }
  async function script(run, file) {
    const isModule = isModuleFile(file);
    if (isModule && /\b(?:from\s*|import\s*\(?\s*)["']\.{1,2}\//.test(file.text))
      throw new Error("Bundle relative module imports into one file before installing.");
    const source = blobSource(run, file.text);
    const el = isModule ? null : document.createElement("script");
    executed.set(run.id, run.digest);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el?.remove();
        if (error) reject(new Error(file.path + ": " + error));
        else resolve();
      };
      const timer = setTimeout(() => finish("script loading timed out"), 15000);
      run.stops.push(() => finish("activation stopped"));
      if (isModule) {
        import(source.url).then(() => finish(source.failure), (e) => finish(e?.message || String(e)));
      } else {
        el.async = false;
        el.dataset.spiceToken = source.token;
        el.src = source.url;
        el.onload = () => finish(source.failure);
        el.onerror = () => finish(source.failure || "Spotify could not load this script");
        document.head.append(el);
      }
    });
  }
  function renderStyles(run, pkg, scheme) {
    const assets = new Map(pkg.files.filter((f) => f.role === "asset").map((f) => [f.path, f.text]));
    const findAsset = pathLookup(assets);
    const styles = [];
    for (const file of pkg.files) {
      if (file.role === "schemes") {
        const schemes = parseSchemes(file.text),
          chosen = schemes.get(scheme) || schemes.values().next().value;
        if (!chosen) continue;
        const translated = {};
        for (const [native, legacy] of Object.entries({
          frame: "sidebar",
          background: "main",
          elevated: "card",
          text: "text",
          subtext: "subtext",
          accent: "button",
          divider: "highlight",
        }))
          if (chosen[legacy]) translated[native] = chosen[legacy];
        styles.push(colorCss(chosen) + (host.Themes?.css?.(translated, {}) || ""));
      }
      if (file.role === "style")
        styles.push(
          rewriteCss(file.text, aliases, "stylesheet", (value) => {
            if (!assets.size || /^(?:[a-z]+:|\/\/|#)/i.test(value)) return;
            const key = new URL(value, new URL(file.path, "https://app.invalid/")).pathname.slice(1);
            return assets.get(findAsset(decodeURIComponent(key)));
          }),
        );
    }
    run.styles.forEach((el) => el.remove());
    run.styles = styles.map((text) => css(text, run.id));
    run.scheme = scheme;
  }
  async function app(run, pkg) {
    const { item, files } = pkg;
    const route = String(item.route || item.name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const occupied =
      host.Apps.list().some((a) => a.id === route) ||
      (host._internal?.config?.apps || []).some((a) => a.id === route);
    if (!route || reserved.has(route) || occupied)
      throw new Error("App route /" + route + " is already used by Spotify or SpotiKit.");
    const assets = new Map(files.filter((f) => f.role === "asset").map((f) => [f.path, f.text]));
    const parts = files.filter((f) => ["app", "subfile"].includes(f.role)).map((f) => f.text);
    let source = parts.join("\n;\n");
    if (
      /^\s*(?:import\s+(?!\()|export\s+)|\b(?:import\s*\(\s*["']\.|new\s+(?:Shared)?Worker\s*\()/m.test(
        source,
      )
    )
      throw new Error(
        "This app needs a self-contained classic build. Module imports and workers require an app-specific adapter.",
      );
    if (assets.size) {
      const findAsset = pathLookup(assets);
      source = source.replace(
        /(["'])((?:[./\w -]|\\\\)+\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|otf|ico))\1/gi,
        (match, quote, path) => {
          const actual = findAsset(path.replaceAll("\\\\", "/").replace(/^\.\//, ""));
          return actual ? JSON.stringify(assets.get(actual)) : match;
        },
      );
    }
    const generated = blobSource(
      run,
      source + "\nexport default typeof render === 'function' ? render : null;",
    );
    executed.set(run.id, run.digest);
    const module = await import(generated.url);
    if (closed || active.get(run.id) !== run) throw new Error("App activation stopped.");
    if (typeof module.default !== "function") throw new Error("A classic app must define render().");
    // The host can reuse its route error boundary when navigating between apps.
    // Give each imported app its own boundary, which unmounts when its tab closes.
    const React = host.React;
    class CustomAppPage extends React.Component {
      state = { error: null };
      static getDerivedStateFromError(error) {
        return { error: String(error?.message || error) };
      }
      componentDidCatch() {
        diagnose(null, item.name + " could not open. " + this.state.error);
      }
      render() {
        if (this.state.error === null) return React.createElement(module.default, this.props);
        return React.createElement(
          "section",
          { className: "ss-store", role: "alert" },
          React.createElement("h2", null, item.name + " could not open"),
          React.createElement("p", { className: "ss-error" }, this.state.error),
          React.createElement(
            "div",
            { className: "ss-actions" },
            React.createElement(
              "button",
              { type: "button", onClick: () => host.Apps.open("spicetify-store") },
              "Open Spicetify Store",
            ),
          ),
        );
      }
    }
    const handle = host.Apps.register({ id: route, name: item.name, component: CustomAppPage });
    run.route = handle.id;
    run.stops.push(() => handle.remove());
  }
  return {
    init,
    active,
    executed,
    get api() {
      return api;
    },
    get aliasCount() {
      return aliases.size;
    },
    stop,
    async activate(rec, pkg, compatibilityMode = false) {
      const id = rec.item.id,
        current = active.get(id);
      if (current?.digest === pkg.digest && current.compatibilityMode === compatibilityMode) {
        if (current.scheme !== rec.scheme) renderStyles(current, pkg, rec.scheme);
        return;
      }
      stop(id);
      if (executed.has(id)) return;
      const run = { id, digest: pkg.digest, compatibilityMode, stops: [], styles: [] };
      active.set(id, run);
      try {
        let files = pkg.files.filter(executable);
        if (isSpicyLyrics(rec.item)) {
          const [module] = files;
          if (files.length !== 1 || !(await isVerifiedSpicyLyricsModule(module)))
            throw new Error("Open Updates, check Spicy Lyrics, and apply the compatible version before enabling it.");
          if (!compatibilityMode) throw new Error("Turn on compatibility mode to run Spicy Lyrics on SpotiKit.");
        }
        if (compatibilityMode) {
          const module = compatibilityModule(pkg);
          if (!module) throw new Error("This revision needs a self-contained JavaScript module for compatibility mode.");
          files = [{ ...module, text: scopedWindow(module.text) }];
        }
        if (pkg.item.kind === "app") await app(run, pkg);
        renderStyles(run, pkg, rec.scheme);
        for (const f of files) {
          if (closed || active.get(id) !== run) throw new Error("Activation stopped.");
          await script(run, f);
        }
        run.started = true;
      } catch (e) {
        stop(id);
        throw e;
      }
    },
    order(ids) {
      for (const id of ids)
        for (const style of active.get(id)?.styles || []) (document.body || document.head).append(style);
    },
    configure(records) {
      if (!api) return;
      const enabled = records.filter((r) => r.enabled),
        theme = enabled.find((r) => r.item.kind === "theme");
      Object.assign(api.Config, {
        current_theme: theme?.item.name || "",
        color_scheme: theme?.scheme || "",
        extensions: enabled.flatMap((r) =>
          r.item.spec.filter((f) => f.role === "script").map((f) => f.path.split("/").pop()),
        ),
        custom_apps: enabled.filter((r) => r.item.kind === "app").map((r) => r.item.route || r.item.name),
      });
    },
    close() {
      closed = true;
      for (const id of [...active.keys()]) stop(id);
      dispose(globalStops);
      if (api && window.Spicetify === api) delete window.Spicetify;
      sources.clear();
    },
  };
}
