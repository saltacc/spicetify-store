// The actual 0.9.1 local loader and route hook run after these Spotify service fixtures.
const qa = (window.qa = {
  next: 0,
  menus: new Map(),
  route: "/spicetify-store",
  logs: [],
  listeners: new Map(),
});
const params = new URLSearchParams(location.search);
if (params.has("conflict")) window.Spicetify = { foreign: true };
function emitter() {
  const all = new Map();
  return {
    on(type, fn) {
      if (!all.has(type)) all.set(type, new Set());
      all.get(type).add(fn);
      return () => all.get(type)?.delete(fn);
    },
    emit(type, v) {
      for (const fn of all.get(type) || []) fn(v);
    },
  };
}
const playerEvents = emitter(),
  navigationEvents = emitter(),
  themeEvents = emitter();
const react = window.React,
  dom = window.ReactDOM,
  root = dom.createRoot(document.querySelector("#root"));
const qaState = { item: { metadata: {} }, duration: 30000 };
const settings = new Map();
const store = {
  get: (key, fallback) => settings.get(key) ?? fallback,
  set: (key, value) => settings.set(key, value),
};
function refreshRoute() {
  if (!qa.routes) return;
  const children = Array.from({ length: 23 }, (_, i) =>
    react.createElement("i", { path: i === 0 ? "/collection" : "/q" + i, key: i }),
  );
  const options = qa.routes({ children });
  const route = options.children.find(
    (el) => el?.props.path === qa.route.replace(/^(\/[^/]+).*/, "$1") + "/*",
  );
  root.render(route?.props.element || null);
}
const bar = class {
  constructor(where, options) {
    this.element = document.createElement("button");
    this.element.textContent = options.label;
    this.element.addEventListener("click", options.onClick);
  }
  show() {
    document.querySelector("#bar").append(this.element);
    return this;
  }
  remove() {
    this.element.remove();
  }
};
const host = (window.SpotiKit = {
  version: "0.9.1",
  classMap: {
    abc: "track-credits-modal", panel: "main-view-panel", grid: "app-layout",
    left: "now-playing-bar-left", center: "now-playing-bar-center", controls: "now-playing-bar-extra-controls",
    position: "playback-position", duration: "playback-duration", cover: "now-playing-widget-v2-cover",
    info: "now-playing-widget-v2-info", oldInfo: "now-playing-widget-info", nav: "global-nav-bar-search-area",
    row: "your-library-row", rowItem: "your-library-row-item",
  },
  React: react,
  // The desktop host overrides createRoot and inherits the other ReactDOM exports.
  ReactDOM: Object.create(dom, { createRoot: { value: dom.createRoot, enumerable: true } }),
  Storage: { scope: () => store },
  Player: {
    state: qaState,
    next() {
      qa.next++;
    },
    on: playerEvents.on,
  },
  Platform: {
    PlayerAPI: { _state: qaState },
    History: {
      get location() {
        return { pathname: qa.route };
      },
      replace: refreshRoute,
    },
  },
  Navigation: {
    get path() {
      return qa.route;
    },
    on: navigationEvents.on,
    go(route) {
      qa.route = route;
      refreshRoute();
      navigationEvents.emit("change", route);
    },
  },
  Components: { Route() {}, Routes() {} },
  Libraries: {},
  Colors: {},
  Hooks: {},
  URI: {},
  GraphQL: {},
  Panels: { builtIn: {} },
  Palettes: { base: () => ({}), on: () => () => {} },
  Themes: {
    current: null,
    on: themeEvents.on,
    css: () => "",
    reset() {
      this.current = null;
      themeEvents.emit("change", null);
    },
    apply(theme, scheme) {
      this.current = { theme, scheme };
      themeEvents.emit("change", this.current);
    },
  },
  Marketplace: { installed: () => ({}), on: () => () => {} },
  ProfileMenu: {
    add(options) {
      qa.menus.set(options.label, options);
      return {
        update(o) {
          qa.menus.set(o.label, o);
        },
        remove() {
          qa.menus.delete(options.label);
        },
      };
    },
  },
  ContextMenu: {
    add() {
      return { update() {}, remove() {} };
    },
  },
  _internal: {
    nativeReactDOM: dom,
    safeMode: params.has("safe"),
    log: {
      error(...v) {
        qa.logs.push(v.map(String).join(" "));
        console.error(...v);
      },
      warn: console.warn,
      info() {},
    },
    owners: { add() {}, dispose() {} },
    track() {},
    BarButton: bar,
    waitFor: async (fn) => fn(),
    onElement: (type, fn) => {
      qa.routes = fn;
    },
    platformReady: Promise.resolve(),
    signals: {
      platform: { on: (fn) => fn() },
      addons: {
        fire() {
          qa.ready = true;
          refreshRoute();
        },
      },
    },
  },
});
if (window.windowsFixture) {
  qa.route = "/collection";
  host.classMap = windowsFixture.classMap;
  host.Platform.version = windowsFixture.version;
  host.build = { platform: "windows", architecture: "x64" };
  host.Icons = { has: () => false };
  host.Tooltip = { attach: () => ({ setContent() {}, remove() {} }) };
  if (windowsFixture.paused) localStorage.setItem("spotikit:spicetify-store:paused", "1");
}
qa.track = (metadata) => {
  qaState.item.metadata = metadata;
  playerEvents.emit("track", qaState);
};
window.__spotikitConfig = {
  extensions: [{ id: "spicetify-store", name: "Spicetify Store", path: "spicetify-store/dist/extension.js" }],
};
