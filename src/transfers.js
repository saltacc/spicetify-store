import { makePackage, validateItem, localItem } from "./packages.js";
import { isDigest, retainedCompatibility } from "./compatibility.js";

export function validateProfile(profile) {
  if (
    !profile ||
    typeof profile.name !== "string" ||
    !profile.name.trim() ||
    profile.name.length > 100 ||
    !Array.isArray(profile.items) ||
    profile.items.length > 500
  )
    throw new Error("Invalid setup profile.");
  const ids = new Set();
  const items = profile.items.map((entry) => {
    const item = validateItem(entry.item);
    if (ids.has(item.id) || !isDigest(entry.selected))
      throw new Error("A profile contains duplicate items or an invalid revision.");
    ids.add(item.id);
    const compatibility = retainedCompatibility({ selected: entry.selected, compatibility: entry.compatibility });
    return {
      item,
      selected: entry.selected,
      enabled: entry.enabled === true,
      scheme: typeof entry.scheme === "string" ? entry.scheme : "",
      pinned: entry.pinned === true,
      auto: entry.auto === true,
      ...(Object.keys(compatibility).length ? { compatibility } : {}),
    };
  });
  if (items.filter((r) => r.enabled && r.item.kind === "theme").length > 1)
    throw new Error("A profile may select one theme.");
  return {
    id: typeof profile.id === "string" ? profile.id : crypto.randomUUID(),
    name: profile.name.trim(),
    items,
  };
}
export function snapshot(name, installs) {
  return validateProfile({ name, items: installs, id: crypto.randomUUID() });
}
export async function decodeBackup(data) {
  if (
    data?.format !== "spicetify-store-backup" ||
    data.version !== 1 ||
    !Array.isArray(data.packages) ||
    data.packages.length > 1000 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 100
  )
    throw new Error("Unsupported store backup.");
  const packages = [],
    byDigest = new Map();
  for (const stored of data.packages) {
    const pkg = await makePackage(stored.item, stored.files, stored.revision);
    if (pkg.digest !== stored.digest) throw new Error("Backup integrity check failed for " + pkg.item.name);
    packages.push(pkg);
    byDigest.set(pkg.digest, pkg);
  }
  const profiles = data.profiles.map(validateProfile);
  const { items } = validateProfile({ name: "Backup", items: data.installs });
  function requirePackage(id, key) {
    const pkg = byDigest.get(key);
    if (!pkg || pkg.item.id !== id) throw new Error("Backup is missing a matching package revision.");
    return pkg;
  }
  // Imported profile recipes may refer to revisions that have never been downloaded here.
  for (const p of profiles)
    for (const r of p.items) if (byDigest.has(r.selected)) requirePackage(r.item.id, r.selected);
  const installs = items.map((r, index) => {
    const pkg = requirePackage(r.item.id, r.selected),
      previous = data.installs[index].previous;
    if (previous) requirePackage(r.item.id, previous);
    const compatibility = retainedCompatibility({ ...data.installs[index], selected: r.selected, previous });
    return {
      ...r,
      item: pkg.item,
      previous: previous || null,
      ...(Object.keys(compatibility).length ? { compatibility } : {}),
      enabled: false,
      previousScheme:
        typeof data.installs[index].previousScheme === "string" ? data.installs[index].previousScheme : "",
      auto: false,
    };
  });
  const sources = data.sources || [];
  if (!Array.isArray(sources) || sources.length > 256) throw new Error("Invalid catalog source list.");
  for (const src of sources) {
    if (
      typeof src.address !== "string" ||
      src.address.length > 4096 ||
      !Array.isArray(src.items) ||
      src.items.length > 500
    )
      throw new Error("Invalid catalog source.");
    src.items.forEach(validateItem);
  }
  return { packages, installs, profiles, sources, autoCheck: data.autoCheck !== false };
}

const read = (db, store, key) =>
  new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export async function readLegacy() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("spotikit-marketplace");
    req.onupgradeneeded = () => req.transaction.abort();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => (req.error?.name === "AbortError" ? resolve(null) : reject(req.error));
  });
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains("files") || !db.objectStoreNames.contains("state")) return [];
    const installs = (await read(db, "state", "installed")) || {};
    const entries = [];
    for (const [id, record] of Object.entries(installs))
      if (record.item?.origin === "spicetify") {
        const cached = await read(db, "files", id + "|current");
        if (cached) entries.push({ id, record, files: cached.files || cached });
      }
    return await decodeLegacy({ version: 1, format: "spicetify-store-legacy", installs: entries });
  } finally {
    db.close();
  }
}

export async function decodeLegacy(data) {
  if (
    data?.format !== "spicetify-store-legacy" ||
    data.version !== 1 ||
    !Array.isArray(data.installs) ||
    data.installs.length > 500
  )
    throw new Error("Unsupported legacy export.");
  const roles = {
    main: "script",
    include: "script",
    usercss: "style",
    snippet: "style",
    schemes: "schemes",
    "app-main": "app",
    "app-sub": "subfile",
    "app-extension": "script",
    "app-style": "style",
  };
  const packages = [];
  for (const { id, record, files: list } of data.installs) {
    if (record?.item?.origin !== "spicetify" || !Array.isArray(list)) continue;
    const files = list
      .filter((f) => Object.hasOwn(roles, f.role) && typeof f.text === "string")
      .map((f) => ({ role: roles[f.role], path: f.url || f.role, text: f.text }));
    if (!files.length) continue;
    const item = localItem(record.item.name, record.kind, "legacy-" + id);
    item.route = list.find((f) => f.role === "app-name")?.text;
    item.description = record.item.description || "";
    item.repo = record.item.source?.repo;
    packages.push(await makePackage(item, files, record.version || ""));
  }
  return packages;
}
