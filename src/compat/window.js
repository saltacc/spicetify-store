// Serialized into the final module, so this function uses only its own bindings.
function windowView(page) {
  const hidden = (key) => typeof key === "string" && key.toLowerCase() === "spotikit";
  const nativeMethods = new Set([
    "addEventListener", "removeEventListener", "dispatchEvent", "matchMedia", "getComputedStyle", "getSelection",
    "open", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
    "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "queueMicrotask", "fetch", "postMessage",
    "scroll", "scrollTo", "scrollBy",
  ]);
  const boundMethods = new WeakMap();
  // The real Window has non-configurable own properties, so use an empty proxy target.
  return new Proxy(Object.create(null), {
    ownKeys: () => Reflect.ownKeys(page).filter((key) => !hidden(key)),
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = !hidden(key) && Reflect.getOwnPropertyDescriptor(page, key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    has: (_target, key) => !hidden(key) && Reflect.has(page, key),
    get(_target, key) {
      if (hidden(key)) return undefined;
      const value = Reflect.get(page, key, page);
      if (!nativeMethods.has(key) || typeof value !== "function") return value;
      let bound = boundMethods.get(value);
      if (!bound) {
        bound = value.bind(page);
        boundMethods.set(value, bound);
      }
      return bound;
    },
    set: (_target, key, value) => !hidden(key) && Reflect.set(page, key, value, page),
  });
}

export function scopedWindow(source) {
  return `const window = (${windowView.toString()})(globalThis);\n${source}`;
}
