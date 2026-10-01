/**
 * dsh plugin: `dsh-helper-plugin-notify-away` — Cursor-style system
 * notifications when a session finishes while you are looking elsewhere.
 *
 * ## What it is
 *
 * Cursor stays silent while you watch the chat that just finished, and raises
 * an OS notification when you have switched to another window. This plugin
 * adds that shape to the DeepSeek Harness Web UI:
 *
 * - A toast fires on a root session's `running → idle` edge.
 * - A toast also fires when that session newly waits on you (approval,
 *   question, plan review, or any later pending-interaction kind). A wait
 *   keeps `running` true, so the completion watcher alone would stay silent.
 * - It stays silent when you are looking at that same session (this
 *   instance's panel is showing, the helper is in front, current selection
 *   matches).
 * - It notifies when the page is hidden, another instance is on screen, the
 *   window lost focus, or a different session finished or blocked.
 * - Clicking the toast focuses the window and opens that session.
 *
 * ## Host vs browser
 *
 * The client decides *when* to notify (away gate, current session). In
 * dsh-helper's WebView2 panel it signals via `chrome.webview.postMessage`
 * and helper shows the OS toast; in a system browser it falls back to
 * `Notification`. Focus lives in the page, so the real work is `client.js`,
 * loaded through `dsh.client`. This host row:
 *
 * - makes the package an active Loader entry, which is what the client-module
 *   scanner reads `dsh.client` from;
 * - validates the row's `config` at boot so a typo fails loudly;
 * - exports a `Config` schemastery schema whose `.volatile()` fields are the
 *   live switches the client page reads through `ctx.configForms`;
 * - declares through `configure({ auto: false })` that this row ships its own
 *   page, so Settings does not also generate one;
 * - logs one ready line.
 *
 * ## Zero runtime dependencies
 *
 * The plugin imports nothing outside `node:` builtins and its own `lib/`.
 * `dsh plugin --profile web add link:<dir>` symlinks this directory into the
 * profile, and Node resolves a linked package's bare imports from its real
 * path — outside the profile's `node_modules`. A static `@deepseek-ai/...`
 * import would therefore work for a `github:` install and fail for a `link:`
 * install. The browser half is a ModuleLoader factory (not an ESM graph) for
 * the same reason: the Web UI does not resolve relative `./lib/` imports from
 * a client bundle.
 *
 * @module dsh-helper-plugin-notify-away
 */

import { PLUGIN_NAME, SETTINGS_NAMESPACE, DEFAULT_BODY, resolveConfig } from './lib/config.js';
import { tryLoadSchemastery } from './lib/schema.js';

/** Stable Cordis plugin name; also the row id in `cordis.patch.yml`. */
export const name = PLUGIN_NAME;

/**
 * Schemastery Config schema. The DSH settings service reads this at load time:
 * the entry id (`notify-away`) becomes the namespace, and `volatileForm()`
 * projects the `.volatile()` fields — and only those — into the form a client
 * page reads through `ctx.configForms.get('notify-away')`.
 *
 * Every live switch is `.volatile()` so the user can change it without a
 * restart: the away gate (`onlyWhenAway`), the subagent gate
 * (`includeSubagents`), and the five toast kinds. `title` and `body` stay
 * non-volatile — they are profile-YAML copy and require a restart.
 *
 * The schema is built with `tryLoadSchemastery()` which resolves schemastery
 * from the running profile / DSH_HOME rather than from a bare import (that
 * would break `link:` installs). When schemastery cannot be found the export
 * is `undefined`, the row exposes no form, and `client.js` falls back to the
 * row config and the defaults.
 */
export const Config = (() => {
  const z = tryLoadSchemastery();
  if (!z) return undefined;
  return z.object({
    onlyWhenAway: z.boolean().default(false).volatile(),
    includeSubagents: z.boolean().default(false).volatile(),
    title: z.string(),
    body: z.string().default(DEFAULT_BODY),
    completion: z.boolean().default(true).volatile(),
    approval: z.boolean().default(true).volatile(),
    question: z.boolean().default(true).volatile(),
    planReview: z.boolean().default(true).volatile(),
    otherWait: z.boolean().default(true).volatile(),
  });
})();

/**
 * The row injects nothing: it must stay an ACTIVE Loader entry so the
 * client-module scanner serves `client.js`, and it must mount in UI-less
 * profiles that have no Settings service at all. The settings page policy is
 * registered from an optional `ctx.inject(['settings'], …)` child inside
 * apply(), which is the shape the 0.2 harness documents for a plugin that
 * ships its own page.
 */
export const inject = [];

/**
 * Register this row's page policy on the DSH `SettingsForms` service.
 *
 * `configure(presentation, owner)` replaced the 0.1 `installSection()` call.
 * A row no longer registers its namespace at all: the Settings service
 * describes every Loader entry from its exported `Config` schema, the entry id
 * (here `notify-away`) IS the namespace, and only `.volatile()` fields reach
 * the form. `configure` therefore carries one fact only — whether this
 * instance still wants a schema-generated page.
 *
 * `{ auto: false }` is correct here: `client.js` ships its own page onto this
 * bundle's Plugins card (`plugins.bundle.config`), so the Settings UI must not
 * also advertise a generated form for the same row.
 *
 * The registration lives in an effect so a late-loading or replaced Settings
 * service picks the policy up, and so the disposer `configure` returns is
 * released with the fiber. Failures are logged, never thrown: a settings
 * service that changes shape again must not take the row (or the client half
 * that actually raises the toasts) down with it.
 *
 * @param {object} ctx - host context of the plugin row.
 */
function installSettingsPage(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => {
      const settings = child.settings;
      if (!settings || typeof settings.configure !== 'function') {
        const message = `${PLUGIN_NAME}: ctx.settings.configure is not available; 插件面板 will not list this plugin`;
        console.warn(message);
        ctx.logger?.warn?.(message);
        return () => {};
      }
      try {
        const dispose = settings.configure({ auto: false }, ctx.fiber);
        ctx.logger?.info?.('%s: settings page policy installed for "%s"', PLUGIN_NAME, SETTINGS_NAMESPACE);
        return typeof dispose === 'function' ? dispose : () => {};
      } catch (error) {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        console.warn(`${PLUGIN_NAME}: settings.configure failed: ${detail}`);
        ctx.logger?.warn?.(
          '%s: settings.configure failed (%s); 插件面板 will fall back to the row config',
          PLUGIN_NAME,
          error instanceof Error ? error.message : String(error),
        );
        return () => {};
      }
    }, 'notify-away: settings page policy');
  });
}

/**
 * Mount the host half.
 *
 * @param {object} ctx - the Cordis context of the host row.
 * @param {object} [rawConfig] - the row's config; see `lib/config.js`.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  try {
    ctx.provide('notifyAway', Object.freeze({
      /** The resolved host-row config (defaults match the browser half). */
      config,
    }));
  } catch (error) {
    ctx.logger?.warn?.(
      '%s: ctx.notifyAway could not be provided (%s); notifications still work in the Web UI',
      PLUGIN_NAME,
      error instanceof Error ? error.message : String(error),
    );
  }

  installSettingsPage(ctx);

  const ready = `${PLUGIN_NAME}: notify-away ready (onlyWhenAway=${config.onlyWhenAway}, includeSubagents=${config.includeSubagents}, completion=${config.completion}, approval=${config.approval}, question=${config.question}, planReview=${config.planReview}, otherWait=${config.otherWait})`;
  // Informational, not an error: stdout keeps the helper's log panel from
  // painting every healthy start red.
  console.log(ready);
  ctx.logger?.info?.(
    '%s: notify-away ready (onlyWhenAway=%s, includeSubagents=%s, completion=%s, approval=%s, question=%s, planReview=%s, otherWait=%s)',
    PLUGIN_NAME,
    config.onlyWhenAway,
    config.includeSubagents,
    config.completion,
    config.approval,
    config.question,
    config.planReview,
    config.otherWait,
  );
}
