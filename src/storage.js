const DB_NAME = "spotikit-spicetify-store";
const STATE_KEY = "library";

export function emptyState() {
  return {
    version: 1,
    sequence: 0,
    installs: [],
    profiles: [],
    sources: [],
    autoCheck: true,
    diagnostics: [],
  };
}

export async function openLibrary(name = DB_NAME) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      for (const store of ["state", "packages", "cache"]) req.result.createObjectStore(store);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close the other Spotify window and reopen the store."));
    req.onsuccess = () => resolve(req.result);
  });
  db.onversionchange = () => db.close();
  const get = (store, key) =>
    new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  function transaction(stores, write) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, "readwrite");
      let cause;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(cause || tx.error || new Error("Storage transaction was interrupted"));
      tx.onerror = () => {};
      const fail = (e) => {
        cause = e;
        tx.abort();
      };
      try {
        write(tx, fail);
      } catch (e) {
        fail(e);
      }
    });
  }
  return {
    async state() {
      return (await get("state", STATE_KEY)) || emptyState();
    },
    package: (id) => get("packages", id),
    cache: (key) => get("cache", key),
    putCache: (key, value) => transaction(["cache"], (tx) => tx.objectStore("cache").put(value, key)),
    save(state, packages = [], prune = false) {
      return transaction(["state", "packages"], (tx, fail) => {
        const library = tx.objectStore("state"),
          blobs = tx.objectStore("packages");
        const req = library.get(STATE_KEY);
        req.onsuccess = () => {
          if ((req.result?.sequence || 0) !== state.sequence - 1) {
            fail(new Error("The library changed in another window. Reopen the store and try again."));
            return;
          }
          for (const pkg of packages) blobs.put(pkg, pkg.digest);
          library.put(state, STATE_KEY);
          if (prune) {
            const kept = new Set(state.installs.flatMap((i) => [i.selected, i.previous]));
            for (const p of state.profiles) for (const i of p.items) kept.add(i.selected);
            const cursor = blobs.openKeyCursor();
            cursor.onsuccess = () => {
              if (cursor.result) {
                if (!kept.has(cursor.result.key)) blobs.delete(cursor.result.key);
                cursor.result.continue();
              }
            };
          }
        };
      });
    },
    close() {
      db.close();
    },
  };
}
