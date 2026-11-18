import { Manager } from "./manager.js";
import { Store } from "./ui.jsx";
import { installWindowsToolbar } from "./compat/layout.js";
import css from "./store.css";

export default async function start(context) {
  const host = window.SpotiKit;
  if (host.Apps.list().some((app) => app.id === "spicetify-store"))
    throw new Error("The Spicetify Store route is already registered.");
  context.style(css);
  installWindowsToolbar(host, context.onStop);
  const manager = new Manager(host, context);
  const page = host.Apps.register({
    id: "spicetify-store",
    name: "Spicetify Store",
    icon: "enhance",
    component: () => host.React.createElement(Store, { manager }),
  });
  context.onStop(() => {
    page.remove();
    manager.close();
  });
  await manager.start();
}
