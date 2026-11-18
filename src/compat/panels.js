export function panelApi(host, own) {
  const native = host.Panels;
  if (!native) return undefined;
  const known = ["Disabled", "BuddyFeed", "NowPlayingView", "WhatsNewFeed", "Puffin"];
  const custom = new Map(),
    nativeIds = new Map();
  let next = 1000;
  function builtins() {
    const ids = {};
    for (const [name, id] of Object.entries(native.builtIn || {})) {
      let index = known.indexOf(name);
      if (index < 0) index = known.push(name) - 1;
      ids[name] = index;
      ids[index] = name;
      nativeIds.set(index, id);
    }
    return ids;
  }
  function current() {
    builtins();
    for (const [id, panel] of custom) if (panel.handle.id === native.current) return id;
    for (const [id, value] of nativeIds) if (value === native.current) return id;
    return 0;
  }
  return {
    get reservedPanelIds() {
      return builtins();
    },
    get currentPanel() {
      return current();
    },
    get Components() {
      return {
        PanelSkeleton: host.Components.PanelFrame,
        PanelContent: host.Components.PanelBody,
        PanelHeader: host.Components.PanelHeader,
      };
    },
    hasPanel(id) {
      builtins();
      return custom.has(id) || nativeIds.has(id);
    },
    getPanel(id) {
      return custom.get(id)?.element;
    },
    setPanel(id) {
      builtins();
      if (custom.has(id)) return custom.get(id).handle.open();
      if (!id || !nativeIds.has(id)) return native.close();
      return native.open(nativeIds.get(id));
    },
    subPanelState(callback) {
      const off = native.on("change", () => callback(current()));
      own(off);
      callback(current());
      return off;
    },
    registerPanel(props) {
      const id = next++,
        child = props.children;
      const element = typeof child === "function" ? host.React.createElement(child, { panel: id }) : child;
      const handle = native.register({
        title: props.label,
        style: props.style,
        actions: props.header?.actions,
        content: element,
        frame: !props.isCustom,
      });
      custom.set(id, { handle, element });
      own(() => {
        custom.delete(id);
        handle.remove();
      });
      return {
        id,
        get isActive() {
          return handle.isOpen;
        },
        toggle: () => handle.toggle(),
        onStateChange(fn) {
          const off = handle.on("change", fn);
          own(off);
          fn(handle.isOpen);
          return off;
        },
      };
    },
  };
}
