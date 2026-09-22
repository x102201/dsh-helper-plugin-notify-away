# dsh-helper-plugin-notify-away

English | [中文](README.zh.md)

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![dsh: 0.1.5-rc.2](https://img.shields.io/badge/dsh-0.1.5--rc.2-4b32c3)
![tests: 83 passing](https://img.shields.io/badge/tests-83%20passing-brightgreen)

A **system-notification** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), modeled on Cursor's agent toast: stay silent while you watch the session that just finished or blocked, and raise an OS notification when you have switched away.

**Why it exists:** a long `dsh` turn is easy to miss if you have gone to another window. The Web UI already shows a green "done" dot in the sidebar when you are looking at it. This plugin covers the other case — you are not looking. In dsh-helper it asks the host to raise a system toast (`chrome.webview.postMessage`); in a system browser it uses the `Notification` API.

**How it feels:** start a task, switch to another app, tab, or helper instance. When the root session goes idle — or stops to wait for you — a toast named after that session appears. Click it to focus the Web UI and open that session. If you were already watching that session on this instance, nothing is raised.

```text
watching this session, this instance       silent
other instance / other window / other tab  system notification
                                           (finished *or* waiting on you)
```

**Install (one line):**

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-helper-plugin-notify-away
dsh plugin --profile web add github:x102201/dsh-helper-plugin-notify-away
```

---

## What it does

| Piece | Behavior |
|---|---|
| Completion edge | Fires when a listed session's `running` bit flips to idle. The first observation only records the bit, so a session already idle at load never toasts. |
| Wait edge | Fires when `uiSession.pendingInteractions` newly carries a request for that session. A wait keeps `running` true, so the completion watcher would stay silent. Known kinds: approval, question, plan review. Any later kind still toasts (`otherWait`). Each kind can be turned off in config. |
| Away gate | Silent only while you are looking at **that** session in **this** instance: the panel is on screen, the helper is in front, and `list.current` matches. Hidden tab, another instance, unfocused window, or a background session finishing / blocking → toast. |
| Root sessions | Subagent rows (`origin: 'subagent'` or a `parentId`) are ignored, so parallel children do not flood the tray. |
| Permission | In dsh-helper: none. In a system browser: asked on the first click or keystroke (Safari only grants gesture-bound requests). |
| Dedup | Each toast is tagged `notify-away:<sessionId>`, so a repeat replaces the previous instead of stacking. |
| Click | Focuses the window and calls `ctx.sessions.open(sessionId)`. Helper click-back is the `dsh-helper-notify-click` event. |

The plugin writes **no session-event vocabulary of its own**. It only reads the same sessions-list snapshot and pending-interaction map the sidebar reads. It does not answer approval or question waterfalls.

## Install

Both installation styles are supported. The package ships plain ESM plus one ModuleLoader client factory (no build step, no runtime dependencies), so nothing has to be compiled or allowlisted by pnpm at install time.

> **Prerequisite:** `dsh plugin` forwards its arguments to `pnpm`, so pnpm must be on `PATH` (`corepack enable pnpm` provides it). Without it the CLI prints `pnpm not found on PATH` and exits 127.

### 1. From a local checkout (`link:`)

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-helper-plugin-notify-away
```

- The path must be absolute, or relative to the directory you run the command from (the CLI anchors relative `link:`/`file:` specs to your invoking directory, not to the profile).
- `link:` symlinks the checkout, so **edits to `index.js`/`client.js`/`lib/*.js` take effect on the next `dsh web` restart** with no reinstall.

### 2. From a Git host (`github:`)

```sh
dsh plugin --profile web add github:<owner>/<repo>
```

- The repository root must be this package (the directory holding `package.json` and `cordis.patch.yml`).
- Pin a revision when you want reproducibility: `github:<owner>/<repo>#<tag-or-commit>`.
- Because there is no `prepare`/`postinstall` script, pnpm never asks you to allowlist a build.

### What happens underneath

`dsh plugin ... add` forwards to `pnpm` inside `$DSH_HOME/profiles/web`, then reconciles the profile manifest: because this package declares `dsh.bundle.patch`, its name is appended to `dsh.profile.bundles` automatically. On the next boot that bundle's patch layer adds one host row:

```yaml
- insert:
    - id: notify-away
      name: ./index.js      # anchored to the patch file, so any install layout works
```

`package.json`'s `dsh.client` declaration is what makes the Web UI scan this package and serve `./client` as a ModuleLoader bundle. The host row exists so that scan has an active Loader entry, and so config is validated at boot.

Restart the profile to mount it:

```sh
dsh web            # alias of: dsh --profile web
```

In a system browser, grant notification permission the first time the page asks (your first click or keystroke). On macOS, also allow the browser in **System Settings → Notifications**. dsh-helper's embedded panel does not need this permission.

### Try the host row without installing

[`examples/standalone.patch.yml`](examples/standalone.patch.yml) anchors `../index.js` to the patch file, so a bare checkout can mount the host row:

```sh
dsh --profile web --patch <checkout>/examples/standalone.patch.yml
```

The browser half still needs the package resolvable as `dsh-helper-plugin-notify-away` (a `link:` install), because `dsh.client` is discovered from the package manifest.

### Verify the install

```sh
# the composed config tree should contain the notify-away row:
dsh --profile web --dump-config | grep -A2 notify-away
```

Then start a task in the Web UI, switch to another window, and wait for idle or a blocking prompt: a system notification titled with the session name should appear. Stay on that session with the window focused: nothing should appear.

### Uninstall

```sh
dsh plugin --profile web remove dsh-helper-plugin-notify-away
```

## Configuration

All keys are optional; an empty mapping uses the defaults (every notification kind **on**). **The intended way to change them is Settings → 插件 → 插件配置**, where this plugin appears as **离开时通知** with a checkbox per kind.

The host row also validates the same keys at load (unknown keys and wrong types fail boot). A patch can pin deployment defaults; the settings page writes user overrides to `$DSH_HOME/settings.yaml` and they take effect immediately.

```yaml
- id: notify-away
  config:
    onlyWhenAway: true
    includeSubagents: false
    body: Task finished.
    completion: true
    approval: true
    question: true
    planReview: true
    otherWait: true
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `onlyWhenAway` | boolean | `true` | Suppress the toast while you are looking at the session that just finished. |
| `includeSubagents` | boolean | `false` | Also toast when a child agent goes idle. |
| `title` | string | *(session display title)* | Optional static toast title. |
| `body` | string | `Task finished.` | Toast body copy for a completion. |
| `completion` | boolean | `true` | Toast when a session goes `running → idle`. Cancelled turns also idle. |
| `approval` | boolean | `true` | Toast on pending kind `approval`. |
| `question` | boolean | `true` | Toast on pending kind `question`. |
| `planReview` | boolean | `true` | Toast on pending kind `plan-review`. |
| `otherWait` | boolean | `true` | Toast on any later pending kind the sidebar does not name yet. |

Omit a kind (or leave it `true`) to keep it on. Set it to `false` to silence that kind only.

A patch replaces the targeted row's whole `config` mapping; omitted keys fall back to the defaults. Put overrides in the profile's `cordis.patch.yml`, or see [`examples/profile-patch.yml`](examples/profile-patch.yml).

The settings page is the live switch: Host `installSection('notify-away')` serves the namespace, and the browser half registers a `settings.plugin.item` card. Saving writes the user layer (not the cordis row). `window.__dshHelperNotifyAway` remains an emergency overlay on top of that.

Three things keep that card on screen. The Host namespace has to be served by `settings.describe` (every registered namespace is). The card's store has to hand React a **reference-stable** snapshot: the renderer binds it through `useSyncExternalStore`, so a store that builds a new object per call re-renders forever until React throws — the slot's error boundary then hides the card and the console says `slot entry crashed in 'settings.plugin.item'`. And the fiber that registers the card injects `slots` and `settingsScope` only, so every ambient service it touches must be read with the non-strict `ctx.get(name)` accessor: cordis throws `cannot get property "locale" without inject` on `ctx.locale`, and a throw before `slots.register` means no card at all (that error is the only trace).

## How it works

```text
sessions.list snapshot              ──►  running → idle edge
uiSession.pendingInteractions       ──►  new wait key (approval / question / …)
                                    │
                         shouldNotify(away || current !== sessionId)
                                    │
              chrome.webview.postMessage  ──►  helper OS toast
                         or Notification  ──►  browser OS banner
                                    │
                         click  ──►  window.focus + sessions.open
```

- **Away is a page fact.** `document.visibilityState === 'hidden'` or `!document.hasFocus()`. There is no host-side focus signal.
- **dsh-helper does not need Notification permission.** The client posts `{ kind: "notify-away", title, body, sessionId, tag }` on the WebView2 page↔host channel already used by the panel. Helper shows the toast under its own AUMID and, on click, focuses the instance and dispatches `dsh-helper-notify-click`.
- **The client bundle is a factory, not an ESM graph.** The Web UI loads `client.js` through `window.__ModuleLoader__.load`. Relative `./lib/` imports would not resolve, so `client.js` inlines the policy that `lib/policy.js` tests.
- **No install-time build.** `link:` and `github:` therefore behave the same: the host imports only `node:` and relative paths, and there is no `prepare`/`postinstall` script for pnpm to allowlist.

## Limits

- Completions and waits use the same toast tag per session, so a later event replaces the previous one instead of stacking.
- In a system browser the permission is browser-owned: if the prompt is denied, that origin stays silent. dsh-helper's panel uses `postMessage` instead and is not gated on this.
- Cancelling a running turn also goes idle, so a cancelled task still triggers a "finished" toast unless `completion` is off.
- Wait-toast copy is not configurable.

## Compatibility

Written against **dsh `0.1.5-rc.2`**. Seams used:

| Seam | Use |
|---|---|
| Host row `name: ./index.js` + `dsh.bundle.patch` | `link:` / `github:` install |
| `package.json` `dsh.client` (`platform: web`, `inject: [@deepseek-ai/dsh-client-runtime, @deepseek-ai/dsh-client-ui-settings-plugins]`) | Web UI scans and serves `./client`, after the Plugins settings section declares `settings.plugin.item` |
| Client `inject: ['sessions']` | `ctx.sessions.list` snapshot + `ctx.sessions.open`; wait watcher attaches to `ctx.uiSession.pendingInteractions` |
| `chrome.webview.postMessage` | dsh-helper panel → OS toast (no Notification permission) |
| Browser `Notification` API | fallback OS banner when the UI is not inside helper |

## Test

```sh
npm test              # node --test
npm run test:direct   # single process (sandboxes that block child processes)
```

## Layout

```text
index.js                     Cordis host plugin: config validation + ready log
client.js                    ModuleLoader factory: away gate + postMessage / Notification
cordis.patch.yml             bundle patch: insert the host row
lib/config.js                config schema and defaults
lib/schema.js                settings namespace schema (schemastery from the profile, or a fallback)
lib/policy.js                pure shouldNotify / running→idle / wait-key fold (tested)
examples/                    profile overlay and standalone host-row overlay
scripts/run-tests.mjs        single-process test runner
test/                        config, policy, package shape, host wiring, client factory
test-support/harness.mjs     fake Cordis ctx and sessions list
README.md / README.zh.md     this document, both languages
```

## License

MIT.
