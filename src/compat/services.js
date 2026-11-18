// Adapted from SpotiKit 0.9.0 (NMWplays and contributors, AGPLv3). The color
// extraction helper derived from spicetify/cli retains the Spicetify contributors'
// LGPL v2.1 terms. Modified for store service and React bindings on 2026-11-17.
// Attribution updated 2026-11-18. See THIRD_PARTY_NOTICES.txt.
export function installServices({ api, SpotiKit, P, internal, own, lazyValue, getter, player, API_VERSION }) {
  getter(api, "Queue", function () {
    var q = player() && player()._queue;
    return q && (q._state || q._queue);
  });
  api.addToQueue = function (uris) {
    return player()._queue.addToQueue(uris);
  };
  api.removeFromQueue = function (uris) {
    return player()._queue.removeFromQueue(uris);
  };

  api.getAudioData = function (uri) {
    return SpotiKit.Audio.analysis(uri);
  };

  api.colorExtractor = function (uri) {
    return api.CosmosAsync.get(
      "https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=" + uri + "&format=json",
    ).then(function (body) {
      if (!body || !body.entries || !body.entries.length) {
        return null;
      }
      var list = {};
      body.entries[0].color_swatches.forEach(function (swatch) {
        list[swatch.preset] = "#" + (swatch.color || 0).toString(16).padStart(6, "0");
      });
      return list;
    });
  };

  api.extractColorPreset = function (image) {
    var images = Array.isArray(image) ? image : [image];
    return SpotiKit.GraphQL.query("fetchExtractedColors", { imageUris: images, uris: images }).then(
      function (result) {
        var Color = SpotiKit.Colors.Color;
        var color = function (c) {
          return c && Color ? Color.fromHex(c.hex) : c && c.hex;
        };
        return ((result && result.extractedColors) || []).map(function (entry) {
          return {
            colorRaw: color(entry.colorRaw),
            colorLight: color(entry.colorLight),
            colorDark: color(entry.colorDark),
            isFallback: !!(entry.colorRaw && entry.colorRaw.isFallback),
          };
        });
      },
    );
  };

  api.showNotification = function (message, isError, msTimeout) {
    SpotiKit.notify(message, { type: isError ? "error" : "default", duration: msTimeout });
  };
  getter(api, "Snackbar", function () {
    return Object.assign({}, internal.findSnackbar() || {});
  });

  function productState() {
    var user = P.UserAPI;
    return (
      (user && (user._product_state || user._product_state_service)) ||
      (P.ProductStateAPI && P.ProductStateAPI.productStateApi)
    );
  }
  var titleSub = null;
  api.AppTitle = {
    set: function (name) {
      var state = productState();
      if (titleSub) {
        titleSub.cancel();
      }
      return Promise.resolve(state.putOverridesValues({ pairs: { name: name } })).then(function () {
        titleSub = state.subValues({ keys: ["name"] }, function (values) {
          if (values.pairs.name !== name) {
            state.putOverridesValues({ pairs: { name: name } });
          }
        });
        return titleSub;
      });
    },
    get: function () {
      return Promise.resolve(productState().getValues()).then(function (values) {
        return values.pairs.name;
      });
    },
    reset: function () {
      if (titleSub) {
        titleSub.cancel();
      }
      return Promise.resolve(productState().delOverridesValues({ keys: ["name"] }));
    },
    sub: function (callback) {
      return productState().subValues({ keys: ["name"] }, function (values) {
        callback(values.pairs.name);
      });
    },
  };

  api.Config = { version: API_VERSION, current_theme: "", color_scheme: "", extensions: [], custom_apps: [] };

  getter(api, "React", function () {
    return SpotiKit.React;
  });
  getter(api, "ReactJSX", function () {
    return SpotiKit.Libraries.jsxRuntime;
  });
  const roots = new WeakMap();
  // SpotiKit inherits native exports such as createPortal and wraps createRoot.
  const dom = {
    __proto__: SpotiKit.ReactDOM,
    ...internal.nativeReactDOM,
    ...SpotiKit.ReactDOM,
    render(element, container, callback) {
      let root = roots.get(container);
      if (!root) {
        root = SpotiKit.ReactDOM.createRoot(container);
        roots.set(container, root);
        own(() => dom.unmountComponentAtNode(container));
      }
      root.render(element);
      if (callback) queueMicrotask(callback);
    },
    unmountComponentAtNode(container) {
      const root = roots.get(container);
      if (!root) return false;
      roots.delete(container);
      root.unmount();
      return true;
    },
  };
  getter(api, "ReactDOM", () => dom);
  getter(api, "ReactDOMServer", function () {
    return SpotiKit.Libraries.ReactDOMServer;
  });
  getter(api, "classnames", function () {
    return SpotiKit.Libraries.classnames;
  });
  getter(api, "ReactQuery", function () {
    return SpotiKit.Libraries.ReactQuery;
  });
  getter(api, "Mousetrap", function () {
    return SpotiKit.Libraries.Mousetrap;
  });
  getter(api, "Color", function () {
    return SpotiKit.Colors.Color;
  });
  getter(api, "_reservedPanelIds", function () {
    return api.Panel?.reservedPanelIds;
  });

  var componentNames = {
    RightClickMenu: "RightClickMenu",
    ContextMenu: "ContextMenu",
    Menu: "Menu",
    MenuItem: "MenuItem",
    MenuSubMenuItem: "SubMenuItem",
    AlbumMenu: "AlbumMenu",
    PodcastShowMenu: "ShowMenu",
    ArtistMenu: "ArtistMenu",
    PlaylistMenu: "PlaylistMenu",
    TrackMenu: "TrackMenu",
    EpisodeMenu: "EpisodeMenu",
    AudiobookMenu: "AudiobookMenu",
    TooltipWrapper: "Tooltip",
    TextComponent: "Text",
    IconComponent: "Icon",
    ConfirmDialog: "ConfirmDialog",
    Slider: "Slider",
    RemoteConfigProvider: "RemoteConfigProvider",
    ButtonPrimary: "Button",
    ButtonSecondary: "ButtonSecondary",
    ButtonTertiary: "ButtonTertiary",
    Chip: "Chip",
    Toggle: "Toggle",
    Cards: "Cards",
    Router: "Router",
    Routes: "Routes",
    Route: "Route",
    StoreProvider: "StoreProvider",
    PlatformProvider: "PlatformProvider",
    Dropdown: "Dropdown",
    Navigation: "Link",
    ScrollableContainer: "ScrollRow",
  };
  api.ReactComponent = {};
  Object.keys(componentNames).forEach(function (name) {
    getter(api.ReactComponent, name, function () {
      return SpotiKit.Components[componentNames[name]];
    });
  });

  var nativeDrag = null;
  api.ReactHook = {
    DragHandler: function (uris, label, contextUri, sectionIndex, dropOriginUri) {
      if (!nativeDrag) {
        nativeDrag = internal.findExport(function (value) {
          var text = typeof value === "function" ? internal.source(value) : "";
          return /dataTransfer/.test(text) && /data-dragging-type/.test(text) && /itemUris/.test(text);
        });
      }
      var drag = nativeDrag({});
      return function (event, u, l, c, s) {
        return drag.onDragStart(event, {
          itemUris: u || uris || [],
          dragLabelText: l || label || "",
          contextUri: c || contextUri || "",
          sectionIndex: s === undefined ? sectionIndex : s,
          dropOriginUri: dropOriginUri,
        });
      };
    },
    useExtractedColor: function (uri, fallback, variant) {
      var colors = SpotiKit.Hooks.useColors(uri);
      var key = { colorRaw: "raw", colorLight: "light", colorDark: "dark" }[variant || "colorRaw"] || "raw";
      return (colors && colors[key]) || fallback || "#535353";
    },
  };

  api.ReactFlipToolkit = {};
  internal.lazy(api.ReactFlipToolkit, "Flipper", function () {
    return internal.findExport(function (v) {
      return (
        typeof v === "function" &&
        v.prototype &&
        typeof v.prototype.getSnapshotBeforeUpdate === "function" &&
        /flipKey/.test(internal.source(v))
      );
    });
  });
  internal.lazy(api.ReactFlipToolkit, "Flipped", function () {
    return internal.findExport(function (v) {
      return typeof v === "function" && v.displayName === "Flipped";
    });
  });

  function camel(type, upperFirst) {
    return type
      .toLowerCase()
      .split("_")
      .map(function (word, i) {
        return i > 0 || upperFirst ? word.charAt(0).toUpperCase() + word.slice(1) : word;
      })
      .join("");
  }

  lazyValue("URI", function () {
    var native = internal.uri;
    if (!native || !native.Class || !native.Type) {
      return undefined;
    }
    var URI = function (type, props) {
      return Reflect.construct(native.Class, [type, props], native.Class);
    };
    URI.prototype = native.Class.prototype;
    URI.Type = native.Type;
    URI.fromString = function (text) {
      return native.parseStrict(text);
    };
    URI.from = function (value) {
      return SpotiKit.URI.parse(value);
    };
    Object.keys(native.builders).forEach(function (type) {
      URI[camel(type) + "URI"] = native.builders[type];
    });
    Object.keys(native.Type).forEach(function (type) {
      URI["is" + camel(type, true)] = function (value) {
        var parsed = SpotiKit.URI.parse(value);
        return !!parsed && parsed.type === native.Type[type];
      };
    });
    URI.isPlaylistV1OrV2 = function (value) {
      return URI.isPlaylist(value) || URI.isPlaylistV2(value);
    };
    URI.isSameIdentity = function (a, b) {
      return SpotiKit.URI.equals(a, b);
    };
    URI.idToHex = function (id) {
      try {
        return SpotiKit.URI.toHex(id);
      } catch (e) {
        return id;
      }
    };
    URI.hexToId = function (hex) {
      try {
        return SpotiKit.URI.fromHex(hex);
      } catch (e) {
        return hex;
      }
    };
    return URI;
  });

  lazyValue("Locale", function () {
    var l = internal.locale();
    return {
      get _relativeTimeFormat() {
        return l._relativeTimeFormat;
      },
      get _dateTimeFormats() {
        return l._dateTimeFormats;
      },
      get _locale() {
        return l._localeForTranslation.baseName;
      },
      get _urlLocale() {
        return l._localeForURLPath;
      },
      get _dictionary() {
        return l._translations;
      },
      get _supportedLocales() {
        return internal.findExport(function (v) {
          return v && typeof v === "object" && typeof v.ja === "string" && typeof v.de === "string";
        });
      },
      formatDate: function (date, options) {
        return l.formatDate(date, options);
      },
      formatRelativeTime: function (date, options) {
        return l.formatRelativeDate(date, options);
      },
      formatNumber: function (number, options) {
        return l.formatNumber(number, options);
      },
      formatNumberCompact: function (number, options) {
        return l.formatNumberCompact(number, options);
      },
      get: function () {
        return l.get.apply(l, arguments);
      },
      getDateTimeFormat: function (options) {
        return l.getDateTimeFormat(options);
      },
      getDictionary: function () {
        return l.getTranslations();
      },
      getLocale: function () {
        return l._localeForTranslation.baseName;
      },
      getSmartlingLocale: function () {
        return l.getLocaleForSmartling();
      },
      getUrlLocale: function () {
        return l.getLocaleForURLPath();
      },
      getRelativeTimeFormat: function () {
        return l.getRelativeTimeFormat();
      },
      getSeparator: function () {
        return l.getSeparator();
      },
      toLocaleLowerCase: function (text) {
        return l.toLocaleLowerCase(text);
      },
      toLocaleUpperCase: function (text) {
        return l.toLocaleUpperCase(text);
      },
    };
  });

  api.GraphQL = {};
  getter(api.GraphQL, "Definitions", function () {
    return SpotiKit.GraphQL.definitions;
  });
  api.GraphQL.Request = (definition, variables, ...rest) =>
    SpotiKit.GraphQL.request(definition, variables, ...rest);
  internal.lazy(api.GraphQL, "Handler", function () {
    return internal.findExport(function (v) {
      return (
        typeof v === "function" && internal.source(v).indexOf("GraphQL subscriptions are not supported") >= 0
      );
    });
  });
}
