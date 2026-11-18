import { httpsUrl, json } from "./catalog.js";

export function appSlug(value) {
  return String(value || "").normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

export function appNames(item) {
  const names = [item.name, item.route];
  // A catalog can use a display name and link its README from the actual app folder.
  if (item.readme && item.base) {
    const base = new URL(".", item.base);
    if (item.readme.startsWith(base.href)) {
      const parts = new URL(item.readme).pathname.slice(base.pathname.length).split("/");
      if (parts.length > 1) names.push(parts.at(-2));
    }
  }
  return new Set(names.map(appSlug).filter(Boolean));
}

// Prefer the most specific whole app name, e.g. "Stats Plus" before "Stats".
function ownersOf(label, catalog) {
  const text = "-" + appSlug(label) + "-";
  const owners = new Set();
  let longest = 0;
  for (const [id, names] of catalog) {
    for (const name of names) {
      if (name.length < longest || !text.includes("-" + name + "-")) continue;
      if (name.length > longest) owners.clear();
      longest = name.length;
      owners.add(id);
    }
  }
  return owners;
}

function assetsFor(release, id, catalog) {
  const named = [], unnamed = [];
  for (const asset of release.assets || []) {
    if (!/\.zip$/i.test(asset.name)) continue;
    const owners = ownersOf(asset.name.slice(0, -4), catalog);
    if (owners.size === 1 && owners.has(id)) named.push(asset);
    else if (!owners.size) unnamed.push(asset);
  }
  if (named.length) return named;
  const owners = ownersOf(release.tag_name + " " + (release.name || ""), catalog);
  if (owners.size && (owners.size !== 1 || !owners.has(id))) return [];
  return unnamed;
}

export async function findAppRelease(item, apps, signal) {
  const catalog = new Map(apps.map((app) => [app.id, appNames(app)]));
  const url = "https://api.github.com/repos/" + item.repo + "/releases?per_page=30&page=";
  for (let page = 1; ; page++) {
    const releases = await json(url + page, { signal });
    for (const release of releases) {
      if (release.draft || !release.tag_name) continue;
      const matching = assetsFor(release, item.id, catalog);
      if (matching.length) {
        const assets = matching.filter((a) => !a.state || a.state === "uploaded");
        if (!assets.length) throw new Error("The release ZIP for " + item.name + " " + release.tag_name + " is still being uploaded.");
        return {
          tag: release.tag_name,
          shared: catalog.size > 1,
          assets: assets.map((a) => ({
            name: a.name, url: httpsUrl(a.browser_download_url), size: a.size, digest: a.digest,
            key: JSON.stringify([a.id, a.name, a.digest || a.updated_at, a.size]),
          })),
        };
      }
    }
    if (releases.length < 30) return null;
  }
}

export class ReleaseFileRequired extends Error {
  constructor(item, release) {
    super(release.assets.length === 1
      ? "Spotify could not download " + release.assets[0].name + " for " + item.name + " " + release.tag + "."
      : "Choose the release ZIP for " + item.name + " " + release.tag + ".");
    this.item = item;
    this.release = release;
    this.key = JSON.stringify([item.id, release.tag, release.assets.map((asset) => asset.key).sort()]);
  }
  includes(item) {
    return item.revision === this.release.tag && this.release.assets.some((a) => a.key === item.releaseAsset);
  }
}
