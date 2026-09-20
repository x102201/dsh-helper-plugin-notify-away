/**
 * Configuration for the notify-away plugin.
 *
 * Config is validated at plugin load. Unknown keys, wrong types, and blank
 * strings throw, because a typo in a patch layer should fail loudly at boot
 * instead of silently leaving the plugin on its defaults.
 *
 * The browser half currently uses these same defaults (it cannot read the
 * host-row mapping without an RPC). Changing a key here still fails boot on a
 * typo; it does not retarget the toast until a settings/RPC path exists.
 *
 * @module dsh-helper-plugin-notify-away/lib/config
 */

/** The plugin name used in diagnostics and as the client ModuleLoader id. */
export const PLUGIN_NAME = 'dsh-helper-plugin-notify-away';

/** Default toast body when a session finishes. */
export const DEFAULT_BODY = 'Task finished.';

/** Every accepted config key, for the unknown-key diagnostic. */
const KNOWN_KEYS = Object.freeze([
  'onlyWhenAway',
  'includeSubagents',
  'title',
  'body',
]);

/** Describe a rejected value for a diagnostic. */
function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  return JSON.stringify(value) ?? String(value);
}

/** Read an optional boolean field. */
function readBoolean(config, key, fallback) {
  const value = config[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${PLUGIN_NAME}: config.${key} must be a boolean, got ${describe(value)}`);
  return value;
}

/** Read an optional non-empty string field. */
function readString(config, key, fallback) {
  const value = config[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${PLUGIN_NAME}: config.${key} must be a non-empty string, got ${describe(value)}`);
  }
  return value;
}

/**
 * Validate one deployment's config.
 *
 * @param {unknown} raw - the row's `config` value (absent for a bare insert).
 * @returns {Readonly<object>} the resolved config.
 * @throws when a key is unknown or a value has the wrong type, so a misconfigured
 *   profile fails at load rather than behaving unexpectedly.
 */
export function resolveConfig(raw) {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`${PLUGIN_NAME}: config must be a mapping, got ${describe(raw)}`);
  }
  const config = raw ?? {};
  const unknown = Object.keys(config).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${PLUGIN_NAME}: config has unknown key(s) ${unknown.join(', ')} — config is { ${KNOWN_KEYS.join(', ')} }`);
  }

  return Object.freeze({
    /** Suppress the toast while the user is looking at the session that just finished. */
    onlyWhenAway: readBoolean(config, 'onlyWhenAway', true),
    /** Also toast when a subagent session finishes. Off: root sessions only. */
    includeSubagents: readBoolean(config, 'includeSubagents', false),
    /** Optional static toast title. When omitted, the session's display title is used. */
    title: readString(config, 'title', undefined),
    /** Toast body copy. */
    body: readString(config, 'body', DEFAULT_BODY),
  });
}
