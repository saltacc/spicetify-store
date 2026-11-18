import { strToU8 } from "fflate";
import manifest from "../spotikit.json" with { type: "json" };
import { excludedFromListings, listingKey, mergeCatalogItems } from "./catalog.js";
import { ReleaseFileRequired } from "./releases.js";

const h = (...args) => window.SpotiKit.React.createElement(...args);
const Fragment = Symbol.for("react.fragment");
const tabs = ["Browse", "Installed", "Updates", "Profiles", "Settings"];
const kinds = { extension: "Extensions", theme: "Themes", app: "Apps", snippet: "Snippets" };
const kindName = { extension: "Extension", theme: "Theme", app: "Custom app", snippet: "CSS snippet" };
const short = (v) => v?.slice(0, 10) || "—";
function revisionLabel(item, digest) {
  if (item.kind !== "app" || !item.revision) return short(digest);
  return /^[a-f\d]{40}$/i.test(item.revision)
    ? (item.buildBranch || "commit") + " " + short(item.revision) : item.revision;
}
const slug = (v) => String(v).toLowerCase().replace(/\s+/g, "-");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const icons = {
  extension: ["M3 7.5h4.75a2.75 2.75 0 1 1 4 0h4.75v4.75a2.75 2.75 0 1 1 0 4V21H3z"],
  theme: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", { d: "M12 3a9 9 0 0 1 0 18Z" }],
  app: ["M4 4h6.5v6.5H4z", "M13.5 4H20v6.5h-6.5z", "M4 13.5h6.5V20H4z", "M13.5 13.5H20V20h-6.5z"],
  snippet: ["m8.5 7.5-4.5 4.5 4.5 4.5", "m15.5 7.5 4.5 4.5-4.5 4.5", "m13.5 5-3 14"],
  search: ["M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z", "m20 20-4.5-4.5"],
  download: ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  plus: ["M12 5v14", "M5 12h14"],
  refresh: [
    "M4.5 11a7.5 7.5 0 0 1 13.3-4.3L20 9",
    "M20 4.5V9h-4.5",
    "M19.5 13a7.5 7.5 0 0 1-13.3 4.3L4 15",
    "M4 19.5V15h4.5",
  ],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  up: ["M12 19V5", "m6 11 6-6 6 6"],
  down: ["M12 5v14", "m6 13 6 6 6-6"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "m6 7 1 13h10l1-13", "M9 7V4h6v3"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 11v5", "M12 7.5v.01"],
  box: ["M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z", "M3.5 7.5 12 12l8.5-4.5", "M12 12v9"],
  layers: ["M12 3 3 8l9 5 9-5Z", "m3 12.5 9 5 9-5", "m3 16.5 9 5 9-5"],
  power: ["M12 3v8", "M6.3 6.8a8 8 0 1 0 11.4 0"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  link: ["M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1", "M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"],
  archive: ["M3.5 4.5h17v4h-17z", "M5 8.5v11h14v-11", "M10 12.5h4"],
  pen: ["m14.5 5.5 4 4", "M4 20l1-5L15.5 4.5a2.1 2.1 0 0 1 4 4L9 19Z"],
  open: ["M7 17 17 7", "M8 7h9v9"],
};
function Icon({ name, size = 18, stroke = 2 }) {
  return (
    <svg
      className="ss-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name].map((p, i) =>
        typeof p === "string" ? (
          <path key={i} d={p} />
        ) : (
          <path key={i} d={p.d} fill="currentColor" stroke="none" />
        ),
      )}
    </svg>
  );
}
// Keeps the last value rendered while it animates out, then releases it.
function usePresence(value, ms) {
  const { useState, useLayoutEffect } = window.SpotiKit.React;
  const [kept, keep] = useState(value);
  useLayoutEffect(() => {
    if (value) {
      keep(value);
      return undefined;
    }
    const timer = setTimeout(() => keep(null), reduced() ? 0 : ms);
    return () => clearTimeout(timer);
  }, [value]);
  return value ? [value, false] : [kept, !!kept];
}
// Animates keyed children from their previous layout position (FLIP).
function useFlip(ref, lift) {
  const { useRef, useLayoutEffect } = window.SpotiKit.React;
  const last = useRef({ list: null, tops: new Map() });
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const same = last.current.list === list,
      tops = new Map();
    let moved = false;
    for (const el of list.children) {
      const key = el.dataset.flip;
      if (!key) continue;
      tops.set(key, el.offsetTop);
      const before = same ? last.current.tops.get(key) : undefined;
      if (before !== undefined && before !== el.offsetTop && !reduced()) {
        const raised = key === lift?.current;
        moved = true;
        if (raised) el.classList.add("is-moving");
        el.animate([{ transform: "translateY(" + (before - el.offsetTop) + "px)" }, { transform: "none" }], {
          duration: 520,
          easing: "cubic-bezier(0.3, 1.16, 0.5, 1)",
        }).finished.then(
          () => raised && el.classList.remove("is-moving"),
          () => raised && el.classList.remove("is-moving"),
        );
      }
    }
    if (moved && lift) lift.current = null;
    last.current = { list, tops };
  });
}
function downloadFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadJson(name, data) {
  downloadFile(name + ".json", new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}
// The build embeds both resources so a one-file Marketplace install carries
// the licenses and source for the version being used, including when offline.
function downloadLicenses() {
  const notices = new Blob([__STORE_LICENSE_TEXT__], { type: "text/plain;charset=utf-8" });
  downloadFile("spicetify-store-" + manifest.version + "-licenses.txt", notices);
}
function downloadSource() {
  const bytes = strToU8(atob(__STORE_SOURCE_URI__.slice("data:application/zip;base64,".length)), true);
  downloadFile("spicetify-store-" + manifest.version + "-source.zip", new Blob([bytes], { type: "application/zip" }));
}
async function readJson(file) {
  if (file.size > 128 * 1024 * 1024) throw new Error("JSON file exceeds 128 MiB.");
  return JSON.parse(await file.text());
}
function fileInput(label, accept, onFile, { icon = "upload", className = "", disabled = false } = {}) {
  return (
    <label className={"ss-btn ss-file " + className}>
      <Icon name={icon} size={16} />
      {label}
      <input
        aria-label={label}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
function Artwork({ item, size = "card", installed }) {
  const { useState } = window.SpotiKit.React;
  const [broken, fail] = useState(false),
    [loaded, setLoaded] = useState(false);
  const image = item.preview && !broken && size !== "row";
  return (
    <div aria-hidden="true" className={"ss-art ss-art-" + size + " ss-" + item.kind}>
      <span className="ss-art-icon">
        <Icon name={item.kind} size={size === "row" ? 22 : size === "hero" ? 36 : 30} stroke={1.7} />
      </span>
      {image && (
        <img
          className={loaded ? "is-loaded" : ""}
          ref={(img) => {
            if (img?.complete && img.naturalWidth && !loaded) setLoaded(true);
          }}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={item.preview}
          onLoad={() => setLoaded(true)}
          onError={() => fail(true)}
          alt=""
        />
      )}
      {installed && (
        <span className="ss-art-badge">
          <Icon name="check" size={12} stroke={3} />
          Installed
        </span>
      )}
    </div>
  );
}
function ItemCard({ item, installed, open, index }) {
  return (
    <button type="button" className="ss-card" style={{ "--i": index % 24 }} onClick={() => open(item)}>
      <Artwork item={item} installed={installed} />
      <span className="ss-card-body">
        <strong>{item.name}</strong>
        <small>{item.authors?.join(", ") || item.repo || kindName[item.kind]}</small>
        <span className="ss-description">{item.description || kindName[item.kind]}</span>
        {installed && <small className="ss-sr">Installed</small>}
      </span>
    </button>
  );
}
function Skeleton({ index }) {
  return (
    <div className="ss-skeleton" aria-hidden="true" style={{ "--i": index }}>
      <i className="ss-sk-art" />
      <i className="ss-sk-title" />
      <i className="ss-sk-meta" />
      <i className="ss-sk-line" />
      <i className="ss-sk-line ss-sk-short" />
    </div>
  );
}
function Empty({ icon = "box", children }) {
  return (
    <div className="ss-empty">
      <span className="ss-empty-icon">
        <Icon name={icon} size={26} stroke={1.7} />
      </span>
      <p>{children}</p>
    </div>
  );
}
function Tabs({ tab, onChange, installed, updates }) {
  const { useRef, useState, useLayoutEffect, useEffect } = window.SpotiKit.React;
  const nav = useRef(null),
    [pill, setPill] = useState(null),
    [live, setLive] = useState(false);
  useLayoutEffect(() => {
    const el = nav.current;
    const measure = () => {
      const on = el.querySelector('[aria-current="page"]');
      if (!on) return;
      const x = on.offsetLeft,
        w = on.offsetWidth;
      setPill((p) => (p && p.x === x && p.w === w ? p : { x, w }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const b of el.querySelectorAll("button")) observer.observe(b);
    return () => observer.disconnect();
  }, [tab, installed > 0, updates > 0]);
  useEffect(() => {
    if (!pill || live) return undefined;
    const frame = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(frame);
  }, [pill]);
  return (
    <nav aria-label="Store sections" className="ss-tabs" ref={nav}>
      <span
        aria-hidden="true"
        className={"ss-tab-pill" + (pill ? " is-set" : "") + (live ? " is-live" : "")}
        style={pill ? { "--x": pill.x + "px", "--w": pill.w + "px" } : undefined}
      />
      {tabs.map((t) => (
        <button
          key={t}
          className="ss-tab"
          aria-current={tab === t ? "page" : undefined}
          onClick={() => onChange(t)}
        >
          {t}
          {t === "Installed" && installed > 0 && (
            <small key={installed} className="ss-badge">
              {installed}
            </small>
          )}
          {t === "Updates" && updates > 0 && (
            <small key={updates} className="ss-badge ss-badge-accent">
              {updates}
            </small>
          )}
        </button>
      ))}
    </nav>
  );
}
function Dialog({ title, close, leaving, media, icon, tone, wide, children }) {
  const { useEffect, useRef } = window.SpotiKit.React,
    ref = useRef(null),
    frozen = useRef(children);
  if (!leaving) frozen.current = children;
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={
        "ss-dialog" +
        (wide ? " ss-dialog-wide" : "") +
        (icon ? " ss-dialog-centered" : "") +
        (media ? " ss-dialog-media" : "") +
        (leaving ? " ss-leaving" : "")
      }
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!leaving) close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !leaving) close();
      }}
    >
      {media}
      <button className="ss-close" aria-label="Close dialog" onClick={close}>
        <Icon name="close" size={18} />
      </button>
      <div className="ss-dialog-content">
        <header>
          {icon && (
            <span className="ss-dialog-icon" data-tone={tone}>
              <Icon name={icon} size={26} />
            </span>
          )}
          <h2>{title}</h2>
        </header>
        {leaving ? frozen.current : children}
      </div>
    </dialog>
  );
}
function Confirm({ text, action, tone = "accent", busy, onConfirm, close }) {
  return (
    <div className="ss-confirm">
      <p>{text}</p>
      <div className="ss-confirm-actions">
        <button onClick={close}>Cancel</button>
        <button className={tone === "danger" ? "ss-danger-solid" : "ss-primary"} disabled={busy} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  );
}
function Choices({ manager, item, run, close, busy, openRelease }) {
  const rec = manager.state.installs.find((r) => r.item.id === item.id);
  const sameListing = rec && listingKey(rec.item) === listingKey(item);
  const repo = item.repo ? "https://github.com/" + item.repo : item.source;
  return (
    <>
      <p className="ss-byline">
        <span className={"ss-kind-chip ss-" + item.kind}>
          <Icon name={item.kind} size={13} stroke={2.2} />
          {kindName[item.kind]}
        </span>
        {sameListing && (
          <span className="ss-kind-chip ss-chip-installed">
            <Icon name="check" size={12} stroke={3} />
            Installed
          </span>
        )}
      </p>
      <p className="ss-lede">{item.description || kindName[item.kind]}</p>
      <dl className="ss-meta">
        <div>
          <dt>Developer</dt>
          <dd>{item.authors?.join(", ") || item.repo || "Local import"}</dd>
        </div>
        <div>
          <dt>Compatibility</dt>
          <dd>Untested on this Spotify build</dd>
        </div>
        {sameListing && (
          <div className="ss-meta-wide">
            <dt>Selected revision</dt>
            <dd>
              <code>{revisionLabel(rec.item, rec.selected)}</code> · {manager.status(rec)}
            </dd>
          </div>
        )}
        {item.dependencies?.length > 0 && (
          <div className="ss-meta-wide">
            <dt>Requires</dt>
            <dd>{item.dependencies.join(", ")}</dd>
          </div>
        )}
        {sameListing && (rec.codeScope === "runtime" || rec.codeScope === "captured") && (
          <div className="ss-meta-wide">
            <dt>Executable files</dt>
            <dd>{rec.codeScope === "runtime"
              ? "This package can load more code at runtime. Pinning, rollback and backups cover its stored files. The store cannot verify that the external feature started."
              : "The downloaded script and its loader are stored together in this revision."}</dd>
          </div>
        )}
        {sameListing && !!rec.skippedSchemes?.length && (
          <div className="ss-meta-wide">
            <dt>Skipped color schemes</dt>
            <dd>{rec.skippedSchemes.join(". ")}</dd>
          </div>
        )}
      </dl>
      {repo && (
        <div className="ss-links">
          <a className="ss-btn ss-sm" href={repo} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} />
            View source
          </a>
          {item.readme && (
            <a className="ss-btn ss-sm" href={item.readme} target="_blank" rel="noreferrer">
              <Icon name="external" size={15} />
              Readme
            </a>
          )}
        </div>
      )}
      {rec && !sameListing && (
        <p className="ss-note">This package is installed as {rec.item.name}. Remove it from Installed to choose this listing.</p>
      )}
      {!rec && (
        <>
          <p className="ss-note ss-note-warn">
            {item.kind === "snippet"
              ? "Installing applies this CSS to Spotify."
              : "Installing enables this package inside Spotify. Only install code from a source you trust."}
          </p>
          <button
            className="ss-primary ss-block"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await manager.install(item);
                close();
              }, "Installed " + item.name, openRelease)
            }
          >
            <Icon name="download" size={17} stroke={2.4} />
            Install {kindName[item.kind].toLowerCase()}
          </button>
        </>
      )}
    </>
  );
}
export function Store({ manager: m }) {
  const { useState, useEffect, useReducer, useRef } = m.host.React;
  const [, refresh] = useReducer((n) => n + 1, 0);
  const [tab, setTab] = useState("Browse"),
    [kind, setKind] = useState("extension"),
    [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState({ items: [], page: 0 }),
    [loading, setLoading] = useState(false),
    [catalogError, setCatalogError] = useState("");
  const [dialog, setDialog] = useState(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [address, setAddress] = useState(""),
    [found, setFound] = useState([]),
    [name, setName] = useState(""),
    [snippet, setSnippet] = useState("");
  const version = useRef(0),
    busyRef = useRef(false),
    listRef = useRef(null),
    movedRef = useRef(null);
  const [shownDialog, dialogLeaving] = usePresence(dialog, 220);
  const [shownMessage, messageLeaving] = usePresence(message, 240);
  useFlip(listRef, movedRef);
  useEffect(() => m.subscribe(refresh), [m]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 5200);
    return () => clearTimeout(timer);
  }, [message]);
  function close() {
    setDialog(null);
    setError("");
  }
  async function run(fn, success, onRelease) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      if (success) setMessage(success);
    } catch (e) {
      if (onRelease && e instanceof ReleaseFileRequired) onRelease(e);
      else setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function browse(category, page = 1, force = false) {
    const seq = ++version.current;
    setLoading(true);
    setCatalogError("");
    if (page === 1) setCatalog({ items: [], page: 0 });
    try {
      const result = await m.browse(category, page, force);
      if (seq !== version.current) return;
      setCatalog((prev) => ({
        items: mergeCatalogItems([...(page === 1 ? [] : prev.items), ...result.items]),
        more: result.more,
        page,
      }));
      setCatalogError(
        result.warning || (result.partial ? "Some repository manifests could not be read." : ""),
      );
    } catch (e) {
      if (seq === version.current) setCatalogError(e.message);
    } finally {
      if (seq === version.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (tab === "Browse" && m.db) browse(kind);
    return () => {
      version.current++;
    };
  }, [tab, kind, !!m.db]);
  const importDialog = () => {
    setAddress("");
    setFound([]);
    setError("");
    setDialog({ type: "import" });
  };
  const editSnippet = (rec) =>
    run(async () => {
      setName(rec?.item.name || "");
      setSnippet(rec ? (await m.db.package(rec.selected)).files.find((f) => f.role === "style").text : "");
      setDialog({ type: "snippet", id: rec?.item.id });
    });
  const show = (item) => {
    setError("");
    setDialog({ type: "details", item });
  };
  const openRelease = (request, candidate) => {
    setError("");
    setDialog({ type: "release", request, candidate });
  };
  const matches = (i) =>
    [i.name, i.repo, i.description, ...(i.authors || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const installed = m.state.installs,
    installedListings = new Set(installed.map((r) => listingKey(r.item)));
  const browseItems = mergeCatalogItems([
    ...(kind === "extension" ? m.starter() : []),
    ...m.sourceItems(kind),
    ...catalog.items,
  ]).filter((item) => !excludedFromListings(item) && matches(item));
  const changeTab = (t) => {
    setTab(t);
    setQuery("");
    setError("");
    setMessage("");
  };
  const card = (item, index) => {
    const key = listingKey(item);
    return <ItemCard key={key} index={index} item={item} installed={installedListings.has(key)} open={show} />;
  };
  const notice = error ? (
    <p role="alert" className="ss-error">
      {error}
    </p>
  ) : null;
  const d = shownDialog;
  const dialogProps = d && {
    details: { title: d.item?.name, media: d.item && <Artwork item={d.item} size="hero" /> },
    release: { title: d.request?.item.name + " " + d.request?.release.tag },
    import: { title: "Import a package" },
    snippet: { title: d.id ? "Edit CSS snippet" : "Create CSS snippet", wide: true },
    remove: { title: "Remove package", icon: "trash", tone: "danger" },
    apply: { title: "Apply setup profile", icon: "layers", tone: "accent" },
    "delete-profile": { title: "Delete profile", icon: "trash", tone: "danger" },
    "disable-all": { title: "Disable installed packages", icon: "power", tone: "warn" },
  }[d.type];
  return (
    <section className="ss-store" aria-busy={busy} aria-label="Spicetify Store">
      <header className="ss-hero">
        <h1>Spicetify Store</h1>
        <p>Community extensions, themes, and tools for Spotify.</p>
      </header>
      <Tabs tab={tab} onChange={changeTab} installed={installed.length} updates={m.candidates.size} />
      {m.phase !== "Ready" && (
        <div className="ss-banner ss-banner-phase" role="status">
          <Icon name="info" size={18} />
          <span>{m.phase}</span>
          {m.paused && (
            <button className="ss-sm ss-primary" onClick={() => m.setPaused(false)}>
              Resume and reload
            </button>
          )}
        </div>
      )}
      {m.reloadNeeded && (
        <div className="ss-banner ss-banner-reload" role="status">
          <Icon name="refresh" size={18} />
          <span>Reload Spotify to finish changing executable packages.</span>
          <button className="ss-sm ss-primary" onClick={() => location.reload()}>
            Reload Spotify
          </button>
        </div>
      )}
      {!dialog && notice}
      <div className="ss-view" key={tab}>
        {tab === "Browse" && (
          <>
            <div className="ss-toolbar">
              <label className="ss-search">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  aria-label="Search catalog"
                  placeholder="Search the catalog"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="ss-search-clear"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <Icon name="close" size={14} stroke={2.4} />
                  </button>
                )}
              </label>
              <button onClick={importDialog}>
                <Icon name="plus" size={17} stroke={2.4} />
                Import package
              </button>
            </div>
            <div className="ss-filters" aria-label="Content type">
              {Object.entries(kinds).map(([key, label]) => (
                <button
                  className={"ss-chip ss-" + key}
                  aria-pressed={kind === key}
                  key={key}
                  onClick={() => setKind(key)}
                >
                  <Icon name={key} size={15} stroke={2.1} />
                  {label}
                </button>
              ))}
            </div>
            <div className="ss-heading">
              <div className="ss-heading-title" key={kind}>
                <h2>{kinds[kind]}</h2>
                {!loading && browseItems.length > 0 && (
                  <span className="ss-count" aria-hidden="true">
                    {browseItems.length}
                  </span>
                )}
              </div>
              <button
                className={"ss-sm ss-ghost" + (loading ? " is-spinning" : "")}
                disabled={loading}
                onClick={() => browse(kind, 1, true)}
              >
                <Icon name="refresh" size={15} />
                Refresh catalog
              </button>
            </div>
            {kind === "extension" && (
              <div className="ss-note">Some developers have chosen to hide their extensions from SpotiKit’s catalog.</div>
            )}
            {catalogError && (
              <p className="ss-note" role="status">
                {catalogError}
              </p>
            )}
            <div className="ss-grid">
              {browseItems.map(card)}
              {loading &&
                Array.from({ length: browseItems.length ? 3 : 8 }, (_, n) => (
                  <Skeleton key={"skeleton" + n} index={n} />
                ))}
            </div>
            {!browseItems.length && !loading && (
              <Empty icon={query ? "search" : "box"}>
                {query
                  ? "No matches in the loaded catalog."
                  : "No catalog entries are available. You can import a package directly."}
              </Empty>
            )}
            {loading && (
              <p className="ss-sr" role="status">
                Loading community catalog…
              </p>
            )}
            {catalog.more && !loading && (
              <div className="ss-more">
                <button onClick={() => browse(kind, catalog.page + 1)}>Load more</button>
              </div>
            )}
          </>
        )}
        {tab === "Installed" && (
          <>
            <div className="ss-heading">
              <div className="ss-heading-title">
                <h2>Installed packages</h2>
              </div>
              <div className="ss-actions">
                <button className="ss-sm" onClick={() => editSnippet()}>
                  <Icon name="pen" size={15} />
                  Create snippet
                </button>
                <button className="ss-sm" onClick={importDialog}>
                  <Icon name="plus" size={16} stroke={2.4} />
                  Import package
                </button>
              </div>
            </div>
            {!installed.length && (
              <Empty>Your installed packages will appear here. Browse the catalog or import a script.</Empty>
            )}
            <div className="ss-list" ref={listRef}>
              {installed.map((r, index) => {
                const status = m.status(r);
                return (
                  <article
                    className={"ss-row" + (r.enabled ? "" : " is-off")}
                    key={r.item.id}
                    data-flip={r.item.id}
                    style={{ "--i": index }}
                  >
                    <Artwork item={r.item} size="row" />
                    <div className="ss-row-main">
                      <button className="ss-title" onClick={() => show(r.item)}>
                        {r.item.name}
                      </button>
                      <small className="ss-status" data-state={slug(status)}>
                        {kindName[r.item.kind]} · {status}
                      </small>
                      {m.errors.has(r.item.id) && <p className="ss-error">{m.errors.get(r.item.id)}</p>}
                      {!!r.schemes?.length && (
                        <label className="ss-field-inline">
                          <span>Color scheme</span>
                          <select
                            value={r.scheme}
                            onChange={(e) => run(() => m.scheme(r.item.id, e.target.value))}
                          >
                            {r.schemes.map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <div className="ss-row-actions">
                      {r.item.kind === "app" && m.runtime.active.get(r.item.id)?.route && (
                        <button
                          className="ss-sm"
                          onClick={() => m.host.Apps.open(m.runtime.active.get(r.item.id).route)}
                        >
                          <Icon name="open" size={15} />
                          Open app
                        </button>
                      )}
                      {r.item.kind === "snippet" && !r.item.source && (
                        <button className="ss-sm" onClick={() => editSnippet(r)}>
                          <Icon name="pen" size={15} />
                          Edit CSS
                        </button>
                      )}
                      <span className="ss-order">
                        <button
                          className="ss-icon-btn"
                          aria-label={"Move " + r.item.name + " earlier"}
                          disabled={!index || busy}
                          onClick={() =>
                            run(() => {
                              movedRef.current = r.item.id;
                              return m.move(r.item.id, -1);
                            })
                          }
                        >
                          <Icon name="up" size={16} />
                        </button>
                        <button
                          className="ss-icon-btn"
                          aria-label={"Move " + r.item.name + " later"}
                          disabled={index === installed.length - 1 || busy}
                          onClick={() =>
                            run(() => {
                              movedRef.current = r.item.id;
                              return m.move(r.item.id, 1);
                            })
                          }
                        >
                          <Icon name="down" size={16} />
                        </button>
                      </span>
                      <button
                        className={"ss-sm ss-toggle" + (r.enabled ? "" : " ss-primary")}
                        disabled={busy}
                        onClick={() => run(() => m.enable(r.item.id, !r.enabled))}
                      >
                        {r.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="ss-sm ss-ghost ss-danger"
                        onClick={() => setDialog({ type: "remove", rec: r })}
                      >
                        <Icon name="trash" size={15} />
                        Remove
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {tab === "Updates" && (
          <>
            <div className="ss-heading">
              <div className="ss-heading-title">
                <h2>Package updates</h2>
              </div>
              <button
                className={"ss-sm" + (busy ? " is-spinning" : "")}
                disabled={busy}
                onClick={() => run(() => m.checkAll(), "Update check complete.")}
              >
                <Icon name="refresh" size={15} />
                Check for updates
              </button>
            </div>
            {!installed.length && (
              <Empty icon="refresh">Install a package to see its revisions and update settings.</Empty>
            )}
            <div className="ss-list">
              {installed.map((r, index) => {
                const id = r.item.id,
                  c = m.candidates.get(id);
                return (
                  <article className={"ss-row" + (c ? " has-update" : "")} key={id} style={{ "--i": index }}>
                    <Artwork item={r.item} size="row" />
                    <div className="ss-row-main">
                      <strong className="ss-row-title">{r.item.name}</strong>
                      <div className="ss-revs">
                        <span>
                          Selected <code>{revisionLabel(r.item, r.selected)}</code>
                        </span>
                        {m.runtime.executed.get(id) && (
                          <span>
                            Last executed <code>{short(m.runtime.executed.get(id))}</code>
                          </span>
                        )}
                        {c && (
                          <span className="ss-rev-new">
                            Available <code>{c.request?.release.tag || revisionLabel(c.pkg.item, c.pkg.digest)}</code>
                          </span>
                        )}
                      </div>
                      {r.item.source && (
                        <div className="ss-switches">
                          <label className="ss-switch">
                            <input
                              type="checkbox"
                              checked={r.pinned}
                              onChange={(e) => run(() => m.preference(id, "pinned", e.target.checked))}
                            />
                            <span>{r.codeScope === "runtime" ? "Pin stored files only" : "Pin revision"}</span>
                          </label>
                          <label className="ss-switch">
                            <input
                              type="checkbox"
                              checked={r.auto}
                              onChange={(e) => run(() => m.preference(id, "auto", e.target.checked))}
                            />
                            <span>Auto-update</span>
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="ss-row-actions">
                      {r.item.source && (
                        <button className="ss-sm" onClick={() => run(() => m.check(id), "Checked " + r.item.name)}>
                          Check
                        </button>
                      )}
                      {c && (
                        <button
                          className="ss-sm ss-primary"
                          disabled={r.pinned || busy}
                          onClick={() => c.request ? openRelease(c.request, c) : run(() => m.update(id), "Update installed.")}
                        >
                          {c.request ? "Update from ZIP" : "Update"}
                        </button>
                      )}
                      {r.previous && (
                        <button
                          className="ss-sm ss-ghost"
                          onClick={() => run(() => m.rollback(id), "Previous revision selected.")}
                        >
                          Roll back
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {tab === "Profiles" && (
          <>
            <div className="ss-heading">
              <div className="ss-heading-title">
                <h2>Setup profiles</h2>
              </div>
              {fileInput(
                "Import profile",
                ".json",
                (f) => run(async () => m.importProfile(await readJson(f)), "Profile imported."),
                { className: "ss-sm" },
              )}
            </div>
            <p className="ss-muted">Save the current package order, enabled items, revisions, and theme scheme.</p>
            <form
              className="ss-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await m.saveProfile(name);
                  setName("");
                }, "Profile saved.");
              }}
            >
              <input
                aria-label="Profile name"
                placeholder="Profile name"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="ss-primary" disabled={!name.trim() || busy}>
                Save current setup
              </button>
            </form>
            {!m.state.profiles.length && (
              <Empty icon="layers">Saved profiles let you switch between complete setups in one step.</Empty>
            )}
            <div className="ss-list">
              {m.state.profiles.map((p, index) => (
                <article className="ss-row" key={p.id} style={{ "--i": index }}>
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="layers" size={22} stroke={1.8} />
                  </span>
                  <div className="ss-row-main">
                    <strong className="ss-row-title">{p.name}</strong>
                    <small className="ss-muted">{p.items.length} packages</small>
                  </div>
                  <div className="ss-row-actions">
                    <button className="ss-sm ss-primary" onClick={() => setDialog({ type: "apply", profile: p })}>
                      Apply profile
                    </button>
                    <button
                      className="ss-sm"
                      onClick={() =>
                        downloadJson("spicetify-profile", {
                          format: "spicetify-store-profile",
                          version: 1,
                          profile: p,
                        })
                      }
                    >
                      <Icon name="download" size={15} />
                      Export
                    </button>
                    <button
                      className="ss-sm ss-ghost ss-danger"
                      onClick={() => setDialog({ type: "delete-profile", profile: p })}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "Settings" && (
          <>
            <div className="ss-heading">
              <div className="ss-heading-title">
                <h2>Store settings</h2>
              </div>
            </div>
            <div className="ss-settings">
              <section className="ss-setting" style={{ "--i": 0 }}>
                <div className="ss-setting-head">
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="refresh" size={19} />
                  </span>
                  <h3>Updates</h3>
                </div>
                <p>Look for newer revisions of installed packages when Spotify starts.</p>
                <label className="ss-switch">
                  <input
                    type="checkbox"
                    checked={m.state.autoCheck}
                    onChange={(e) => run(() => m.autoCheck(e.target.checked))}
                  />
                  <span>Check for updates at startup</span>
                </label>
              </section>
              <section className="ss-setting" style={{ "--i": 1 }}>
                <div className="ss-setting-head">
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="link" size={19} />
                  </span>
                  <h3>Catalog sources</h3>
                </div>
                <p>Save a repository or manifest to include its entries in Browse.</p>
                {(m.state.sources || []).length > 0 && (
                  <ul className="ss-sources">
                    {m.state.sources.map((src) => (
                      <li className="ss-source" key={src.address}>
                        <span>{src.address}</span>
                        <div className="ss-actions">
                          <button
                            className="ss-sm ss-ghost"
                            onClick={() => run(() => m.saveSource(src.address), "Source refreshed.")}
                          >
                            Refresh source
                          </button>
                          <button
                            className="ss-sm ss-ghost ss-danger"
                            onClick={() => run(() => m.forgetSource(src.address), "Source removed.")}
                          >
                            Remove source
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="ss-actions">
                  <button className="ss-sm" onClick={importDialog}>
                    <Icon name="plus" size={16} stroke={2.4} />
                    Add a source
                  </button>
                </div>
              </section>
              <section className="ss-setting" style={{ "--i": 2 }}>
                <div className="ss-setting-head">
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="archive" size={19} />
                  </span>
                  <h3>Backup and migration</h3>
                </div>
                <p>
                  Backups include cached packages, revisions, and profiles. Newly restored packages start
                  disabled.
                </p>
                <div className="ss-actions">
                  <button
                    className="ss-sm"
                    onClick={() => run(async () => downloadJson("spicetify-store-backup", await m.backup()))}
                  >
                    <Icon name="download" size={15} />
                    Export backup
                  </button>
                  {fileInput(
                    "Import backup",
                    ".json",
                    (f) =>
                      run(
                        async () => m.importBackup(await readJson(f)),
                        "Backup merged. New packages are disabled.",
                      ),
                    { className: "ss-sm" },
                  )}
                  <button
                    className="ss-sm ss-ghost"
                    onClick={() => run(() => m.migrate(), "Surviving legacy packages imported disabled.")}
                  >
                    Recover old installs
                  </button>
                </div>
              </section>
              <section className="ss-setting" style={{ "--i": 3 }}>
                <div className="ss-setting-head">
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="power" size={19} />
                  </span>
                  <h3>Startup and recovery</h3>
                </div>
                <p>
                  Pause legacy startup to open Spotify with only the store manager. Reloading ends the current
                  playback session in this window.
                </p>
                <div className="ss-actions">
                  <button className="ss-sm" onClick={() => m.setPaused(!m.paused)}>
                    {m.paused ? "Resume and reload" : "Pause and reload"}
                  </button>
                  <button className="ss-sm ss-ghost ss-danger" onClick={() => setDialog({ type: "disable-all" })}>
                    Disable all packages
                  </button>
                  <button
                    className="ss-sm ss-ghost"
                    onClick={() => downloadJson("spicetify-store-diagnostics", m.report())}
                  >
                    Export diagnostics
                  </button>
                </div>
              </section>
              <section className="ss-setting" style={{ "--i": 4 }}>
                <div className="ss-setting-head">
                  <span className="ss-tile" aria-hidden="true">
                    <Icon name="info" size={19} />
                  </span>
                  <h3>Licenses and source</h3>
                </div>
                <p>
                  Spicetify Store {manifest.version} © 2026 Spicetify Store contributors. Includes work by
                  NMWplays, the SpotiKit contributors and the Spicetify contributors. You may modify and
                  share this software under the included licenses. It comes without warranty.
                </p>
                <div className="ss-actions">
                  <button className="ss-sm" onClick={downloadLicenses}>Download licenses</button>
                  <button className="ss-sm" onClick={downloadSource}>Download source</button>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
      <div className="ss-toasts">
        <div className="ss-toast-stack">
          {busy && (
            <p className="ss-toast ss-toast-busy" role="status">
              Working…
            </p>
          )}
          {shownMessage && (
            <p role="status" className={"ss-toast ss-toast-ok" + (messageLeaving ? " ss-leaving" : "")}>
              {shownMessage}
            </p>
          )}
        </div>
      </div>
      {d && (
        <Dialog key={d.type} {...dialogProps} close={close} leaving={dialogLeaving}>
          {dialog && notice}
          {d.type === "details" && <Choices manager={m} item={d.item} run={run} close={close} busy={busy} openRelease={openRelease} />}
          {d.type === "release" && (
            <>
              <p className="ss-lede">{d.request.message} Download the publisher’s ZIP, then select it here.</p>
              <div className="ss-links">
                {d.request.release.assets.map((asset) => (
                  <a key={asset.key} className="ss-btn ss-sm" href={asset.url} target="_blank" rel="noreferrer">
                    <Icon name="download" size={16} />{asset.name}
                  </a>
                ))}
              </div>
              {fileInput(d.candidate ? "Apply downloaded ZIP" : "Install downloaded ZIP", ".zip", (file) =>
                run(async () => {
                  if (d.candidate) await m.update(d.request.item.id, d.candidate, file);
                  else await m.installReleaseFile(d.request, file);
                  close();
                }, "Installed " + d.request.item.name + " " + d.request.release.tag), { disabled: busy })}
            </>
          )}
          {d.type === "import" && (
            <>
              <p className="ss-lede">Enter a GitHub repository, manifest, or direct JavaScript, CSS, or app ZIP link.</p>
              <form
                className="ss-import-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => setFound(await m.lookup(address)));
                }}
              >
                <label>
                  Package source
                  <input
                    autoFocus
                    placeholder="owner/repository or https://…"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setFound([]);
                    }}
                  />
                </label>
                <button disabled={!address.trim() || busy} className="ss-primary">
                  <Icon name="search" size={16} stroke={2.4} />
                  Find packages
                </button>
              </form>
              {found.length > 0 && (
                <div className="ss-found-list">
                  {found.map((i, n) => (
                    <button className="ss-found" key={listingKey(i)} style={{ "--i": n }} onClick={() => show(i)}>
                      <span className={"ss-found-icon ss-" + i.kind}>
                        <Icon name={i.kind} size={16} />
                      </span>
                      <span className="ss-found-name">
                        {i.name} · {kindName[i.kind]}
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                  <button
                    className="ss-sm ss-ghost"
                    onClick={() =>
                      run(async () => {
                        await m.saveSource(address);
                        close();
                      }, "Catalog source saved.")
                    }
                  >
                    <Icon name="link" size={15} />
                    Save catalog source
                  </button>
                </div>
              )}
              <div className="ss-or">or</div>
              <div className="ss-local">
                <p>Choosing a local file installs and enables it in Spotify.</p>
                {fileInput("Install local file", ".js,.mjs,.css,.zip", (f) =>
                  run(async () => {
                    await m.importFile(f);
                    close();
                  }, "Installed " + f.name),
                )}
              </div>
            </>
          )}
          {d.type === "snippet" && (
            <form
              className="ss-snippet-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await m.snippet(name, snippet, d.id);
                  close();
                  setName("");
                }, "Snippet saved.");
              }}
            >
              <label>
                Name
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                CSS
                <textarea
                  rows="10"
                  spellCheck="false"
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value)}
                />
              </label>
              <button className="ss-primary ss-block" disabled={busy || !name.trim() || !snippet.trim()}>
                Save snippet
              </button>
            </form>
          )}
          {d.type === "remove" && (
            <Confirm
              tone="danger"
              text={"Remove " + d.rec.item.name + " from this store?"}
              action="Remove package"
              busy={busy}
              close={close}
              onConfirm={() =>
                run(async () => {
                  await m.remove(d.rec.item.id);
                  close();
                }, "Package removed.")
              }
            />
          )}
          {d.type === "apply" && (
            <Confirm
              text={"Apply " + d.profile.name + " and enable its selected packages in Spotify?"}
              action="Apply and enable"
              busy={busy}
              close={close}
              onConfirm={() =>
                run(async () => {
                  await m.applyProfile(d.profile.id);
                  close();
                }, "Profile applied.")
              }
            />
          )}
          {d.type === "delete-profile" && (
            <Confirm
              tone="danger"
              text={"Delete " + d.profile.name + " from your saved profiles?"}
              action="Delete profile"
              busy={busy}
              close={close}
              onConfirm={() =>
                run(async () => {
                  await m.deleteProfile(d.profile.id);
                  close();
                }, "Profile deleted.")
              }
            />
          )}
          {d.type === "disable-all" && (
            <Confirm
              tone="danger"
              text="Disable every package managed by this store?"
              action="Disable all"
              busy={busy}
              close={close}
              onConfirm={() =>
                run(async () => {
                  await m.disableAll();
                  close();
                }, "Packages disabled.")
              }
            />
          )}
        </Dialog>
      )}
    </section>
  );
}
