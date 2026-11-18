// Tooltip renderer and lifecycle adapted from spicetify/cli v2.45.3, popup.js.
// Copyright the Spicetify contributors, GNU LGPL v2.1. Modified for headless
// Tippy and cleanup on 2026-11-17. Attribution updated 2026-11-18.
// See THIRD_PARTY_NOTICES.txt and licenses/Spicetify-LGPL-2.1.txt.
import tippy from "tippy.js/headless/dist/tippy-headless.esm.js";

function render(instance) {
  const doc = instance.reference.ownerDocument;
  const popper = doc.createElement("div");
  const box = doc.createElement("div");
  popper.dataset.spiceTooltip = "";
  box.className = "main-contextMenu-tippy";
  box.setAttribute("role", "tooltip");
  popper.append(box);
  function content(props) {
    if (props.content?.nodeType) box.replaceChildren(props.content);
    else if (props.allowHTML) box.innerHTML = props.content || "";
    else box.textContent = props.content || "";
  }
  content(instance.props);
  return {
    popper,
    onUpdate(before, after) {
      if (before.content !== after.content || before.allowHTML !== after.allowHTML) content(after);
    },
  };
}

// Headless Tippy delegates removal of animated custom renderers to the renderer.
// A consumer may replace any lifecycle callback, including onHide.
const releaseHidden = {
  fn(instance) {
    return {
      onHide() {
        if (instance.props.render !== render || !instance.props.animation) return;
        instance.reference.ownerDocument.defaultView.requestAnimationFrame(() => {
          if (instance.state.isMounted && !instance.state.isVisible) instance.unmount();
        });
      },
    };
  },
};

export function installTooltips(api, own) {
  api.TippyProps = {
    delay: [200, 0],
    animation: true,
    render,
    onShow(instance) {
      instance.popper.firstElementChild?.classList.add("main-contextMenu-tippyEnter");
    },
    onMount(instance) {
      instance.reference.ownerDocument.defaultView.requestAnimationFrame(() => {
        if (!instance.state.isVisible) return;
        const classes = instance.popper.firstElementChild?.classList;
        classes?.remove("main-contextMenu-tippyEnter");
        classes?.add("main-contextMenu-tippyEnterActive");
      });
    },
    onHide(instance) {
      instance.popper.firstElementChild?.classList.remove("main-contextMenu-tippyEnter", "main-contextMenu-tippyEnterActive");
    },
  };
  function create(target, props = {}) {
    const result = tippy(target, {
      ...api.TippyProps,
      ...props,
      plugins: [...(props.plugins || []), releaseHidden],
    });
    for (const instance of Array.isArray(result) ? result : [result])
      own(() => {
        if (!instance.state.isDestroyed) instance.destroy();
      });
    return result;
  }
  api.Tippy = Object.assign(create, tippy);
}
