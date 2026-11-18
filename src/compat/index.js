import icons from "../../data/icons.json" with { type: "json" };
import { panelApi } from "./panels.js";
import { installPlayer } from "./player.js";
import { installServices } from "./services.js";
import { installControls } from "./controls.js";
import { installPopup } from "./popup.js";

// Spotify owns these bindings. Optional lookups stay lazy across client versions.
export function createFacade(host, own, style) {
  if (!host.Player || !host.Platform || !host.React || !host.ReactDOM)
    throw new Error("The Spotify player and React runtime are still unavailable.");
  const api = {};
  const internal = host._internal || {};
  const getter = (target, name, get) =>
    Object.defineProperty(target, name, { configurable: true, enumerable: true, get });
  const lazy = (target, name, find) => {
    let value;
    getter(target, name, () => {
      if (value == null) {
        try {
          value = find();
        } catch {}
      }
      return value;
    });
  };
  const bindings = Object.assign(Object.create(internal), {
    lazy,
    log: internal.log || console,
    findExport: internal.findExport || (() => undefined),
    source: internal.source || ((value) => (typeof value === "function" ? String(value) : "")),
  });
  const iconMarkup = (icon) =>
    typeof icon === "string" && Object.hasOwn(icons, icon)
      ? '<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">' + icons[icon] + "</svg>"
      : icon || "";
  const options = {
    api,
    SpotiKit: host,
    P: host.Platform,
    internal: bindings,
    own,
    style,
    getter,
    data: { icons },
    iconMarkup,
    lazyValue: (name, find) => lazy(api, name, find),
    player: () => host.Platform.PlayerAPI,
    API_VERSION: "2.45.3",
  };
  api.SVGIcons = { ...icons };
  installPlayer(options);
  installServices(options);
  installControls(options);
  installPopup(options);
  api.CosmosAsync = cosmosApi(host);
  api.LocalStorage = legacyStorage();
  api.Panel = panelApi(host, own);
  const capabilities = () => {
    const missing = [
      "Player",
      "Platform",
      "React",
      "ReactDOM",
      "URI",
      "ContextMenu",
      "PopupModal",
      "Topbar",
      "Playbar",
      "CosmosAsync",
      "GraphQL",
      "Keyboard",
    ].filter((key) => !api[key]);
    return { target: options.API_VERSION, missing };
  };
  api.test = capabilities;
  api.Events.webpackLoaded.fire();
  api.Events.platformLoaded.fire();
  return api;
}

function legacyStorage() {
  const keys = new Set();
  const reserved = (key) => String(key).startsWith("spotikit:");
  return {
    get(key) {
      if (reserved(key)) return null;
      keys.add(String(key));
      return localStorage.getItem(key);
    },
    set(key, value) {
      if (!reserved(key)) {
        keys.add(String(key));
        localStorage.setItem(key, value);
      }
    },
    remove(key) {
      if (!reserved(key)) localStorage.removeItem(key);
    },
    clear() {
      for (const key of keys) localStorage.removeItem(key);
      keys.clear();
    },
  };
}

function cosmosApi(host) {
  const cosmos = () =>
    host.Platform.PlayerAPI?._cosmos || host.Platform.Cosmos || host.Platform.get?.("Cosmos");
  const methods = {};
  for (const [name, method] of Object.entries({
    get: "GET",
    post: "POST",
    put: "PUT",
    del: "DELETE",
    patch: "PATCH",
    head: "HEAD",
  })) {
    methods[name] = async (address, body, headers) => {
      const target = new URL(address);
      if (["sp:", "wg:", "hm:"].includes(target.protocol)) return cosmos()[name](address, body, headers);
      if (target.protocol !== "https:") throw new Error("An HTTPS or Spotify service address is required");
      const query = method === "GET" || method === "HEAD";
      // The host adds Spotify credentials. Only pass URLs for the actual Spotify services.
      if (
        target.origin === "https://api.spotify.com" ||
        (/^spclient(?:[.-][a-z0-9-]+)*\.spotify\.com$/.test(target.hostname) && !target.port)
      ) {
        const response = await host.Http.request(method, target.href, {
          headers,
          ...(query ? { query: body } : { body }),
        });
        return response.status >= 400
          ? {
              code: response.status,
              error: response.body?.error?.message || String(response.status),
              message: "Failed to fetch",
              stack: undefined,
            }
          : response.body;
      }
      if (query && body) for (const [key, val] of Object.entries(body)) target.searchParams.append(key, val);
      const options = { method, headers: new Headers(headers), credentials: "omit" };
      if (!query && body != null) {
        if (typeof body === "string" || body instanceof Blob || body instanceof FormData) options.body = body;
        else {
          options.body = JSON.stringify(body);
          if (!options.headers.has("Content-Type")) options.headers.set("Content-Type", "application/json");
        }
      }
      const response = await fetch(target, options);
      if (!response.ok)
        return {
          code: response.status,
          error: response.statusText,
          message: "Failed to fetch",
          stack: undefined,
        };
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    };
  }
  for (const name of ["sub", "postSub", "request", "resolve"])
    methods[name] = (...args) => cosmos()[name](...args);
  return methods;
}
