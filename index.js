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
 * - waits for `ctx.settings` and registers the `notify-away` namespace so
 *   the Web UI 插件配置 page can show a card;
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

import { PLUGIN_NAME, SETTINGS_NAMESPACE, resolveConfig } from './lib/config.js';
import { createEventSettingsSchema, eventSettingsEntry } from './lib/schema.js';

/** Stable Cordis plugin name; also the row id in `cordis.patch.yml`. */
export const name = PLUGIN_NAME;

/**
 * Wait for `ctx.settings` before apply(). Nested `ctx.inject(['settings'])`
 * from an empty-inject row is easy to miss: the 插件配置 tab only lists
 * namespaces the Host actually registered. UI-less profiles without a
 * settings provider simply never start this fiber; the Loader entry still
 * exists so the client scanner can see `dsh.client`.
 */
export const inject = ['settings'];

/**
 * Register the 插件配置 namespace. Cordis with `inject: ['settings']` puts
 * `ctx.settings` on this fiber; tests may also pass it directly.
 *
 * @param {object} ctx - host context with `settings.installSection`.
 * @param {object} entry - event-flag subset used as the composition base.
 */
function installSettingsNamespace(ctx, entry) {
  const settings = ctx.settings;
  if (!settings || typeof settings.installSection !== 'function') {
    const message = `${PLUGIN_NAME}: ctx.settings.installSection is missing; 插件配置 will not show this plugin`;
    console.error(message);
    ctx.logger?.warn?.(message);
    return;
  }
  try {
    settings.installSection(ctx, SETTINGS_NAMESPACE, createEventSettingsSchema(), entry, {
      setSource: () => {},
      onChange: () => {},
    });
    const message = `${PLUGIN_NAME}: settings namespace "${SETTINGS_NAMESPACE}" installed`;
    console.error(message);
    ctx.logger?.info?.('%s: settings namespace "%s" installed', PLUGIN_NAME, SETTINGS_NAMESPACE);
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`${PLUGIN_NAME}: settings.installSection failed: ${detail}`);
    ctx.logger?.warn?.(
      '%s: settings.installSection failed (%s); 插件配置 will not show this plugin',
      PLUGIN_NAME,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Mount the host half.
 *
 * @param {object} ctx - the Cordis context of the host row.
 * @param {object} [rawConfig] - the row's config; see `lib/config.js`.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const entry = eventSettingsEntry(config);

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

  installSettingsNamespace(ctx, entry);

  const ready = `${PLUGIN_NAME}: notify-away ready (onlyWhenAway=${config.onlyWhenAway}, includeSubagents=${config.includeSubagents}, completion=${config.completion}, approval=${config.approval}, question=${config.question}, planReview=${config.planReview}, otherWait=${config.otherWait})`;
  console.error(ready);
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
