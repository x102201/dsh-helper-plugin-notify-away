/**
 * Test harness: a minimal stand-in for the Cordis tree the host row mounts into,
 * plus a sessions-list observable the browser half can watch.
 *
 * @module test-support/harness
 */

/**
 * Tiny `util.format` stand-in: Cordis loggers interpolate `%s` placeholders.
 *
 * @param {unknown[]} args - format string plus values.
 * @returns {string} the interpolated line.
 */
function formatLog(args) {
  if (args.length === 0) return '';
  const [head, ...rest] = args;
  if (typeof head !== 'string' || !/%[sdj%]/.test(head)) return args.map(String).join(' ');
  let index = 0;
  const body = head.replace(/%[sdj%]/g, (token) => {
    if (token === '%%') return '%';
    const value = rest[index];
    index += 1;
    return String(value);
  });
  return [body, ...rest.slice(index)].map(String).join(' ');
}

/**
 * The fake Cordis context: records `provide` and log lines.
 *
 * @param {object} [options] - harness options.
 * @param {boolean} [options.provideThrows] - make `ctx.provide` fail.
 * @returns {object} the context.
 */
export function createFakeCtx(options = {}) {
  const { provideThrows = false } = options;
  const warnings = [];
  const infos = [];
  const provided = {};
  const effects = [];

  const ctx = {
    warnings,
    infos,
    provided,
    effects,
    logger: {
      info: (...args) => infos.push(formatLog(args)),
      warn: (...args) => warnings.push(formatLog(args)),
      error: (...args) => warnings.push(formatLog(args)),
    },
    effect(callback, label) {
      effects.push({ label });
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    provide(serviceName, value) {
      if (provideThrows) throw new Error(`service "${serviceName}" has been registered`);
      provided[serviceName] = value;
      return () => {
        delete provided[serviceName];
      };
    },
  };
  return ctx;
}

/**
 * A mutable sessions-list observable matching the client `sessions.list` face.
 *
 * @param {object} [initial] - starting snapshot (`byId`, `current`).
 * @returns {object} `{ getSnapshot, subscribe, set }`.
 */
export function createFakeSessionList(initial = { byId: {}, current: undefined }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * One listed session row.
 *
 * @param {object} fields - summary fields.
 * @returns {object} a SessionSummary-shaped object.
 */
export function summary(fields) {
  return {
    id: fields.id,
    displayTitle: fields.displayTitle ?? fields.id,
    running: fields.running === true,
    blank: false,
    updatedAt: 0,
    ...fields.parentId !== undefined ? { parentId: fields.parentId } : {},
    ...fields.origin !== undefined ? { origin: fields.origin } : {},
  };
}
