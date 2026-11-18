// Adapted from SpotiKit 0.9.0 (NMWplays and contributors, AGPLv3). The keyboard
// helpers retain the Spicetify contributors' LGPL v2.1 terms. Modified for store
// control registration and cleanup on 2026-11-17. Attribution updated 2026-11-18.
// See THIRD_PARTY_NOTICES.txt.
import { installTooltips } from "./tooltips.js";

export function installControls({ api, SpotiKit, data, own, internal, iconMarkup }) {
  var KEYS = {
    BACKSPACE: "backspace",
    TAB: "tab",
    ENTER: "enter",
    SHIFT: "shift",
    CTRL: "ctrl",
    ALT: "alt",
    CAPS: "capslock",
    ESCAPE: "esc",
    SPACE: "space",
    PAGE_UP: "pageup",
    PAGE_DOWN: "pagedown",
    END: "end",
    HOME: "home",
    ARROW_LEFT: "left",
    ARROW_UP: "up",
    ARROW_RIGHT: "right",
    ARROW_DOWN: "down",
    INSERT: "ins",
    DELETE: "del",
    WINDOW_LEFT: "meta",
    WINDOW_RIGHT: "meta",
    SELECT: "meta",
    MULTIPLY: "*",
    ADD: "+",
    SUBTRACT: "-",
    DECIMAL_POINT: ".",
    DIVIDE: "/",
    ";": ";",
    "=": "=",
    ",": ",",
    "-": "-",
    ".": ".",
    "/": "/",
    "`": "`",
    "[": "[",
    "\\": "\\",
    "]": "]",
    '"': '"',
    "~": "`",
    "!": "1",
    "@": "2",
    "#": "3",
    $: "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    _: "-",
    "+": "=",
    ":": ";",
    "'": "'",
    "<": ",",
    ">": ".",
    "?": "/",
    "|": "\\",
  };
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (letter) {
    KEYS[letter] = letter.toLowerCase();
  });
  for (var n = 0; n <= 9; n++) {
    KEYS["NUMPAD_" + n] = String(n);
  }
  for (var f = 1; f <= 12; f++) {
    KEYS["F" + f] = "f" + f;
  }
  var keyValues = Object.keys(KEYS).map(function (k) {
    return KEYS[k];
  });

  function formatKeys(keys) {
    if (keys && typeof keys === "object") {
      if (!keys.key || keyValues.indexOf(keys.key) < 0) {
        throw "api.Keyboard.registerShortcut: Invalid key " + keys.key;
      }
      return (
        (keys.ctrl ? "mod+" : "") +
        (keys.meta ? "meta+" : "") +
        (keys.alt ? "alt+" : "") +
        (keys.shift ? "shift+" : "") +
        keys.key
      );
    }
    if (typeof keys === "string" && keyValues.indexOf(keys) >= 0) {
      return keys;
    }
    throw "api.Keyboard.registerShortcut: Invalid keys " + keys;
  }
  const shortcuts = new Map();
  api.Keyboard = {
    KEYS: KEYS,
    registerShortcut: function (keys, callback) {
      const combo = formatKeys(keys);
      const binding = SpotiKit.Keyboard.add(combo, callback);
      shortcuts.set(combo, { callback, binding });
      own(() => {
        binding.remove();
        if (shortcuts.get(combo)?.binding === binding) shortcuts.delete(combo);
      });
    },
    _deregisterShortcut: function (keys) {
      const combo = formatKeys(keys);
      shortcuts.get(combo)?.binding.remove();
      shortcuts.delete(combo);
    },
    changeShortcut: function (keys, newKeys) {
      if (!keys || !newKeys) {
        throw "api.Keyboard.changeShortcut: Invalid keys";
      }
      const current = shortcuts.get(formatKeys(keys));
      if (!current) throw new Error("Shortcut is not registered");
      api.Keyboard.registerShortcut(newKeys, current.callback);
      api.Keyboard._deregisterShortcut(keys);
    },
  };
  api.Keyboard.registerIsolatedShortcut = api.Keyboard.registerShortcut;
  api.Keyboard.registerImportantShortcut = api.Keyboard.registerShortcut;
  api.Keyboard.deregisterImportantShortcut = api.Keyboard._deregisterShortcut;

  installTooltips(api, own);

  function itemsOf(list) {
    return list ? Array.from(list) : [];
  }

  function Synced() {}
  Synced.prototype._sync = function () {
    if (this._entry) {
      this._entry.update(this._options());
    }
    if (this._parent) {
      this._parent._sync();
    }
  };
  Synced.prototype._register = function (add) {
    if (!this._entry) {
      this._entry = add(this._options());
      own(() => this.deregister());
    }
  };
  Synced.prototype.deregister = function () {
    if (this._entry) {
      this._entry.remove();
      this._entry = null;
    }
  };
  function syncedProperty(proto, name, field) {
    Object.defineProperty(proto, name, {
      get: function () {
        return this[field];
      },
      set: function (value) {
        this[field] = value;
        this._sync();
      },
    });
  }

  function ProfileItem(name, isEnabled, onClick, icon) {
    this._name = name;
    this._isEnabled = !!isEnabled;
    this._onClick = onClick;
    this._icon = icon;
  }
  ProfileItem.prototype = Object.create(Synced.prototype);
  ProfileItem.prototype._options = function () {
    var self = this;
    return {
      label: self._name,
      checked: self._isEnabled,
      icon: iconMarkup(self._icon),
      onSelect: function () {
        if (self._onClick) return self._onClick(self);
      },
    };
  };
  syncedProperty(ProfileItem.prototype, "name", "_name");
  syncedProperty(ProfileItem.prototype, "isEnabled", "_isEnabled");
  syncedProperty(ProfileItem.prototype, "icon", "_icon");
  ProfileItem.prototype.setName = function (name) {
    this.name = name;
  };
  ProfileItem.prototype.setState = function (isEnabled) {
    this.isEnabled = !!isEnabled;
  };
  ProfileItem.prototype.setIcon = function (icon) {
    this.icon = icon;
  };
  ProfileItem.prototype.register = function () {
    this._register(SpotiKit.ProfileMenu.add);
  };

  function ProfileSubMenu(name, items, icon) {
    var self = this;
    this._name = name;
    this._icon = icon;
    this._items = itemsOf(items);
    this._items.forEach(function (item) {
      item._parent = self;
    });
  }
  ProfileSubMenu.prototype = Object.create(Synced.prototype);
  ProfileSubMenu.prototype._options = function () {
    return {
      label: this._name,
      icon: iconMarkup(this._icon),
      items: this._items.map(function (item) {
        return item._options();
      }),
    };
  };
  syncedProperty(ProfileSubMenu.prototype, "name", "_name");
  syncedProperty(ProfileSubMenu.prototype, "icon", "_icon");
  ProfileSubMenu.prototype.setName = function (name) {
    this.name = name;
  };
  ProfileSubMenu.prototype.addItem = function (item) {
    item._parent = this;
    this._items.push(item);
    this._sync();
  };
  ProfileSubMenu.prototype.removeItem = function (item) {
    this._items = this._items.filter(function (i) {
      return i !== item;
    });
    this._sync();
  };
  ProfileSubMenu.prototype.register = function () {
    this._register(SpotiKit.ProfileMenu.add);
  };

  api.Menu = { Item: ProfileItem, SubMenu: ProfileSubMenu };

  function ContextItem(name, onClick, shouldAdd, icon, trailingIcon, disabled) {
    if (typeof trailingIcon === "boolean" && disabled === undefined) {
      disabled = trailingIcon;
      trailingIcon = undefined;
    }
    this._name = name;
    this._onClick = onClick;
    this._shouldAdd =
      shouldAdd ||
      function () {
        return true;
      };
    this._icon = icon;
    this._trailingIcon = trailingIcon;
    this._disabled = !!disabled;
  }
  ContextItem.prototype = Object.create(Synced.prototype);
  ContextItem.prototype._options = function () {
    var self = this;
    return {
      label: self._name,
      icon: iconMarkup(self._icon),
      trailingIcon: self._trailingIcon ? iconMarkup(self._trailingIcon) : undefined,
      disabled: self._disabled,
      when: function (target) {
        return !!self._shouldAdd(target.uris, target.uids, target.contextUri);
      },
      onSelect: function (target) {
        if (self._onClick) return self._onClick(target.uris, target.uids, target.contextUri);
      },
    };
  };
  syncedProperty(ContextItem.prototype, "name", "_name");
  syncedProperty(ContextItem.prototype, "icon", "_icon");
  syncedProperty(ContextItem.prototype, "trailingIcon", "_trailingIcon");
  syncedProperty(ContextItem.prototype, "disabled", "_disabled");
  syncedProperty(ContextItem.prototype, "shouldAdd", "_shouldAdd");
  syncedProperty(ContextItem.prototype, "onClick", "_onClick");
  ContextItem.prototype.register = function () {
    this._register(SpotiKit.ContextMenu.add);
  };
  ContextItem.iconList = Object.keys(data.icons);

  function ContextSubMenu(name, items, shouldAdd, disabled, icon) {
    var self = this;
    this._name = name;
    this._items = itemsOf(items);
    this._items.forEach(function (item) {
      item._parent = self;
    });
    this._shouldAdd =
      shouldAdd ||
      function () {
        return true;
      };
    this._disabled = !!disabled;
    this._icon = icon;
  }
  ContextSubMenu.prototype = Object.create(Synced.prototype);
  ContextSubMenu.prototype._options = function () {
    var self = this;
    return {
      label: self._name,
      icon: iconMarkup(self._icon),
      disabled: self._disabled,
      when: function (target) {
        return !!self._shouldAdd(target.uris, target.uids, target.contextUri);
      },
      items: self._items.map(function (item) {
        return item._options();
      }),
    };
  };
  syncedProperty(ContextSubMenu.prototype, "name", "_name");
  syncedProperty(ContextSubMenu.prototype, "disabled", "_disabled");
  syncedProperty(ContextSubMenu.prototype, "shouldAdd", "_shouldAdd");
  ContextSubMenu.prototype.addItem = ProfileSubMenu.prototype.addItem;
  ContextSubMenu.prototype.removeItem = ProfileSubMenu.prototype.removeItem;
  ContextSubMenu.prototype.register = function () {
    this._register(SpotiKit.ContextMenu.add);
  };
  ContextSubMenu.iconList = ContextItem.iconList;

  api.ContextMenu = { Item: ContextItem, SubMenu: ContextSubMenu };

  function parseProps(props) {
    if (!props) {
      return undefined;
    }
    var uri = props.uri || (props.item && props.item.uri) || (props.reference && props.reference.uri);
    var uris = props.uris || (uri ? [uri] : undefined);
    if (!uris) {
      return undefined;
    }
    var uid = props.uid || (props.item && props.item.uid);
    return [
      uris,
      props.uids || (uid ? [uid] : undefined),
      props.contextUri || (props.context && props.context.uri),
    ];
  }
  function contextOf(target) {
    return { props: target.props, trigger: target.trigger, target: target.element };
  }

  function V2Item(options) {
    options = options || {};
    this._children = options.children;
    this._disabled = !!options.disabled;
    this._leadingIcon = options.leadingIcon;
    this._trailingIcon = options.trailingIcon;
    this._divider = options.divider;
    this._onClick = options.onClick;
    this.shouldAdd =
      options.shouldAdd ||
      function () {
        return true;
      };
  }
  V2Item.prototype = Object.create(Synced.prototype);
  V2Item.prototype._options = function () {
    var self = this;
    return {
      label: self._children,
      icon: iconMarkup(self._leadingIcon),
      trailingIcon: self._trailingIcon ? iconMarkup(self._trailingIcon) : undefined,
      disabled: self._disabled,
      divider: self._divider,
      anyMenu: true,
      when: function (target) {
        return !!self.shouldAdd(target.props, target.trigger, target.element);
      },
      onSelect: function (target, event) {
        if (self._onClick) return self._onClick(contextOf(target), self, event);
      },
    };
  };
  syncedProperty(V2Item.prototype, "children", "_children");
  syncedProperty(V2Item.prototype, "disabled", "_disabled");
  syncedProperty(V2Item.prototype, "leadingIcon", "_leadingIcon");
  syncedProperty(V2Item.prototype, "trailingIcon", "_trailingIcon");
  syncedProperty(V2Item.prototype, "divider", "_divider");
  V2Item.prototype.register = function () {
    this._register(SpotiKit.ContextMenu.add);
  };

  function V2SubMenu(options) {
    var self = this;
    options = options || {};
    this._text = options.text;
    this._disabled = !!options.disabled;
    this._leadingIcon = options.leadingIcon;
    this._divider = options.divider;
    this._items = itemsOf(options.items);
    this._items.forEach(function (item) {
      item._parent = self;
    });
    this.shouldAdd =
      options.shouldAdd ||
      function () {
        return true;
      };
  }
  V2SubMenu.prototype = Object.create(Synced.prototype);
  V2SubMenu.prototype._options = function () {
    var self = this;
    return {
      label: self._text,
      icon: iconMarkup(self._leadingIcon),
      disabled: self._disabled,
      divider: self._divider,
      anyMenu: true,
      when: function (target) {
        return !!self.shouldAdd(target.props, target.trigger, target.element);
      },
      items: self._items.map(function (item) {
        return item._options();
      }),
    };
  };
  syncedProperty(V2SubMenu.prototype, "text", "_text");
  syncedProperty(V2SubMenu.prototype, "disabled", "_disabled");
  syncedProperty(V2SubMenu.prototype, "leadingIcon", "_leadingIcon");
  syncedProperty(V2SubMenu.prototype, "divider", "_divider");
  V2SubMenu.prototype.addItem = ProfileSubMenu.prototype.addItem;
  V2SubMenu.prototype.removeItem = ProfileSubMenu.prototype.removeItem;
  V2SubMenu.prototype.register = function () {
    this._register(SpotiKit.ContextMenu.add);
  };

  api.ContextMenuV2 = {
    Item: V2Item,
    ItemSubMenu: V2SubMenu,
    parseProps: parseProps,
    registerItem: function (item, shouldAdd) {
      if (!(item instanceof Synced)) {
        internal.log.warn(
          "api.ContextMenuV2.registerItem takes a ContextMenuV2.Item or ItemSubMenu in SpotiKit.",
        );
        return;
      }
      if (shouldAdd) {
        item.shouldAdd = shouldAdd;
      }
      item.register();
    },
    unregisterItem: function (item) {
      if (item instanceof Synced) {
        item.deregister();
      }
    },
  };

  function barProperties(proto) {
    Object.defineProperties(proto, {
      label: {
        get: function () {
          return this._bar.label;
        },
        set: function (text) {
          this._bar.label = text;
        },
      },
      icon: {
        get: function () {
          return this._icon;
        },
        set: function (icon) {
          this._icon = icon;
          this._bar.icon = iconMarkup(icon);
        },
      },
      onClick: {
        get: function () {
          return this._onClick;
        },
        set: function (fn) {
          this._onClick = fn;
        },
      },
      disabled: {
        get: function () {
          return this._bar.disabled;
        },
        set: function (value) {
          this._bar.disabled = !!value;
        },
      },
      active: {
        get: function () {
          return this._bar.active;
        },
        set: function (value) {
          this._bar.active = !!value;
        },
      },
    });
    proto.register = function () {
      this._bar.show();
      own(() => this._bar.remove());
    };
    proto.deregister = function () {
      this._bar.remove();
    };
  }

  function barButton(self, where, label, icon, onClick, disabled, active) {
    self._icon = icon;
    self._onClick = onClick;
    const options = {
      label: label || "Button",
      icon: iconMarkup(icon),
      disabled: !!disabled,
      active: !!active,
      side: where === "topbarRight" ? "right" : "left",
      onClick: () => self._onClick?.(self),
    };
    self._bar =
      where === "widget"
        ? SpotiKit.Playbar.addWidget(options)
        : where === "playbar"
          ? SpotiKit.Playbar.add(options)
          : SpotiKit.Topbar.add(options);
    self._bar.remove(); // The legacy constructor can defer registration.
    self.element = self._bar.element;
    self._bar.tooltip?.remove();
    self.tippy = api.Tippy(self.element, { content: label });
    self._bar.tooltip = self.tippy;
  }

  function TopbarButton(label, icon, onClick, disabled, isRight) {
    barButton(this, isRight ? "topbarRight" : "topbarLeft", label, icon, onClick, disabled, false);
    this.isRight = !!isRight;
    this.button = this.element;
    this.register();
  }
  barProperties(TopbarButton.prototype);
  api.Topbar = { Button: TopbarButton };

  function PlaybarButton(label, icon, onClick, disabled, active, registerOnCreate) {
    barButton(this, "playbar", label, icon, onClick, disabled, active);
    if (registerOnCreate !== false) {
      this.register();
    }
  }
  barProperties(PlaybarButton.prototype);
  function PlaybarWidget(label, icon, onClick, disabled, active, registerOnCreate) {
    barButton(this, "widget", label, icon, onClick, disabled, active);
    if (registerOnCreate !== false) {
      this.register();
    }
  }
  barProperties(PlaybarWidget.prototype);
  api.Playbar = { Button: PlaybarButton, Widget: PlaybarWidget };
}
