# dsh-helper-plugin-notify-away

English | [中文](README.zh.md)

![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![dsh: 0.1.5-rc.2](https://img.shields.io/badge/dsh-0.1.5--rc.2-4b32c3)
![tests: 41 passing](https://img.shields.io/badge/tests-41%20passing-brightgreen)
![tests: 41 passing](https://img.shields.io/badge/tests-41%20passing-brightgreen)

A **system-notification** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), modeled on Cursor's agent toast: stay silent while you watch the session that just finished, and raise an OS notification when you have switched away.

**Why it exists:** a long `dsh` turn is easy to miss if you have gone to another window. The Web UI already shows a green "done" dot in the sidebar when you are looking at it. This plugin covers the other case — you are not looking — with a browser `Notification` that becomes a Windows / macOS system banner on `http://127.0.0.1`.

**How it feels:** start a task, switch to another app or tab. When the root session goes idle, a toast named after that session appears. Click it to focus the Web UI and open that session. If you were already watching that session, nothing is raised.

```text
watching this session, window focused     silent
other window / hidden tab / other session  system notification
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
| Away gate | Silent only while you are looking at **that** session: the page is visible, the window is focused, and `list.current` matches. Hidden tab, unfocused window, or a background session finishing → toast. |
| Root sessions | Subagent rows (`origin: 'subagent'` or a `parentId`) are ignored, so parallel children do not flood the tray. |
| Permission | Asked on the first click or keystroke, not while you are away (Safari only grants gesture-bound requests). |
| Dedup | Each toast is tagged `notify-away:<sessionId>`, so a repeat replaces the previous instead of stacking. |
| Click | Focuses the window and calls `ctx.sessions.open(sessionId)`. |

The plugin writes **no session-event vocabulary of its own**. It only reads the same sessions-list snapshot the sidebar reads.

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

Grant the browser notification permission the first time the page asks (your first click or keystroke). On macOS, also allow the browser in **System Settings → Notifications**.

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

Then start a task in the Web UI, switch to another window, and wait for idle: a system notification titled with the session name should appear. Stay on that session with the window focused: nothing should appear.

### Uninstall

```sh
dsh plugin --profile web remove dsh-helper-plugin-notify-away
```

## Configuration

All keys are optional; an empty mapping uses the defaults. Config is validated at load: unknown keys and wrong types fail boot instead of being ignored.

```yaml
- id: notify-away
  config:
    onlyWhenAway: true
    includeSubagents: false
    body: Task finished.
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `onlyWhenAway` | boolean | `true` | Suppress the toast while you are looking at the session that just finished. |
| `includeSubagents` | boolean | `false` | Also toast when a child agent goes idle. |
| `title` | string | *(session display title)* | Optional static toast title. |
| `body` | string | `Task finished.` | Toast body copy. |

A patch replaces the targeted row's whole `config` mapping; omitted keys fall back to the defaults. Put overrides in the profile's `cordis.patch.yml`, or see [`examples/profile-patch.yml`](examples/profile-patch.yml).

The host row validates these keys so a typo fails at boot. **The browser half currently uses the same defaults** (it cannot read host-row config without an RPC). Leave the mapping empty unless you are pinning the documented defaults on purpose.

## How it works

```text
sessions.list snapshot  ──►  running → idle edge
                                    │
                         shouldNotify(away || current !== sessionId)
                                    │
                         browser Notification  ──►  OS banner
                                    │
                         click  ──►  window.focus + sessions.open
```

- **Away is a page fact.** `document.visibilityState === 'hidden'` or `!document.hasFocus()`. There is no host-side focus signal.
- **The client bundle is a factory, not an ESM graph.** The Web UI loads `client.js` through `window.__ModuleLoader__.load`. Relative `./lib/` imports would not resolve, so `client.js` inlines the policy that `lib/policy.js` tests.
- **No install-time build.** `link:` and `github:` therefore behave the same: the host imports only `node:` and relative paths, and there is no `prepare`/`postinstall` script for pnpm to allowlist.

## Limits

- Completions only. Waiting-for-approval / `ask_user_question` toasts are not in this version.
- Browser-owned permission: if the prompt is denied, the plugin is silent for that origin.
- Cancelling a running turn also goes idle, so a cancelled task still triggers a "finished" toast.
- The host-row `config` mapping is validated but not yet pushed to the browser half.

## Compatibility

Written against **dsh `0.1.5-rc.2`**. Seams used:

| Seam | Use |
|---|---|
| Host row `name: ./index.js` + `dsh.bundle.patch` | `link:` / `github:` install |
| `package.json` `dsh.client` (`platform: web`, `inject: [@deepseek-ai/dsh-client-runtime]`) | Web UI scans and serves `./client` |
| Client `inject: ['sessions']` | `ctx.sessions.list` snapshot + `ctx.sessions.open` |
| Browser `Notification` API | OS banner on the Web UI origin |

## Test

```sh
npm test              # node --test
npm run test:direct   # single process (sandboxes that block child processes)
```

## Layout

```text
index.js                     Cordis host plugin: config validation + ready log
client.js                    ModuleLoader factory: away gate + Notification
cordis.patch.yml             bundle patch: insert the host row
lib/config.js                config schema and defaults
lib/policy.js                pure shouldNotify / running→idle fold (tested)
examples/                    profile overlay and standalone host-row overlay
scripts/run-tests.mjs        single-process test runner
test/                        config, policy, package shape, host wiring, client factory
test-support/harness.mjs     fake Cordis ctx and sessions list
README.md / README.zh.md     this document, both languages
```

## License

MIT.
