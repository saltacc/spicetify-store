import bundledExclusions from "../data/exclusions.json" with { type: "json" };

export const topics = { extension: "spicetify-extensions", theme: "spicetify-themes", app: "spicetify-apps" };
export const upstream = "https://raw.githubusercontent.com/spicetify/marketplace/main/";
const gh = "https://api.github.com/repos/";
export const initialExclusions = bundledExclusions.repos;
export const MAX_BYTES = 24 * 1024 * 1024;
export function httpsUrl(path, base) {
  const url = new URL(path, base);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use a public HTTPS address.");
  return url.href;
}
export function repoName(input) {
  const text = String(input)
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(text) && text.split("/").every((x) => x !== "." && x !== "..")
    ? text
    : null;
}
export function excluded(item, rules) {
  const sources = [item.repo, item.source, ...(item.spec || []).map((f) => f.path)];
  const repos = sources
    .filter(Boolean)
    .map((value) => {
      const raw = String(value).match(
        /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/([^/]+\/[^/]+)/i,
      );
      return (raw ? raw[1] : value).toLowerCase().split("/");
    })
    .filter((parts) => parts.length === 2);
  return rules.some((rule) => {
    if (typeof rule !== "string" || !rule.startsWith("https://github.com/")) return false;
    const parts = rule.slice(19).replace(/\/$/, "").toLowerCase().split("/");
    return repos.some((actual) => parts.length === 2 && parts.every((v, i) => v === "*" || v === actual[i]));
  });
}

export async function download(url, { signal, limit = MAX_BYTES, optional = false } = {}) {
  const address = httpsUrl(url);
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(address, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const retry = reset > Date.now() ? " Try again after " + new Date(reset).toLocaleTimeString() + "." : "";
    throw new Error(new URL(address).hostname + " returned HTTP " + response.status + "." + retry);
  }
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Download exceeds the package size limit.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Download exceeds the package size limit.");
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "" });
}
export async function json(url, options) {
  const blob = await download(url, { limit: 4 * 1024 * 1024, ...options });
  return blob ? JSON.parse(await blob.text()) : null;
}
export function raw(repo, ref, path = "") {
  return (
    "https://raw.githubusercontent.com/" +
    repo +
    "/" +
    ref.split("/").map(encodeURIComponent).join("/") +
    "/" +
    path.split("/").map(encodeURIComponent).join("/")
  );
}
export async function commit(repo, ref, signal) {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const record = await json(gh + repo + "/commits/" + encodeURIComponent(ref), { signal });
  if (!/^[0-9a-f]{40}$/i.test(record?.sha)) throw new Error("Cannot pin " + repo + " to a commit.");
  return record.sha;
}
function strings(v) {
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && x.trim());
}
export function normalize(list, source) {
  const out = [];
  const entries = Array.isArray(list) ? list : [list];
  for (const e of entries) {
    if (!e || typeof e.name !== "string" || !e.name.trim()) continue;
    const kind = e.usercss
      ? "theme"
      : e.main
        ? "extension"
        : source.kind === "app" || e.subfiles || e.icon || e["active-icon"]
          ? "app"
          : null;
    if (!kind) continue;
    const spec = [];
    const take = (role, value) => strings(value).forEach((path) => spec.push({ role, path }));
    if (kind === "extension") take("script", e.main);
    if (kind === "theme") {
      take("style", e.usercss);
      take("schemes", e.schemes);
      take("script", e.include);
    }
    const branch = typeof e.branch === "string" && e.branch.trim() ? e.branch.trim() : source.branch;
    const base = source.repo
      ? new URL(source.manifestPath || "manifest.json", raw(source.repo, branch)).href
      : source.source;
    const preview = (path) => {
      try {
        return typeof path === "string" ? httpsUrl(path, base) : null;
      } catch {
        return null;
      }
    };
    const key = spec[0]?.path || e.name;
    out.push({
      id: [source.repo?.toLowerCase() || source.source, kind, encodeURIComponent(key)].join("|"),
      name: e.name.trim(),
      description: typeof e.description === "string" ? e.description : "",
      authors: (Array.isArray(e.authors) ? e.authors : [])
        .map((a) => (typeof a === "string" ? a : a?.name))
        .filter((a) => typeof a === "string"),
      preview: preview(e.preview),
      readme: preview(e.readme),
      spec,
      ...source,
      kind,
      branch,
      manifestBranch: source.manifestBranch || source.branch,
      base,
      version: typeof e.version === "string" ? e.version : "",
      dependencies: strings(e.dependencies),
      route: typeof e.id === "string" ? e.id : null,
    });
  }
  return out;
}
export async function fromInput(input, signal) {
  const value = input.trim();
  const repo = repoName(value);
  if (repo) {
    const info = await json(gh + repo, { signal });
    const source = {
      repo: info.full_name,
      branch: info.default_branch,
      kind: info.topics?.includes(topics.app) ? "app" : null,
      source: info.html_url,
      manifestPath: "manifest.json",
    };
    return normalize(await json(raw(repo, source.branch, "manifest.json"), { signal }), source);
  }
  let url = httpsUrl(value);
  const ghFile = new URL(url);
  if (ghFile.hostname === "github.com" && /^\/[^/]+\/[^/]+\/blob\//.test(ghFile.pathname))
    url = "https://raw.githubusercontent.com" + ghFile.pathname.replace("/blob/", "/");
  const path = new URL(url).pathname;
  if (/\.json$/i.test(path)) {
    const m =
      new URL(url).hostname === "raw.githubusercontent.com" &&
      path.match(/^\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/);
    return normalize(
      await json(url, { signal }),
      m
        ? { repo: m[1], branch: m[2], manifestPath: m[3], kind: "app", source: url }
        : { source: url, kind: "app" },
    );
  }
  if (/\.(?:m?js|css|zip)$/i.test(path)) {
    const file = decodeURIComponent(path.split("/").pop());
    const kind = /\.css$/i.test(file) ? "snippet" : /\.zip$/i.test(file) ? "app" : "extension";
    return [
      {
        id: "url|" + url,
        kind,
        name: file,
        description: "",
        authors: [],
        source: url,
        base: url,
        spec: [{ role: kind === "app" ? "archive" : kind === "snippet" ? "style" : "script", path: url }],
      },
    ];
  }
  throw new Error("Enter owner/repository, a manifest URL, or a direct JS, CSS or ZIP URL.");
}
export async function catalogPage(kind, page, signal) {
  if (kind === "snippet") {
    const entries = await json(upstream + "resources/snippets.json", { signal });
    return {
      more: false,
      items: entries
        .filter((s) => typeof s.title === "string" && typeof s.code === "string")
        .map((s) => ({
          id: "community-snippet|" + s.title,
          kind,
          name: s.title,
          description: s.description || "",
          authors: ["Spicetify Marketplace"],
          base: upstream + "resources/snippets.json",
          source: upstream + "resources/snippets.json",
          preview: s.preview ? httpsUrl(s.preview, upstream) : null,
          spec: [{ role: "style", path: "snippet.css", text: s.code }],
        })),
    };
  }
  const search = await json(
    "https://api.github.com/search/repositories?q=topic%3A" +
      topics[kind] +
      "&per_page=24&sort=stars&page=" +
      page,
    { signal },
  );
  const repos = search.items.filter((r) => !r.archived);
  const batches = new Array(repos.length);
  let idx = 0,
    firstError;
  await Promise.all(
    Array.from({ length: Math.min(5, repos.length) }, async () => {
      while (idx < repos.length) {
        const i = idx++,
          r = repos[i];
        try {
          const manifest = await json(raw(r.full_name, r.default_branch, "manifest.json"), {
            signal,
            optional: true,
          });
          batches[i] = normalize(manifest, {
            repo: r.full_name,
            branch: r.default_branch,
            source: r.html_url,
            kind,
            manifestPath: "manifest.json",
          });
        } catch (e) {
          firstError ||= e;
        }
      }
    }),
  );
  signal?.throwIfAborted();
  const items = batches.flat().filter((e) => e && e.kind === kind);
  if (!items.length && firstError) throw firstError;
  return {
    items,
    partial: !!firstError,
    more: page * 24 < Math.min(search.total_count, 1000) && search.items.length === 24,
  };
}
