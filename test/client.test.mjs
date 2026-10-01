/**
 * Drive the real `client.js` ModuleLoader factory in Node: the same file the
 * Web UI serves, with a fake `Notification` and a fake sessions list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createFakePendingStore, createFakeSessionList, pending, summary } from '../test-support/harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A Notification stand-in that records every toast. */
function installNotification(permission = 'granted') {
  const instances = [];
  class FakeNotification {
    static permission = permission;
    static requestPermissionCalls = 0;
    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.onclick = null;
      instances.push(this);
    }
    static requestPermission() {
      FakeNotification.requestPermissionCalls += 1;
      FakeNotification.permission = 'granted';
      return Promise.resolve('granted');
    }
  }
  return { FakeNotification, instances };
}

function createFakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useRef(value) {
      return { current: value };
    },
  };
}

function createFakeSettingsHost(value = {}) {
  const flags = {
    completion: true,
    approval: true,
    question: true,
    planReview: true,
    otherWait: true,
    ...value,
  };
  const listeners = new Set();
  /** Push a snapshot to every subscriber, the way the settings mirror does. */
  const publish = () => {
    for (const listener of listeners) listener();
  };
  // The 0.2 shape: one ConfigForm per namespace, over the shared settings
  // mirror. `get` returns it, `whileServed` keeps a page registered while the
  // Host serves the namespace.
  const form = {
    getSnapshot() {
      return {
        status: 'ready',
        value: { ...flags },
        writable: true,
        revision: 1,
        user: { ...flags },
        mode: 'host',
        base: {
          completion: true,
          approval: true,
          question: true,
          planReview: true,
          otherWait: true,
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async mutate(ops) {
      for (const op of ops) {
        const key = op.path[0];
        if (op.op === 'set') flags[key] = op.value;
        if (op.op === 'unset') delete flags[key];
      }
      publish();
      return true;
    },
  };
  const served = [];
  const configForms = {
    get(namespace) {
      served.push(String(namespace));
      return form;
    },
    whileServed(namespaces, register) {
      return register(new Set(namespaces.map(String)));
    },
  };
  const slotRegs = [];
  const slots = {
    inject(_name, factory) {
      const produced = factory();
      if (produced && typeof produced.next === 'function') {
        for (const item of produced) slotRegs.push(item);
      } else {
        slotRegs.push(produced);
      }
      return () => {};
    },
    register(options, component) {
      const entry = { options, component };
      slotRegs.push(entry);
      return entry;
    },
  };
  const localeDicts = new Map();
  const localeRegistrations = [];
  const locale = {
    register(ns, dicts) {
      localeRegistrations.push(ns);
      localeDicts.set(ns, dicts);
      return () => localeDicts.delete(ns);
    },
    bind(ns) {
      return (key) => localeDicts.get(ns)?.zh?.[key] ?? key;
    },
  };
  return {
    form,
    configForms,
    slots,
    locale,
    slotRegs,
    flags,
    listeners,
    publish,
    localeRegistrations,
    served,
  };
}
function loadClient() {
  const registrations = [];
  const listeners = new Map();
  const window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
      return true;
    },
    focus() {
      window.focused = true;
    },
    focused: false,
  };
  const context = vm.createContext({
    window,
    console,
    Map,
    Set,
    JSON,
    String,
    Notification: undefined,
    document: undefined,
  });
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'client.js' });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'dsh-helper-plugin-notify-away');
  const exported = registrations[0].factory((id) => {
    if (id === 'react') return createFakeReact();
    throw new Error(`unexpected require(${JSON.stringify(id)})`);
  });
  return { exported, window, context };
}

/** Mount the client over a fake sessions list and Notification. */
function mountClient({
  permission = 'granted',
  focused = false,
  hidden = false,
  list,
  pendingStore,
  helper = false,
  appFocused,
  panelVisible,
  config,
  overlay,
  settingsValue,
  localeAbsent = false,
} = {}) {
  const { exported, window, context } = loadClient();
  const { FakeNotification, instances } = installNotification(permission);
  context.Notification = FakeNotification;
  window.Notification = FakeNotification;
  const posted = [];
  if (helper) {
    window.chrome = {
      webview: {
        postMessage(payload) {
          posted.push(payload);
        },
      },
    };
  }
  if (typeof appFocused === 'boolean') {
    window.__dshHelperAppFocused = appFocused;
  }
  if (typeof panelVisible === 'boolean') {
    window.__dshHelperPanelVisible = panelVisible;
  }
  if (overlay !== undefined) {
    window.__dshHelperNotifyAway = overlay;
  }
  const document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    hasFocus: () => focused,
    querySelector: () => null,
    createElement: (tag) => ({
      dataset: {},
      tag,
    }),
    head: { appendChild() {} },
  };
  context.document = document;
  const opened = [];
  const sessions = {
    list: list ?? createFakeSessionList({ byId: {}, current: undefined }),
    open: (id) => opened.push(id),
  };
  const uiSession = {
    pendingInteractions: pendingStore ?? createFakePendingStore(),
  };
  const settingsHost = settingsValue !== undefined ? createFakeSettingsHost(settingsValue) : undefined;
  const ctx = {
    sessions,
    uiSession,
    effect(callback) {
      return callback();
    },
    inject(names, callback) {
      const want = names.map((n) => String(n));
      if (want.length === 1 && want[0] === 'uiSession') {
        callback({
          sessions,
          uiSession,
          effect(fn) {
            return fn();
          },
        });
        return;
      }
      if (settingsHost && want.includes('configForms')) {
        // Model cordis 4: a sibling-provided service is reachable only through
        // the non-strict `ctx.get(name)`; reading `ctx.<service>` from a fiber
        // that never injected it throws, and a throw here aborted the card
        // registration before it happened.
        const owner = {
          sessions,
          uiSession,
          effect(fn) {
            return fn();
          },
          configForms: settingsHost.configForms,
          slots: settingsHost.slots,
          get(name) {
            return !localeAbsent && name === 'locale' ? settingsHost.locale : undefined;
          },
        };
        Object.defineProperty(owner, 'locale', {
          get() {
            throw new Error('cannot get property "locale" without inject');
          },
        });
        callback(owner);
      }
    },
  };
  exported.apply(ctx, config);
  return { exported, window, document, FakeNotification, instances, opened, sessions, uiSession, ctx, posted, settingsHost };
}

test('the client factory exports the browser plugin shape', () => {
  const { exported } = loadClient();
  assert.equal(exported.name, 'dsh-helper-plugin-notify-away');
  // `inject` is an array constructed inside the vm, so it is not `Array` in
  // this realm; compare by contents rather than `deepEqual`.
  assert.equal(exported.inject.length, 1);
  assert.equal(String(exported.inject[0]), 'sessions');
  assert.equal(typeof exported.apply, 'function');
});

test('a running → idle edge while away raises one tagged notification', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'Fix retries', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ focused: false, list });
  assert.equal(instances.length, 0);

  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'Fix retries', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].title, 'Fix retries');
  assert.equal(instances[0].options.body, 'Task finished.');
  assert.equal(instances[0].options.tag, 'notify-away:a');
});

test('looking at the finishing session stays silent when onlyWhenAway is on', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({
    focused: true,
    hidden: false,
    list,
    settingsValue: { onlyWhenAway: true },
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
});

test('the shipped default toasts even while you look at the finishing session', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ focused: true, hidden: false, list });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 1, 'onlyWhenAway defaults off');
  assert.equal(instances[0].title, 'A');
});

test('a hidden tab notifies even if hasFocus still reports true', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ focused: true, hidden: true, list });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 1);
});

test('clicking the toast focuses the window and opens that session', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'b',
  });
  const { instances, opened, window } = mountClient({ focused: false, list });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'b',
  });
  assert.equal(typeof instances[0].onclick, 'function');
  instances[0].onclick();
  assert.equal(window.focused, true);
  assert.deepEqual(opened, ['a']);
});

test('a denied permission never toasts', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ permission: 'denied', focused: false, list });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
});

test('subagent completions stay silent in the shipped client defaults', () => {
  const list = createFakeSessionList({
    byId: {
      child: summary({ id: 'child', displayTitle: 'child', running: true, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  const { instances } = mountClient({ focused: false, list });
  list.set({
    byId: {
      child: summary({ id: 'child', displayTitle: 'child', running: false, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  assert.equal(instances.length, 0);
});

test('a helper WebView host posts a JSON string instead of using Notification', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'Fix retries', running: true }) },
    current: 'a',
  });
  const { instances, posted, FakeNotification } = mountClient({
    permission: 'denied',
    focused: false,
    helper: true,
    list,
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'Fix retries', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
  assert.equal(FakeNotification.requestPermissionCalls, 0);
  assert.equal(posted.length, 1);
  assert.equal(typeof posted[0], 'string');
  const payload = JSON.parse(posted[0]);
  assert.equal(payload.kind, 'notify-away');
  assert.equal(payload.title, 'Fix retries');
  assert.equal(payload.body, 'Task finished.');
  assert.equal(payload.sessionId, 'a');
  assert.equal(payload.tag, 'notify-away:a');
});

test('another instance on screen posts even when this panel still looks focused', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances, posted } = mountClient({
    focused: true,
    helper: true,
    appFocused: true,
    panelVisible: false,
    list,
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
  assert.equal(posted.length, 1);
});

test('helper appFocused=false posts even when document.hasFocus still reports true', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances, posted } = mountClient({
    focused: true,
    helper: true,
    appFocused: false,
    list,
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
  assert.equal(posted.length, 1);
});

test('a helper click event focuses the window and opens that session', () => {
  const { window, opened } = mountClient({ focused: false, helper: true });
  window.dispatchEvent({ type: 'dsh-helper-notify-click', detail: { sessionId: 'sess-1' } });
  assert.equal(window.focused, true);
  assert.deepEqual(opened, ['sess-1']);
});

test('a new approval wait while away raises a toast with the asker reason', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'Install plugins', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances } = mountClient({ focused: false, list, pendingStore });
  assert.equal(instances.length, 0);

  pendingStore.set([['a', pending({
    sessionId: 'a',
    kind: 'approval',
    key: 'ask-1',
    reason: 'escalate sandbox to danger-full-access: write into DSH_HOME',
  })]]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].title, 'Install plugins');
  assert.equal(instances[0].options.body, 'escalate sandbox to danger-full-access: write into DSH_HOME');
  assert.equal(instances[0].options.tag, 'notify-away:a');
});

test('looking at the waiting session stays silent when onlyWhenAway is on', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances } = mountClient({
    focused: true,
    hidden: false,
    list,
    pendingStore,
    settingsValue: { onlyWhenAway: true },
  });
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'question', key: 'q-1' })]]);
  assert.equal(instances.length, 0);
});

test('a helper host posts a wait toast instead of using Notification', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'Install plugins', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances, posted, FakeNotification } = mountClient({
    permission: 'denied',
    focused: false,
    helper: true,
    list,
    pendingStore,
  });
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'plan-review', key: 'plan-1' })]]);
  assert.equal(instances.length, 0);
  assert.equal(FakeNotification.requestPermissionCalls, 0);
  assert.equal(posted.length, 1);
  const payload = JSON.parse(posted[0]);
  assert.equal(payload.kind, 'notify-away');
  assert.equal(payload.title, 'Install plugins');
  assert.equal(payload.body, 'Plan awaiting review');
  assert.equal(payload.sessionId, 'a');
  assert.equal(payload.tag, 'notify-away:a');
});

test('a missing uiSession pending store still allows completion toasts', () => {
  const { exported, window, context } = loadClient();
  const { FakeNotification, instances } = installNotification('granted');
  context.Notification = FakeNotification;
  window.Notification = FakeNotification;
  context.document = {
    visibilityState: 'visible',
    hasFocus: () => false,
  };
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  exported.apply({
    sessions: { list, open() {} },
    uiSession: {},
    effect(callback) {
      return callback();
    },
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].options.body, 'Task finished.');
});

test('ctx.inject waits for uiSession before watching pending interactions', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'Install plugins', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { exported, window, context } = loadClient();
  const { FakeNotification, instances } = installNotification('granted');
  context.Notification = FakeNotification;
  window.Notification = FakeNotification;
  context.document = {
    visibilityState: 'visible',
    hasFocus: () => false,
  };
  let injected = [];
  exported.apply({
    sessions: { list, open() {} },
    effect(callback) {
      return callback();
    },
    inject(names, callback) {
      injected.push(Array.from(names, (n) => String(n)));
      if (!names.map(String).includes('uiSession')) return;
      callback({
        sessions: { list, open() {} },
        uiSession: { pendingInteractions: pendingStore },
        effect(fn) {
          return fn();
        },
      });
    },
  });
  assert.deepEqual(injected[0], ['uiSession']);
  assert.deepEqual(injected[1], ['slots', 'configForms']);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1', reason: 'escalate sandbox' })]]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].options.body, 'escalate sandbox');
});

test('apply config can turn completion toasts off', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ focused: false, list, config: { completion: false } });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
});

test('apply config can turn one wait kind off without silencing the others', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances } = mountClient({
    focused: false,
    list,
    pendingStore,
    config: { approval: false },
  });
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  assert.equal(instances.length, 0);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'question', key: 'q-1' })]]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].options.body, 'Waiting for answer');
});

test('window.__dshHelperNotifyAway overlays apply config and wins on conflict', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances } = mountClient({
    focused: false,
    list,
    pendingStore,
    config: { completion: true, approval: true },
    overlay: { completion: false, approval: false },
  });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  assert.equal(instances.length, 0);
});

test('the client registers its page on our own installed bundle card', () => {
  const { settingsHost } = mountClient({ focused: false, settingsValue: {} });
  const card = settingsHost.slotRegs.find(
    (entry) => entry.options && entry.options.name === 'plugins.bundle.config',
  );
  assert.ok(card);
  // Keyed by the package name, so it renders on this bundle's page — never in
  // the official plugin list (that is `plugins.item`).
  assert.equal(card.options.key, 'dsh-helper-plugin-notify-away');
  assert.equal(card.options.id, undefined);
  assert.deepEqual(settingsHost.served, ['notify-away']);
  assert.equal(typeof card.component, 'function');
});

test('configForms flags live-update completion toasts without remounting', async () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances, settingsHost } = mountClient({
    focused: false,
    list,
    settingsValue: { completion: true },
  });
  await settingsHost.form.mutate([{ op: 'set', path: ['completion'], value: false }]);
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
});

test('turning onlyWhenAway off notifies while you watch the session', async () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  // Focused on the very session that finishes: the away gate must normally
  // swallow this, and only the live switch may let it through.
  const { instances, settingsHost } = mountClient({
    focused: true,
    hidden: false,
    list,
    settingsValue: { onlyWhenAway: true },
  });
  await settingsHost.form.mutate([{ op: 'set', path: ['onlyWhenAway'], value: false }]);
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].title, 'A');
});

test('includeSubagents from the live settings value toasts child sessions', async () => {
  const list = createFakeSessionList({
    byId: { child: summary({ id: 'child', displayTitle: 'Child', running: true, parentId: 'root' }) },
    current: 'root',
  });
  const { instances, settingsHost } = mountClient({
    focused: false,
    list,
    settingsValue: { includeSubagents: false },
  });
  list.set({
    byId: { child: summary({ id: 'child', displayTitle: 'Child', running: false, parentId: 'root' }) },
    current: 'root',
  });
  assert.equal(instances.length, 0, 'the shipped default keeps subagents silent');
  await settingsHost.form.mutate([{ op: 'set', path: ['includeSubagents'], value: true }]);
  list.set({
    byId: { child: summary({ id: 'child', displayTitle: 'Child', running: true, parentId: 'root' }) },
    current: 'root',
  });
  list.set({
    byId: { child: summary({ id: 'child', displayTitle: 'Child', running: false, parentId: 'root' }) },
    current: 'root',
  });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].title, 'Child');
});

/** Mount the page, then read the store its slot registration injects. */
function cardStore(options = {}) {
  const mounted = mountClient({ focused: false, settingsValue: {}, ...options });
  const card = mounted.settingsHost.slotRegs.find(
    (entry) => entry.options && entry.options.name === 'plugins.bundle.config',
  );
  assert.ok(card, 'the plugins.bundle.config page must be registered');
  return { ...mounted, card, store: card.options.inject().hooks.notifyAwayCard };
}

test('the card store keeps its snapshot reference stable between renders', () => {
  const { store } = cardStore();
  const first = store.getSnapshot();
  // The renderer binds this to useSyncExternalStore: a new object per call
  // re-renders forever, React throws, and the slot error boundary swallows the
  // card. Repeated reads with nothing changed must hand back the same object.
  assert.equal(store.getSnapshot(), first);
  assert.equal(store.getSnapshot(), first);
  assert.equal(first.flags.completion, true);
  assert.equal(first.saving, false);
  assert.equal(first.failed, false);
});

test('clicking a switch writes it immediately and keeps the optimistic value', async () => {
  const { store, settingsHost } = cardStore();
  const first = store.getSnapshot();
  assert.equal(first.flags.onlyWhenAway, false, 'the shipped default is off');

  const accepted = await store.toggle('onlyWhenAway');
  assert.equal(accepted, true);
  assert.equal(settingsHost.flags.onlyWhenAway, true, 'the Host got the write');
  const toggled = store.getSnapshot();
  assert.notEqual(toggled, first);
  assert.equal(toggled.flags.onlyWhenAway, true);
  assert.equal(toggled.failed, false);
  assert.equal(store.getSnapshot(), toggled);

  // Flipping it back is another immediate write, not a draft.
  await store.toggle('onlyWhenAway');
  assert.equal(settingsHost.flags.onlyWhenAway, false);
  assert.equal(store.getSnapshot().flags.onlyWhenAway, false);
});

test('a rejected write reverts the switch and reports it', async () => {
  const { store, settingsHost } = cardStore();
  settingsHost.form.mutate = async () => false;
  const accepted = await store.toggle('question');
  assert.equal(accepted, false);
  const state = store.getSnapshot();
  assert.equal(state.failed, true, 'the card must say the write did not land');
  assert.equal(state.flags.question, true, 'the switch falls back to the saved value');
});

test('a snapshot from the Host cannot undo a switch the user just clicked', async () => {
  const { store, settingsHost } = cardStore();
  await store.toggle('approval');
  assert.equal(store.getSnapshot().flags.approval, false);
  // An unrelated document update arrives while the page is open: the old
  // draft-based store dropped the pending edit here, which is why "uncheck, then
  // save" used to write nothing at all.
  settingsHost.publish();
  assert.equal(store.getSnapshot().flags.approval, false, 'the click survives the snapshot');
});

test('a saved namespace change replaces the card snapshot once', async () => {
  const { store, settingsHost } = cardStore();
  const before = store.getSnapshot();
  await settingsHost.form.mutate([{ op: 'set', path: ['question'], value: false }]);
  const after = store.getSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.flags.question, false);
  assert.equal(store.getSnapshot(), after);
});

test('every switch of the page writes its own key', async () => {
  const { store, settingsHost } = cardStore();
  for (const key of ['onlyWhenAway', 'includeSubagents', 'completion', 'approval', 'question', 'planReview', 'otherWait']) {
    const before = store.getSnapshot().flags[key];
    await store.toggle(key);
    assert.equal(settingsHost.flags[key], !before, `${key} reached the Host`);
    assert.equal(store.getSnapshot().flags[key], !before);
  }
  assert.equal(store.getSnapshot().saving, false);
});

test('the card reads the ambient locale service without declaring it in inject', () => {
  // `owner.locale` throws under cordis unless the fiber injected it; the page
  // is registered with slots + configForms only, so it must use ctx.get().
  const { card, settingsHost } = cardStore();
  assert.deepEqual(settingsHost.localeRegistrations, ['notify-away']);
  assert.equal(card.options.locale, 'notify-away');
  const face = card.options.inject();
  assert.equal(face.t('title'), '离开时通知');
  assert.equal(face.t('plugin'), 'dsh-helper-plugin-notify-away');
  assert.ok(face.t('description').includes('dsh-helper-plugin-notify-away'));
  assert.ok(face.t('intro').includes('dsh-helper-plugin-notify-away'));
  assert.equal(face.t('completionHint'), '会话从运行变为结束时（取消也会结束）。');
});

test('the card names the plugin and links to GitHub', () => {
  const { card, store } = cardStore();
  const face = card.options.inject();
  assert.equal(face.t('plugin'), 'dsh-helper-plugin-notify-away');
  assert.ok(face.t('intro').includes('dsh-helper-plugin-notify-away'));
  const tree = card.component({
    ...face,
    useNotifyAwayCard: (selector) => selector(store.getSnapshot()),
  });
  assert.ok(JSON.stringify(tree).includes('dsh-helper-plugin-notify-away'));
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8');
  assert.ok(source.includes("PLUGIN_REPO = 'https://github.com/x102201/dsh-helper-plugin-notify-away'"));
  assert.ok(source.includes("href: PLUGIN_REPO"));
});

test('the page renders its body inline, without a second title or a collapse control', () => {
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8');
  // The panel draws the card title, icon, and crumb; a card that drew its own
  // header (the 0.1 settings-tab shape) would duplicate them.
  assert.equal(source.includes('dshNa_header'), false);
  assert.equal(source.includes('setOpen'), false);
  const { card, store } = cardStore();
  const tree = JSON.stringify(card.component({
    ...card.options.inject(),
    view: 'page',
    useNotifyAwayCard: (selector) => selector(store.getSnapshot()),
  }));
  assert.ok(tree.includes('dshNa_kinds'), 'the page draws its switches inline');
  assert.equal(tree.includes('dshNa_save'), false, 'every switch writes on click; there is no save button');
  assert.equal(tree.includes('dshNa_discard'), false, 'and nothing to discard');
  const face = card.options.inject();
  const summary = card.component({
    ...face,
    view: 'summary',
    useNotifyAwayCard: (selector) => selector(store.getSnapshot()),
  });
  assert.equal(summary, face.t('summary'), 'the summary view is the one-liner under the card title');
  assert.ok(summary.length > 0);
});

test('the card still registers and keeps copy when no locale face is installed', () => {
  const { card, store } = cardStore({ localeAbsent: true });
  assert.ok(card);
  assert.equal(card.options.locale, undefined);
  const face = card.options.inject();
  assert.equal(face.t('title'), '离开时通知');
  assert.equal(face.hooks.notifyAwayCard, store);
});
