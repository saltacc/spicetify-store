// Run in Spotify's developer console before upgrading a 0.9.0 installation.
(async function exportSpicetifyStoreLegacy() {
  const req = indexedDB.open("spotikit-marketplace");
  const db = await new Promise((resolve, reject) => {
    req.onupgradeneeded = () => req.transaction.abort();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  function get(store, key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  try {
    const records = (await get("state", "installed")) || {},
      installs = [];
    for (const [id, record] of Object.entries(records))
      if (record.item?.origin === "spicetify") {
        const slot = await get("files", id + "|current");
        if (slot) installs.push({ id, record, files: slot.files || slot });
      }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ format: "spicetify-store-legacy", version: 1, installs })], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "spicetify-store-legacy.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    console.info("Exported " + installs.length + " legacy packages.");
  } finally {
    db.close();
  }
})();
