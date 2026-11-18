// Observed in Spotify's Windows x64 1.3.10.2586 UI. SpotiKit 0.9.2 ships
// without a class map for this build. Always defer to a map supplied by the host.
const windowsClasses = {
  history: "Tpe_EXbFoHioEukq1L3y",
  "main-trackList-trackListRow": "xwwlUJUZLpjPnZByq04Y",
  "main-card-card": "ofahUhwV8VMlglXFA3hw",
};

export function unmappedWindowsClasses(host) {
  const platform = host.build?.platform || navigator.userAgentData?.platform || navigator.platform;
  if (!/^win/i.test(platform) || !/^1\.3\.10\.2586(?:[.+-]|$)/.test(host.Platform?.version) ||
      (host.build?.architecture && !/^(?:x64|amd64|x86_64)$/i.test(host.build.architecture)) ||
      Object.keys(host.classMap || {}).length) return null;
  return windowsClasses;
}

export function installWindowsToolbar(host, onStop) {
  const layout = unmappedWindowsClasses(host);
  if (!layout) return;
  const stable = "global-nav-bar-history-buttons";
  let bar, owned = false;
  const observer = new MutationObserver(update);
  function update() {
    if (!bar?.isConnected || !bar.classList.contains(layout.history)) {
      if (owned) bar.classList.remove(stable);
      // Observe the mounted bar's own class as well as replacements of the bar.
      observer.disconnect();
      observer.observe(document.documentElement, { childList: true, subtree: true });
      bar = document.querySelector("." + layout.history);
      owned = false;
      if (bar) observer.observe(bar, { attributes: true, attributeFilter: ["class"] });
    }
    if (bar && !bar.classList.contains(stable)) {
      bar.classList.add(stable);
      owned = true;
    }
  }
  update();
  onStop(() => {
    observer.disconnect();
    if (owned) bar.classList.remove(stable);
  });
}

// Some legacy insertion points have two native layouts. Mark the elements so
// stylesheets, DOM queries and live class collections all find the same node.
export function installLayoutMounts(win, hostMap, aliases, onStop) {
  const doc = win.document;
  const native = new Set(Object.values(hostMap));
  const roles = [
    ["main-nowPlayingWidget-trackInfo", ["now-playing-widget-v2-info", "now-playing-widget-info"]],
    ["main-coverSlotCollapsed-container", ["now-playing-widget-v2-cover", "now-playing-widget-cover-slot"]],
  ].filter(([legacy, variants]) => !native.has(legacy) && !aliases.has(legacy) && variants.some((v) => native.has(v)))
    .map(([legacy, variants]) => [legacy, variants.filter((v) => native.has(v)).map((v) => "." + v).join(",")]);
  // Library markup has an outer row, a group and its keyboard target. Supply
  // the legacy wrapper only where its child selector reaches that same button.
  const library = native.has("your-library-row") && native.has("your-library-row-item") &&
    !native.has("main-yourLibraryX-listItem") && !aliases.has("main-yourLibraryX-listItem");
  if (library) roles.push(["main-yourLibraryX-listItem",
    ":is(.your-library-row,.your-library-row > div):has(> .your-library-row-item > div:first-child[role=button])"]);
  const navHost = native.has("global-nav-bar-search-area") && ".global-nav-bar-search-area";
  if (!roles.length && !navHost) return;

  const marked = new Map();
  const relevant = roles.map(([legacy, selector]) => "." + legacy + "," + selector).join(",");
  function update(el) {
    for (const [legacy, selector] of roles) {
      if (el.matches(selector) && !el.classList.contains(legacy)) {
        el.classList.add(legacy);
        marked.set(el, legacy);
      } else if (marked.get(el) === legacy && !el.matches(selector)) {
        el.classList.remove(legacy);
        marked.delete(el);
      }
    }
  }
  function visit(el) {
    if (el.nodeType !== 1 || !relevant) return;
    if (el.matches(relevant)) update(el);
    for (const child of el.querySelectorAll(relevant)) update(child);
  }
  const nav = doc.createElement("div");
  nav.dataset.spiceNavLinks = "";
  nav.className = "custom-navlinks-scrollable_container";
  const links = doc.createElement("div");
  links.setAttribute("role", "presentation");
  nav.append(links);
  function placeNav() {
    if (navHost && !nav.isConnected && !doc.querySelector(".custom-navlinks-scrollable_container"))
      doc.querySelector(navHost)?.append(nav);
  }
  visit(doc.documentElement);
  placeNav();
  const observer = new win.MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") update(r.target);
      else for (const node of r.addedNodes) visit(node);
      if (library) {
        const row = r.target.closest?.(".your-library-row");
        if (row) visit(row);
      }
    }
    for (const [el, legacy] of marked) if (!el.isConnected) {
      el.classList.remove(legacy);
      marked.delete(el);
    }
    placeNav();
  });
  observer.observe(doc.documentElement, {
    childList: true, subtree: true,
    ...(roles.length ? { attributes: true, attributeFilter: ["class"] } : {}),
  });
  onStop(() => {
    observer.disconnect();
    nav.remove();
    for (const [el, legacy] of marked) el.classList.remove(legacy);
    marked.clear();
  });
}
