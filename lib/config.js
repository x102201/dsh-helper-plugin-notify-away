/**
 * Configuration for the notify-away plugin.
 *
 * Config is validated at plugin load. Unknown keys, wrong types, and blank
 * strings throw, because a typo in a patch layer should fail loudly at boot
 * instead of silently leaving the plugin on its defaults.
 *
 * Event switches default to on (the user can turn kinds off). The browser
 * half inlines the same defaults. Helper may overlay them at runtime via
 * `window.__dshHelperNotifyAway`; a Loader-passed row config is merged too.
 *
 * @module dsh-helper-plugin-notify-away/lib/config
 */

/** The plugin name used in diagnostics and as the client ModuleLoader id. */
export const PLUGIN_NAME = 'dsh-helper-plugin-notify-away';

/** Settings namespace shown on 插件配置; must match the client card slot key. */
export const SETTINGS_NAMESPACE = 'notify-away';

/** Default toast body when a session finishes. */
export const DEFAULT_BODY = 'Task finished.';

/** Toast kinds the user can turn off. All default to true. */
export const EVENT_KEYS = Object.freeze([
  'completion',
  'approval',
  'question',
  'planReview',
  'otherWait',
]);

/** Every accepted config key, for the unknown-key diagnostic. */
const KNOWN_KEYS = Object.freeze([
  'onlyWhenAway',
  'includeSubagents',
  'title',
  'body',
  ...EVENT_KEYS,
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

  const events = {};
  for (const key of EVENT_KEYS) {
    events[key] = readBoolean(config, key, true);
  }

  return Object.freeze({
    /** Suppress the toast while the user is looking at the session that just finished. */
    onlyWhenAway: readBoolean(config, 'onlyWhenAway', true),
    /** Also toast when a subagent session finishes. Off: root sessions only. */
    includeSubagents: readBoolean(config, 'includeSubagents', false),
    /** Optional static toast title. When omitted, the session's display title is used. */
    title: readString(config, 'title', undefined),
    /** Toast body copy for the completion event. */
    body: readString(config, 'body', DEFAULT_BODY),
    /** Idle edge: running → idle. Cancelled turns also go idle. */
    completion: events.completion,
    /** Pending kind `approval`. */
    approval: events.approval,
    /** Pending kind `question`. */
    question: events.question,
    /** Pending kind `plan-review`. */
    planReview: events.planReview,
    /** Any later pending kind the sidebar does not name yet. */
    otherWait: events.otherWait,
  });
}
