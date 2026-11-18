const utf8 = new TextDecoder();

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return utf8.decode(bytes);
}

export async function readText(blob) {
  return decodeText(new Uint8Array(await blob.arrayBuffer()));
}

export function relativePath(path) {
  if (typeof path !== "string") throw new Error("Invalid package path.");
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("\0") || /^[a-z]:/i.test(normalized) ||
      normalized.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid package path: " + path);
  return normalized;
}

// Prefer an exact spelling. A folded name resolves only when it identifies one file.
export function pathLookup(paths) {
  const folded = new Map();
  for (const path of paths.keys()) {
    const key = path.toLowerCase();
    folded.set(key, folded.has(key) ? null : path);
  }
  return (path) => paths.has(path) ? path : folded.get(path.toLowerCase());
}
