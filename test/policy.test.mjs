import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyForWait, isDocumentAway, isSubagent, shouldNotify, shouldTrack, watchCompletions, watchPending } from '../lib/policy.js';
import { createFakePendingStore, createFakeSessionList, pending, summary } from '../test-support/harness.mjs';

test('shouldNotify is silent only while looking at the session that just finished', () => {
  assert.equal(shouldNotify({ sessionId: 'a', current: 'a', away: false }), false);
  assert.equal(shouldNotify({ sessionId: 'a', current: 'a', away: true }), true);
  assert.equal(shouldNotify({ sessionId: 'a', current: 'b', away: false }), true);
  assert.equal(shouldNotify({ sessionId: 'a', current: undefined, away: false }), true);
});

test('onlyWhenAway: false notifies even while watching', () => {
  assert.equal(shouldNotify({ sessionId: 'a', current: 'a', away: false, onlyWhenAway: false }), true);
});

test('isSubagent matches the client SessionSummary child markers', () => {
  assert.equal(isSubagent(summary({ id: 'root', running: false })), false);
  assert.equal(isSubagent(summary({ id: 'child', running: false, origin: 'subagent' })), true);
  assert.equal(isSubagent(summary({ id: 'child', running: false, parentId: 'root' })), true);
});

test('shouldTrack skips subagents unless includeSubagents is on', () => {
  const child = summary({ id: 'child', origin: 'subagent' });
  assert.equal(shouldTrack(child, false), false);
  assert.equal(shouldTrack(child, true), true);
  assert.equal(shouldTrack(summary({ id: 'root' }), false), true);
});

test('isDocumentAway is true when the tab is hidden or unfocused', () => {
  assert.equal(isDocumentAway({ visibilityState: 'hidden', hasFocus: () => true }), true);
  assert.equal(isDocumentAway({ visibilityState: 'visible', hasFocus: () => false }), true);
  assert.equal(isDocumentAway({ visibilityState: 'visible', hasFocus: () => true }), false);
  assert.equal(isDocumentAway({ visibilityState: 'visible' }), false);
});

test('isDocumentAway trusts helper appFocused over document.hasFocus', () => {
  assert.equal(
    isDocumentAway({ visibilityState: 'visible', hasFocus: () => true, appFocused: false }),
    true,
    'Alt+Tab away from helper: WebView2 hasFocus often stays true',
  );
  assert.equal(
    isDocumentAway({ visibilityState: 'visible', hasFocus: () => false, appFocused: true }),
    false,
    'clicking helper chrome unfocuses the panel but the app is still in front',
  );
});

test('isDocumentAway treats another instance on screen as away', () => {
  assert.equal(
    isDocumentAway({
      visibilityState: 'visible',
      hasFocus: () => true,
      appFocused: true,
      panelVisible: false,
    }),
    true,
    'working in instance B: instance A is still "focused" to WebView2',
  );
  assert.equal(
    isDocumentAway({
      visibilityState: 'visible',
      hasFocus: () => true,
      appFocused: true,
      panelVisible: true,
    }),
    false,
    'this instance is the one on screen and helper is in front',
  );
});

test('watchCompletions ignores the first observation, including an already-idle session', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: false }) },
    current: 'a',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => true);
  assert.deepEqual(fired, []);
});

test('watchCompletions fires once on running → idle when the user is away', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => true);
  assert.deepEqual(fired, []);

  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.deepEqual(fired, ['a']);

  list.set({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: false }) },
    current: 'a',
  });
  assert.deepEqual(fired, ['a'], 'a later idle snapshot is not another edge');
});

test('watchCompletions stays silent when the user is looking at that session', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => false);
  list.set({
    byId: { a: summary({ id: 'a', running: false }) },
    current: 'a',
  });
  assert.deepEqual(fired, []);
});

test('watchCompletions still fires when a background session finishes while you watch another', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      a: summary({ id: 'a', running: false }),
      b: summary({ id: 'b', running: true }),
    },
    current: 'a',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => false);
  list.set({
    byId: {
      a: summary({ id: 'a', running: false }),
      b: summary({ id: 'b', running: false }),
    },
    current: 'a',
  });
  assert.deepEqual(fired, ['b']);
});

test('watchCompletions does not toast subagent completions by default', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      root: summary({ id: 'root', running: false }),
      child: summary({ id: 'child', running: true, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => true);
  list.set({
    byId: {
      root: summary({ id: 'root', running: false }),
      child: summary({ id: 'child', running: false, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  assert.deepEqual(fired, []);
});

test('watchCompletions toasts subagents when includeSubagents is on', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      child: summary({ id: 'child', running: true, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => true, { includeSubagents: true });
  list.set({
    byId: {
      child: summary({ id: 'child', running: false, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  assert.deepEqual(fired, ['child']);
});

test('watchCompletions drops rows that leave the list', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  watchCompletions(list, (row) => fired.push(row.id), () => true);
  list.set({ byId: {}, current: undefined });
  list.set({
    byId: { a: summary({ id: 'a', running: false }) },
    current: 'a',
  });
  assert.deepEqual(fired, [], 'a reappearing idle row is a first observation, not an edge');
});

test('the disposer unsubscribes', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const stop = watchCompletions(list, (row) => fired.push(row.id), () => true);
  stop();
  list.set({
    byId: { a: summary({ id: 'a', running: false }) },
    current: 'a',
  });
  assert.deepEqual(fired, []);
});

test('bodyForWait prefers the asker reason, then the first question, then kind copy', () => {
  assert.equal(
    bodyForWait(pending({ sessionId: 'a', kind: 'approval', reason: '  escalate sandbox to danger-full-access  ' })),
    'escalate sandbox to danger-full-access',
  );
  assert.equal(
    bodyForWait(pending({ sessionId: 'a', kind: 'question', questions: [{ question: ' Which model? ' }] })),
    'Which model?',
  );
  assert.equal(bodyForWait(pending({ sessionId: 'a', kind: 'approval' })), 'Waiting for approval');
  assert.equal(bodyForWait(pending({ sessionId: 'a', kind: 'question' })), 'Waiting for answer');
  assert.equal(bodyForWait(pending({ sessionId: 'a', kind: 'plan-review' })), 'Plan awaiting review');
  assert.equal(bodyForWait(pending({ sessionId: 'a', kind: 'future-block' })), 'Waiting for you.');
  assert.equal(bodyForWait(undefined), 'Waiting for you.');
});

test('watchPending ignores the first observation, including an already-waiting session', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore([
    ['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })],
  ]);
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => true);
  assert.deepEqual(fired, []);
});

test('watchPending fires once when a session newly waits and the user is away', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', displayTitle: 'A', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => true);
  assert.deepEqual(fired, []);

  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  assert.deepEqual(fired, ['ask-1']);

  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  assert.deepEqual(fired, ['ask-1'], 'the same pending key is not another edge');
});

test('watchPending fires again when a replacement request uses a new key', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => true);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-2' })]]);
  assert.deepEqual(fired, ['ask-1', 'ask-2']);
});

test('watchPending stays silent when the user is looking at that session', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => false);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'question', key: 'q-1' })]]);
  assert.deepEqual(fired, []);
});

test('watchPending still fires when a background session waits while you watch another', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      a: summary({ id: 'a', running: false }),
      b: summary({ id: 'b', running: true }),
    },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.summary.id), () => false);
  pendingStore.set([['b', pending({ sessionId: 'b', kind: 'plan-review', key: 'plan-1' })]]);
  assert.deepEqual(fired, ['b']);
});

test('watchPending does not toast subagent waits by default', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      root: summary({ id: 'root', running: true }),
      child: summary({ id: 'child', running: true, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.summary.id), () => true);
  pendingStore.set([['child', pending({ sessionId: 'child', kind: 'approval', key: 'ask-1' })]]);
  assert.deepEqual(fired, []);
});

test('watchPending toasts subagent waits when includeSubagents is on', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: {
      child: summary({ id: 'child', running: true, origin: 'subagent', parentId: 'root' }),
    },
    current: 'root',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.summary.id), () => true, { includeSubagents: true });
  pendingStore.set([['child', pending({ sessionId: 'child', kind: 'approval', key: 'ask-1' })]]);
  assert.deepEqual(fired, ['child']);
});

test('watchPending toasts an unknown future pending kind the same way', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.kind), () => true);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'future-block', key: 'x-1' })]]);
  assert.deepEqual(fired, ['future-block']);
});

test('watchPending clearing a wait is not a notify edge', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => true);
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  pendingStore.set([]);
  assert.deepEqual(fired, ['ask-1']);
});

test('the pending disposer unsubscribes', () => {
  const fired = [];
  const list = createFakeSessionList({
    byId: { a: summary({ id: 'a', running: true }) },
    current: 'a',
  });
  const pendingStore = createFakePendingStore();
  const stop = watchPending(list, pendingStore, (event) => fired.push(event.interaction.key), () => true);
  stop();
  pendingStore.set([['a', pending({ sessionId: 'a', kind: 'approval', key: 'ask-1' })]]);
  assert.deepEqual(fired, []);
});
