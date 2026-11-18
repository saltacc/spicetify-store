// Adapted from SpotiKit 0.9.0 (NMWplays and contributors, AGPLv3). The popup
// markup, styling and class-name helper derived from spicetify/cli retain the
// Spicetify contributors' LGPL v2.1 terms. Modified for store-owned styles and
// cleanup on 2026-11-17. Attribution updated 2026-11-18. See THIRD_PARTY_NOTICES.txt.
export function installPopup({ api, SpotiKit, iconMarkup, style, own }) {
  var POPUP_CSS = `
    generic-modal :where(.GenericModal__overlay) {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.7);
    }
    generic-modal :where(.spicetify-popup) {
      display: flex;
      max-height: calc(100vh - 64px);
      border-radius: 8px;
      overflow: hidden;
    }
    generic-modal :where(.spicetify-popup-container) {
      display: flex;
      flex-direction: column;
      width: 524px;
      max-width: 100%;
      min-height: 0;
      border-radius: 8px;
      color: var(--spice-text, var(--text-base, #fff));
      background-color: var(--spice-player, var(--background-elevated-base, #121212));
    }
    generic-modal .spicetify-popup-container {
      height: auto;
      max-height: calc(100vh - 64px);
    }
    generic-modal .spicetify-popup-container-large {
      width: 664px;
      min-width: 0;
      max-width: calc(100vw - 64px);
    }
    generic-modal :where(.spicetify-popup-header) {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px;
    }
    generic-modal :where(.spicetify-popup-title) {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.3;
    }
    generic-modal :where(.spicetify-popup-closeBtn) {
      display: inline-flex;
      vertical-align: middle;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      margin-block-start: -8px;
      margin-inline-end: -8px;
      border: 0;
      border-radius: 50%;
      background-color: transparent;
      color: var(--spice-subtext, var(--text-subdued, #b3b3b3));
      cursor: pointer;
    }
    generic-modal :where(.spicetify-popup-closeBtn:hover) {
      color: var(--spice-text, var(--text-base, #fff));
    }
    generic-modal :where(.spicetify-popup-content) {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 0 24px 24px;
    }
  `;

  var LEGACY_CSS = `
    :where(.search-searchCategory-contentArea) {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    :where(.search-searchCategory-categoryGrid) {
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      scroll-behavior: smooth;
    }
    :where(.search-searchCategory-categoryGrid)::-webkit-scrollbar {
      display: none;
    }
    :where(.search-searchCategory-categoryGrid > [role="presentation"]) {
      display: flex;
      flex-wrap: nowrap;
      width: max-content;
    }
    :where(.search-searchCategory-categoryGridItem) {
      flex: none;
      display: inline-flex;
      text-decoration: none;
      color: inherit;
    }
    :where(.search-searchCategory-carousel) {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    :where(.search-searchCategory-carouselButton) {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      cursor: pointer;
      color: var(--text-base, #fff);
      background: var(--background-elevated-highlight, #2a2a2a);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
    }
    :where(.search-searchCategory-carouselButtonLeft) {
      left: 4px;
    }
    :where(.search-searchCategory-carouselButtonRight) {
      right: 4px;
    }
    :where(.search-searchCategory-showLeftButton) :where(.search-searchCategory-carouselButtonLeft),
    :where(.search-searchCategory-showRightButton) :where(.search-searchCategory-carouselButtonRight) {
      opacity: 1;
      pointer-events: auto;
    }
    :where(.search-searchCategory-carouselButton) svg,
    :where(.Svg-img-icon-small-textBase) {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
  `;

  function escapeHtml(text) {
    return String(text === undefined || text === null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  const modal = document.createElement("generic-modal");
  modal.hide = function () {
    var main = this.querySelector("main");
    if (main && this._react) {
      api.ReactDOM.unmountComponentAtNode(main);
    }
    this._react = false;
    this.remove();
  };
  modal.display = function (options) {
    this.hide();
    options = options || {};
    var title = escapeHtml(options.title);
    var container = options.isLarge
      ? "spicetify-popup-container spicetify-popup-container-large track-credits-modal"
      : "spicetify-popup-container track-credits-modal";
    this.innerHTML =
      '<div class="GenericModal__overlay" style="z-index:100">' +
      '<div class="GenericModal spicetify-popup" tabindex="-1" role="dialog" aria-label="' +
      title +
      '" aria-modal="true">' +
      '<div class="' +
      container +
      '">' +
      '<div class="spicetify-popup-header track-credits-modal-header">' +
      '<h1 class="spicetify-popup-title e-text encore-text-title-small">' +
      title +
      "</h1>" +
      '<button aria-label="Close" class="spicetify-popup-closeBtn track-credits-modal-close">' +
      iconMarkup("x") +
      "</button>" +
      "</div>" +
      '<div class="spicetify-popup-content track-credits-modal-body"><main></main></div>' +
      "</div></div></div>";
    var self = this;
    this.querySelector("button").onclick = function () {
      self.hide();
    };
    this.querySelector(".GenericModal__overlay").addEventListener("click", function (event) {
      if (!self.querySelector(".GenericModal").contains(event.target)) self.hide();
    });
    var main = this.querySelector("main");
    var content = options.content;
    this._react = !!(content && content.$$typeof);
    if (this._react) {
      api.ReactDOM.render(content, main);
    } else if (typeof content === "string") {
      main.innerHTML = content;
    } else if (content) {
      main.append(content);
    }
    document.body.append(this);
  };
  style(POPUP_CSS + LEGACY_CSS);
  api.PopupModal = modal;
  own(() => modal.hide());

  api._getStyledClassName = function (args, component) {
    var includedKeys = [
      "role",
      "variant",
      "semanticColor",
      "iconColor",
      "color",
      "weight",
      "buttonSize",
      "iconSize",
      "position",
      "data-encore-id",
      "$size",
      "$iconColor",
      "$variant",
      "$semanticColor",
      "$buttonSize",
      "$position",
      "$iconSize",
      "$lineClamp",
    ];
    var customKeys = ["blocksize"];
    var customExactKeys = ["$padding", "$paddingBottom", "paddingBottom", "padding"];
    var element = Array.prototype.find.call(args, function (e) {
      return (
        e &&
        (e.children ||
          e.dangerouslySetInnerHTML ||
          typeof e.className !== "undefined" ||
          includedKeys.some(function (key) {
            return typeof e[key] !== "undefined";
          }) ||
          customExactKeys.some(function (key) {
            return typeof e[key] !== "undefined";
          }) ||
          customKeys.some(function (key) {
            return Object.keys(e).some(function (k) {
              return k.toLowerCase().indexOf(key) >= 0;
            });
          }))
      );
    });
    if (!element) {
      return undefined;
    }
    var match = /(?:\w+__)?(\w+)-[\w-]+/.exec(component.componentId);
    var className = match && match[1];
    includedKeys.forEach(function (key) {
      if ((typeof element[key] === "string" && element[key].length) || typeof element[key] === "number") {
        className += "-" + element[key];
      }
    });
    var excludedKeys = [
      "children",
      "className",
      "style",
      "dir",
      "key",
      "ref",
      "as",
      "$autoMirror",
      "autoMirror",
      "$hasFocus",
      "",
    ];
    ["iconLeading", "iconTrailing", "iconOnly", "$iconOnly", "$iconLeading", "$iconTrailing"].forEach(
      function (key) {
        if (element[key]) {
          className += "-" + (key.charAt(0) === "$" ? key.slice(1) : key);
        }
      },
    );
    Object.keys(element)
      .filter(function (key) {
        return typeof element[key] === "boolean" && element[key];
      })
      .forEach(function (key) {
        if (excludedKeys.indexOf(key) < 0 && key.indexOf("aria-") !== 0) {
          className += "-" + (key.charAt(0) === "$" ? key.slice(1) : key);
        }
      });
    Object.keys(element).forEach(function (key) {
      var value = element[key];
      var custom =
        customKeys.some(function (k) {
          return key.toLowerCase().indexOf(k) >= 0;
        }) || customExactKeys.indexOf(key) >= 0;
      if (custom && typeof value === "string" && value.length) {
        className +=
          "-" + (key.charAt(0) === "$" ? key.slice(1) : key) + "_" + value.replace(/[^a-z0-9]/gi, "_");
      }
    });
    return className;
  };
}
