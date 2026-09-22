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

/**
 * Load `client.js` inside a vm that supplies `window.__ModuleLoader__`.
 *
 * @returns {object} the factory's exports (`name`, `inject`, `apply`).
 */
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
  const exported = registrations[0].factory(() => {
    throw new Error('the notify-away client bundle must not require() anything');
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
  const document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    hasFocus: () => focused,
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
  const ctx = {
    sessions,
    uiSession,
    effect(callback) {
      return callback();
    },
  };
  exported.apply(ctx);
  return { exported, window, document, FakeNotification, instances, opened, sessions, uiSession, ctx, posted };
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

test('looking at the finishing session raises no notification', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const { instances } = mountClient({ focused: true, hidden: false, list });
  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.equal(instances.length, 0);
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

test('looking at the waiting session raises no wait toast', () => {
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const { instances } = mountClient({ focused: true, hidden: false, list, pendingStore });
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
  let injected;
  exported.apply({
    sessions: { list, open() {} },
    effect(callback) {
      return callback();
    },
    inject(names, callback) {
      injected = Array.from(names, (n) => String(n));
      callback({
        sessions: { list, open() {} },
        uiSession: { pendingInteractions: pendingStore },
        effect(fn) {
          return fn();
        },
      });
    },
  });
  assert.deepEqual(injected, ['uiSession']);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1', reason: 'escalate sandbox' })]]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].options.body, 'escalate sandbox');
});
