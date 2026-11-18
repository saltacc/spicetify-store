import { parse } from "acorn";
import { isSpicyLyrics, spicyLyricsRelease } from "./compat/spicy-lyrics.js";
import { executable, inspectScript, isModuleFile } from "./loaders.js";

export const compatibilityUrl = "https://compat.5417.moe/v1/extensions.json";
export const isDigest = (value) => typeof value === "string" && /^[a-f\d]{64}$/.test(value);

export function readCompatibilityRules(feed) {
  if (feed?.version !== 1 || !Array.isArray(feed.extensions) || feed.extensions.length > 512)
    throw new Error("Invalid compatibility list.");
  const rules = new Map();
  for (const entry of feed.extensions) {
    const { id, revisions } = entry ?? {};
    if (typeof id !== "string" || !id.trim() || id.length > 4096 || rules.has(id) ||
        !Array.isArray(revisions) || !revisions.length || revisions.length > 32 || !revisions.every(isDigest))
      throw new Error("Invalid compatibility entry.");
    rules.set(id, new Set(revisions));
  }
  return rules;
}

export function compatibilityModule(pkg) {
  if (pkg.item.kind !== "extension") return null;
  const files = pkg.files.filter(executable);
  const [file] = files;
  if (files.length !== 1 || !isModuleFile(file)) return null;
  if (isSpicyLyrics(pkg.item)) return file.path === spicyLyricsRelease.path ? file : null;
  const inspection = inspectScript(file);
  if (inspection.external || inspection.needsOrigin) return null;
  try {
    parse("const window = undefined;\n" + file.text, { sourceType: "module", ecmaVersion: "latest" });
    return file;
  } catch {
    return null;
  }
}

export function retainedCompatibility(record) {
  return Object.fromEntries([record.selected, record.previous]
    .filter((revision) => isDigest(revision) && typeof record.compatibility?.[revision] === "boolean")
    .map((revision) => [revision, record.compatibility[revision]]));
}
