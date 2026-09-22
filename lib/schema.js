/**
 * Settings schema for the notify-away namespace.
 *
 * Host `installSection` wants a callable schemastery schema. A linked install
 * cannot import `@deepseek-ai/schemastery` from this package's real path, so
 * we resolve it from the running profile when present and otherwise serve a
 * compatible fallback (callable + `toJSON` envelope + `type`/`dict` tree).
 *
 * @module dsh-helper-plugin-notify-away/lib/schema
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EVENT_KEYS } from './config.js';

/** Walk `start` and its parents looking for a `node_modules` that holds schemastery. */
function collectRoots(start, into) {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (dir) into.add(dir);
    const parent = dir ? dirname(dir) : '';
    if (!parent || parent === dir) break;
    dir = parent;
  }
}

/**
 * Load schemastery from the profile / DSH_HOME / cwd, never from a bare
 * import of this file (that would break `link:` installs).
 *
 * @returns {Function | undefined} schemastery's default export, when found.
 */
function tryLoadSchemastery() {
  const roots = new Set();
  collectRoots(process.cwd(), roots);
  if (process.env.DSH_HOME) {
    collectRoots(process.env.DSH_HOME, roots);
    roots.add(join(process.env.DSH_HOME, 'profiles'));
    roots.add(join(process.env.DSH_HOME, 'profiles', 'web'));
    roots.add(join(process.env.DSH_HOME, '.dsh', 'profiles'));
    // helper layout: DSH_HOME is `<env>/.dsh`, runtime packages live in `<env>/dsh`.
    roots.add(join(process.env.DSH_HOME, '..', 'dsh'));
  }
  roots.add(join(process.cwd(), '.dsh', 'profiles'));
  roots.add(join(process.cwd(), '.dsh', 'profiles', 'web'));
  roots.add(join(process.cwd(), '..', 'dsh'));

  for (const root of roots) {
    const pkg = join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json');
    if (!existsSync(pkg)) continue;
    try {
      const loaded = createRequire(pkg)('@deepseek-ai/schemastery');
      return loaded?.default ?? loaded;
    } catch {
      // Try the next root.
    }
  }
  return undefined;
}

/** Fallback schema when schemastery is not resolvable from this process. */
function createFallbackSchema() {
  const dict = {};
  const refs = {};
  let uid = 1;
  for (const key of EVENT_KEYS) {
    refs[String(uid)] = { type: 'boolean', meta: { default: true } };
    dict[key] = uid;
    uid += 1;
  }
  const objectUid = uid;
  refs[String(objectUid)] = {
    type: 'object',
    meta: { default: {} },
    dict,
  };

  function schema(data) {
    const input = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const out = {};
    for (const key of EVENT_KEYS) {
      const value = input[key];
      if (value === undefined) {
        out[key] = true;
        continue;
      }
      if (typeof value !== 'boolean') throw new Error(`notify-away: ${key} must be a boolean`);
      out[key] = value;
    }
    return out;
  }
  schema.type = 'object';
  schema.meta = { default: {} };
  schema.dict = Object.fromEntries(
    EVENT_KEYS.map((key) => [key, { type: 'boolean', meta: { default: true } }]),
  );
  schema.toJSON = () => ({ uid: objectUid, refs });
  return schema;
}

/**
 * Schema served to `ctx.settings.installSection` for the event-kind switches.
 *
 * @returns {Function} a callable schema that fills omitted keys with `true`.
 */
export function createEventSettingsSchema() {
  const z = tryLoadSchemastery();
  if (z && typeof z.object === 'function' && typeof z.boolean === 'function') {
    const fields = {};
    for (const key of EVENT_KEYS) fields[key] = z.boolean().default(true);
    return z.object(fields);
  }
  return createFallbackSchema();
}

/** Event-flag subset of a resolved plugin config, used as the settings `base`. */
export function eventSettingsEntry(config) {
  const entry = {};
  for (const key of EVENT_KEYS) entry[key] = config[key] !== false;
  return entry;
}
