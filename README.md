# Spicetify Store for SpotiKit

An independent SpotiKit extension that adds a **Spicetify Store** toolbar button, the Spicetify compatibility API, and a separate library of community packages. The Spicetify CLI and a development server are unnecessary.

The compatibility layer was tested in Spotify **1.3.9.2055** on Apple Silicon macOS with SpotiKit **0.9.1**. Windows desktop compatibility is unverified.

## Install

Open the shopping bag in Spotify to enter SpotiKit’s Marketplace. Choose **Extensions**, search for **Spicetify Store**, and select **Install**. You can also open the listing by pasting the extension’s GitHub repository address into the Marketplace’s link button. Once installed, open **Spicetify Store** from the top toolbar.

### Install from a release ZIP

1. Extract the release ZIP. Copy its **spicetify-store** folder into SpotiKit’s **Extensions** directory. The resulting path must contain **Extensions/spicetify-store/spotikit.json** and **Extensions/spicetify-store/dist/extension.js**.
2. In the SpotiKit desktop app, choose **Apply to Spotify** and reopen Spotify.
3. Click **Spicetify Store** in the top toolbar. In **Browse**, select **Auto Skip Video** or **Auto Skip Explicit**, open its details, and choose **Install extension**. In **Installed**, confirm its status is **Running**. Auto Skip Explicit adds **Christian mode** to Spotify’s profile menu.

Browse loads public GitHub topic catalogs and the upstream snippet collection. Search filters the entries loaded so far. **Import package** accepts an owner/repository, a manifest or direct HTTPS link, or a local file. Save a repository or manifest as a catalog source and manage it from Settings. The first two extension listings ship as metadata and can be downloaded directly even when GitHub search is rate-limited. Installed scripts and bundled resources load from IndexedDB on subsequent starts. External services used by an extension can still require a network connection.

For custom apps, the store checks the author’s releases first. If Spotify cannot fetch a release ZIP, the store links to the publisher’s file. Download it and choose **Install downloaded ZIP** in the same dialog. For an existing app, use **Updates → Check → Update from ZIP**. This updates the existing entry and keeps its rollback history. The store checks the archive against GitHub’s SHA-256 checksum when the publisher’s release includes one.

## Package support

| Content | Supported format and behavior |
| --- | --- |
| Extensions | Classic browser JavaScript with player events, queue helpers, local settings, React, profile and context menus, toolbar and playbar controls, shortcuts, modals, URI, GraphQL and Cosmos adapters. Spotify internals and optional APIs vary by client. |
| Themes | Manifest with usercss, schemes and optional include scripts. Each palette is validated independently. Eight-digit hex uses the CLI’s first three color channels. Xresources expressions can supply a literal fallback. Package details list skipped palettes. |
| Snippets | Community CSS, local CSS files, and named snippets authored and edited under Installed. Reorder snippets to control precedence. |
| Apps | Built classic app ZIP or a supported distribution branch/release. Accepts index.js defining render(), ordered subfiles, accompanying extension scripts, style.css, and bundled static image/font assets. Subroutes use the host’s app route. |
| Source builds | JSX, npm builds, relative module graphs, custom workers, and arbitrary dynamic asset paths require a prebuilt compatible distribution or an adapter. A package that depends on private Spotify modules needs testing on the installed client. |

The alias adapter uses the bundled Spicetify class dictionary, the active SpotiKit class map, and verified layout equivalents. It supplies legacy cover, track-info, library-row and navigation insertion points when the corresponding host elements exist. Legacy tooltips expose their content element, placement and lifecycle callbacks through Tippy.

**Running** means the store started the cached entry. For simple HTTPS script loaders, installation also caches the executable payload. A change in those bytes appears in **Updates**, and pinning, backup and rollback include them. **External code unverified** means the entry started and can load more code at runtime. For that entry, **Pin stored files only** keeps the local revision while the external provider controls additional code. Existing installs keep their selected files. Use **Check** in Updates to discover a newly cacheable payload.

## Updates, profiles, and recovery

- **Updates** checks upstream content, shows its revision, and keeps the prior installed revision for rollback. Pin a revision or opt an item into automatic updates. Executable changes may require reloading Spotify. The store never starts two revisions of one legacy script in a page session.
- **Profiles** saves revisions, load order, enabled state, and theme scheme. Importing a profile saves a recipe. Applying it explicitly enables the selected packages after their exact revisions are available. Use a full backup to transfer local or older package files.
- **Settings → Export backup** writes this store’s package files and profiles. Import merges new entries disabled. Third-party settings written directly into Spotify storage stay in their original location.
- **Settings → Pause and reload** opens the manager with child packages paused. Two interrupted startup attempts also pause legacy activation. Disable a failing item and use **Resume and reload**. Native SpotiKit safe mode can skip the entire store.
- To pause the store from Spotify’s developer console when its page is inaccessible, run the following and reload Spotify.

~~~js
localStorage.setItem("spotikit:spicetify-store:paused", "1")
~~~

Packages execute in Spotify’s page context and share its access. The store removes the resources it can attribute to its API. A reload clears remaining timers, page modifications, and script state. Uninstall the manager by removing its folder from Extensions and applying SpotiKit again.

## Recover from SpotiKit 0.9.0

Before upgrading, run the supplied **tools/export-legacy.js** in the old Spotify developer console. It reads the old Marketplace database and downloads a JSON file containing surviving Spicetify installs. After upgrading, import it in **Settings → Import backup**. **Recover old installs** can also read an old database in place. SpotiKit 0.9.1 may already have removed its foreign records. Recovery requires cached files or an earlier export.

## Development

Use Node.js 22.12 or later. From this directory run the following.

~~~sh
npm ci
npm run build
npm test
npx playwright-core install chromium
npm run test:browser
npm run pack
~~~

The browser test uses the SpotiKit checkout’s actual local loader and route-registration code, real React, and controlled Spotify service fixtures. Its two unchanged upstream JS files are fetched from a pinned commit and cached outside the repository. Set CHROME_PATH to use a preinstalled Chromium executable. The macOS/Windows host check needs the parent SpotiKit checkout and .NET 10. Run **node tools/check-host.mjs** after packing, optionally passing a pristine xpui.spa path to test a temporary copy.

The build places the self-contained browser module in **dist/extension.js**. Packing writes an installable ZIP and extracted folder under **release/**. To rebuild the downloaded source on its own, extract it, run `npm ci` to install the locked tools, then run `npm run build`. The build works without the parent SpotiKit checkout. To change the bundled code, make your edits after installing the tools.

## Licenses and source

The original store code is licensed under **AGPL-3.0-only**. It includes SpotiKit bridge code, Spicetify code and data under **LGPL v2.1**, and Spicetify Marketplace exclusion data under **MIT**. The license file explains how those terms apply. [Project license](LICENSE.md) · [Third-party credits and modifications](THIRD_PARTY_NOTICES.txt)

Open **Settings → Licenses and source** to save the full notices or the source for the installed version, including from a one-click Marketplace install while offline. The release ZIP also contains **source.zip**, **licenses/**, and the pre-upgrade export helper. The embedded source ZIP can be extracted from the module's `data:application/zip;base64,` URL without starting Spotify.

## Validation

| Check | Environment |
| --- | --- |
| Unchanged autoSkipExplicit.js and autoSkipVideo.js, menu toggle, track metadata, and skip requests | SpotiKit 0.9.1 local loader and app route in Chromium with simulated playback |
| Offline restart, update failure, pinning, rollback, themes, snippets, built app, profiles, and startup recovery | Reproducible Chromium integration suite |
| Custom app portals, the main scroll container, and switching to either store after a render failure | SpotiKit route registration with real React in Chromium |
| Manifest discovery and bytes written to XPUI | Native .NET AddonCatalog and XpuiPatcher on a temporary archive |
| Signed-in Spotify desktop playback and Playlist Maker’s Result tab | Spotify 1.3.9.2055 on Apple Silicon macOS with SpotiKit 0.9.1 |

Pinned example source and upstream API contracts are available from the Spicetify project. [Example scripts](https://github.com/spicetify/cli/tree/0b4653f6e6f15efd88119aad96386fb309e81477/Extensions) · [Extension documentation](https://spicetify.app/docs/development/extensions)
