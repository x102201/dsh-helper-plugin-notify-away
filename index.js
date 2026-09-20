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
 * - It stays silent when you are looking at that same session (page visible
 *   and focused, current selection matches).
 * - It notifies when the page is hidden, the window lost focus, or a
 *   different session finished.
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

import { PLUGIN_NAME, resolveConfig } from './lib/config.js';

/** Stable Cordis plugin name; also the row id in `cordis.patch.yml`. */
export const name = PLUGIN_NAME;

/**
 * No host services are required: the toast is dispatched from the browser
 * half (postMessage to helper, or Notification in a system browser).
 * An empty inject list still lets UI-less profiles compose the row so the
 * client scanner can see the package.
 */
export const inject = [];

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
    ctx.logger.warn(
      '%s: ctx.notifyAway could not be provided (%s); notifications still work in the Web UI',
      PLUGIN_NAME,
      error instanceof Error ? error.message : String(error),
    );
  }

  ctx.logger.info(
    '%s: notify-away ready (onlyWhenAway=%s, includeSubagents=%s)',
    PLUGIN_NAME,
    config.onlyWhenAway,
    config.includeSubagents,
  );
}
