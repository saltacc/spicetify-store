import { parse, walk, generate, ident } from "css-tree";
import cssMap from "../../data/cssMap.json" with { type: "json" };
import { installLayoutMounts, unmappedWindowsClasses } from "./layout.js";

const known = {
  "Root__main-view": "main-view-panel",
  "Root__top-container": "app-layout",
  "main-trackList-trackListRow": "track-list-row",
  "main-card-card": "entity-card",
  "main-nowPlayingBar-left": "now-playing-bar-left",
  "main-nowPlayingBar-center": "now-playing-bar-center",
  "main-nowPlayingBar-extraControls": "now-playing-bar-extra-controls",
  "main-playbackBarRemainingTime-container": "playback-duration",
  "playback-bar__progress-time-elapsed": "playback-position",
  "main-trackCreditsModal-container": "track-credits-modal",
  "main-trackCreditsModal-header": "track-credits-modal-header",
  "main-trackCreditsModal-closeBtn": "track-credits-modal-close",
  "main-trackCreditsModal-mainSection": "track-credits-modal-body",
  "x-toggle-wrapper": "toggle-switch",
  "x-toggle-input": "toggle-switch-input",
  "x-toggle-indicatorWrapper": "toggle-switch-track",
  "x-toggle-indicator": "toggle-switch-thumb",
};

export function classAliases(hostMap, dictionary = cssMap) {
  const names = new Set(Object.values(hostMap));
  const aliases = new Map();
  const ambiguous = new Set();
  for (const [key, legacy] of Object.entries(dictionary)) {
    const stable = hostMap[key];
    if (!stable || names.has(legacy) || hostMap[legacy]) continue;
    if (aliases.has(legacy) && aliases.get(legacy) !== stable) ambiguous.add(legacy);
    aliases.set(legacy, stable);
  }
  for (const key of ambiguous) aliases.delete(key);
  for (const [key, stable] of Object.entries(known))
    if (names.has(stable) && !names.has(key) && !hostMap[key] && !aliases.has(key) && !ambiguous.has(key))
      aliases.set(key, stable);
  return aliases;
}

// Edit token spans in the source so comments, whitespace and unsupported CSS stay intact.
export function rewriteCss(source, aliases, context = "stylesheet", assetUrl) {
  if (!source || (!aliases.size && !assetUrl)) return source;
  const changes = [];
  try {
    const ast = parse(source, { context, positions: true, parseCustomProperty: true });
    walk(ast, (node) => {
      if (node.type === "ClassSelector" && aliases.has(ident.decode(node.name))) {
        changes.push([
          node.loc.start.offset,
          node.loc.end.offset,
          "." + ident.encode(aliases.get(ident.decode(node.name))),
        ]);
      } else if (node.type === "Url" && assetUrl) {
        const value = assetUrl(node.value);
        if (value && value !== node.value)
          changes.push([node.loc.start.offset, node.loc.end.offset, generate({ type: "Url", value })]);
      } else if (node.type === "Atrule" && node.name === "import" && assetUrl) {
        const first = node.prelude?.children?.first;
        if (first?.type === "String") {
          const value = assetUrl(first.value);
          if (value && value !== first.value)
            changes.push([first.loc.start.offset, first.loc.end.offset, JSON.stringify(value)]);
        }
      }
    });
  } catch {
    return source;
  }
  let result = source;
  for (const [start, end, by] of changes.reverse()) result = result.slice(0, start) + by + result.slice(end);
  return result;
}

export function installAliases(host, onStop) {
  const aliases = classAliases(host.classMap || {});
  const windowsLayout = unmappedWindowsClasses(host);
  if (windowsLayout) {
    for (const key of ["main-trackList-trackListRow", "main-card-card"]) aliases.set(key, windowsLayout[key]);
  }
  const windows = new WeakSet();
  const cache = new Map();
  const mapNames = (s) =>
    typeof s === "string" ? s.replace(/[^\s]+/g, (token) => aliases.get(token) || token) : s;
  function maybeLegacy(value) {
    if (value.includes("\\")) return true;
    for (const match of value.matchAll(/\.([\w-]+)/g)) if (aliases.has(match[1])) return true;
    return false;
  }
  function selector(value) {
    if (typeof value !== "string" || !value.includes(".")) return value;
    if (!cache.has(value)) {
      if (cache.size > 2048) cache.clear();
      cache.set(value, maybeLegacy(value) ? rewriteCss(value, aliases, "selectorList") : value);
    }
    return cache.get(value);
  }
  function attach(win) {
    if (!win || windows.has(win)) return;
    windows.add(win);
    installLayoutMounts(win, host.classMap || {}, aliases, onStop);
    if (!aliases.size) return;
    function method(proto, name, adapt) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (!descriptor?.value || !descriptor.configurable) return;
      const wrap = function (...args) {
        return descriptor.value.apply(this, adapt(args));
      };
      Object.defineProperty(proto, name, { ...descriptor, value: wrap });
      onStop(() => {
        if (proto[name] === wrap) Object.defineProperty(proto, name, descriptor);
      });
    }
    for (const proto of [win.Element.prototype, win.Document.prototype, win.DocumentFragment.prototype]) {
      for (const name of ["querySelector", "querySelectorAll", "matches", "closest"])
        method(proto, name, (args) => [selector(args[0]), ...args.slice(1)]);
      method(proto, "getElementsByClassName", (args) => [mapNames(args[0])]);
    }
    for (const name of ["add", "remove", "replace", "toggle", "contains"])
      method(win.DOMTokenList.prototype, name, (args) => args.map((t) => aliases.get(t) || t));
    method(win.Element.prototype, "setAttribute", (args) =>
      String(args[0]).toLowerCase() === "class" ? [args[0], mapNames(args[1])] : args,
    );
    const proto = win.Element.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "className");
    if (d?.configurable && d.set) {
      const set = function (value) {
        d.set.call(this, mapNames(value));
      };
      Object.defineProperty(proto, "className", { ...d, set });
      onStop(() => {
        if (Object.getOwnPropertyDescriptor(proto, "className")?.set === set)
          Object.defineProperty(proto, "className", d);
      });
    }
    method(win.CSSStyleSheet.prototype, "insertRule", (args) =>
      typeof args[0] === "string" && maybeLegacy(args[0])
        ? [rewriteCss(args[0], aliases), ...args.slice(1)]
        : args,
    );
    const changed = new Map();
    function visit(style) {
      const css = style.textContent;
      if (changed.get(style)?.after === css || !maybeLegacy(css)) return;
      const after = rewriteCss(css, aliases);
      if (css !== after) {
        changed.set(style, { before: css, after });
        style.textContent = after;
      }
    }
    const inspect = (el) => {
      if (el?.localName === "style") visit(el);
      else if (el?.nodeType === 1) for (const style of el.querySelectorAll("style")) visit(style);
    };
    const observer = new win.MutationObserver((records) => {
      for (const record of records) {
        if (record.target.nodeType === 3) inspect(record.target.parentElement);
        else if (record.target.localName === "style") visit(record.target);
        else for (const el of record.addedNodes) inspect(el);
        for (const el of record.removedNodes)
          if (el.localName === "style" && !el.isConnected) changed.delete(el);
      }
    });
    observer.observe(win.document.documentElement, { subtree: true, childList: true, characterData: true });
    onStop(() => {
      observer.disconnect();
      for (const [style, { before, after }] of changed)
        if (style.textContent === after) style.textContent = before;
    });
  }
  attach(window);
  const pip = window.documentPictureInPicture;
  const enter = (e) => attach(e.window);
  if (pip) {
    attach(pip.window);
    pip.addEventListener("enter", enter);
    onStop(() => pip.removeEventListener("enter", enter));
  }
  return aliases;
}

function paletteColor(raw) {
  const fallback = /^\$\{xrdb:[^:}]+:([^}]+)\}$/.exec(raw);
  let hex = (fallback ? fallback[1].trim() : raw).replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (/^[\da-f]{8}$/i.test(hex)) hex = hex.slice(0, 6);
  if (/^[\da-f]{6}$/i.test(hex)) return "#" + hex;
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(hex)) {
    const rgb = hex.split(",").map(Number);
    if (rgb.every((v) => v <= 255)) return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return null;
}

export function parseSchemes(ini = "", skipped = []) {
  const schemes = new Map();
  const invalid = new Map();
  let section;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const group = /^\[([^\]]+)\]/.exec(line);
    if (group) {
      section = group[1];
      if (!schemes.has(section)) schemes.set(section, Object.create(null));
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*([^;]*)/.exec(line);
    if (!section || !kv) continue;
    const color = paletteColor(kv[2].trim());
    if (color) schemes.get(section)[kv[1]] = color;
    else if (!invalid.has(section)) invalid.set(section, "Unsupported color for " + kv[1] + " in " + section);
  }
  for (const [name, colors] of schemes) {
    const issue = invalid.get(name) || (!Object.keys(colors).length && "No colors in " + name);
    if (issue) {
      schemes.delete(name);
      skipped.push(issue);
    }
  }
  if (!schemes.size) throw new Error(skipped.at(-1) || "No color schemes found in the palette.");
  return schemes;
}
export function colorCss(colors) {
  const vars = [];
  for (const [k, color] of Object.entries(colors))
    if (/^[\w-]+$/.test(k) && /^#[\da-f]{6}$/i.test(color)) {
      vars.push(
        "--spice-" + k + ":" + color,
        "--spice-rgb-" +
          k +
          ":" +
          color
            .slice(1)
            .match(/../g)
            .map((x) => parseInt(x, 16))
            .join(","),
      );
    }
  return ":root:root{" + vars.join(";") + "}";
}
export function defaultColors(host) {
  const p = host.Palettes?.base?.() || {};
  return {
    text: p.text || "#ffffff",
    subtext: p.subtext || "#b3b3b3",
    main: p.background || "#121212",
    "main-elevated": p.elevated || "#242424",
    sidebar: p.frame || "#000000",
    player: p.frame || "#181818",
    card: p.elevated || "#242424",
    shadow: "#000000",
    "selected-row": p.text || "#ffffff",
    button: p.accent || "#1db954",
    "button-active": p.accent || "#1ed760",
    "button-disabled": p.subtext || "#535353",
    highlight: p.elevated || "#333333",
    "highlight-elevated": p.elevated || "#444444",
    "tab-active": p.elevated || "#333333",
    notification: p.announcement || "#4687d6",
    "notification-error": p.negative || "#e22134",
    misc: p.subtext || "#b3b3b3",
  };
}
