import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_BODY, EVENT_KEYS, PLUGIN_NAME, SETTINGS_NAMESPACE, resolveConfig } from '../lib/config.js';

test('defaults describe Cursor-like away-only notifications for root sessions', () => {
  const config = resolveConfig(undefined);
  assert.equal(config.onlyWhenAway, true);
  assert.equal(config.includeSubagents, false);
  assert.equal(config.title, undefined);
  assert.equal(config.body, DEFAULT_BODY);
  for (const key of EVENT_KEYS) assert.equal(config[key], true);
  assert.ok(Object.isFrozen(config));
});

test('a bare row (no config) and an empty mapping are equivalent', () => {
  assert.deepEqual(resolveConfig(undefined), resolveConfig({}));
});

test('each key can be overridden', () => {
  const config = resolveConfig({
    onlyWhenAway: false,
    includeSubagents: true,
    title: 'DeepSeek Harness',
    body: 'Done.',
    completion: false,
    approval: false,
    question: false,
    planReview: false,
    otherWait: false,
  });
  assert.equal(config.onlyWhenAway, false);
  assert.equal(config.includeSubagents, true);
  assert.equal(config.title, 'DeepSeek Harness');
  assert.equal(config.body, 'Done.');
  for (const key of EVENT_KEYS) assert.equal(config[key], false);
});

test('unknown keys fail at load', () => {
  assert.throws(
    () => resolveConfig({ onlyWhenAway: true, sound: true }),
    (error) => error instanceof Error && error.message.includes('unknown key') && error.message.includes('sound'),
  );
});

test('wrong types fail at load', () => {
  assert.throws(() => resolveConfig(null), /must be a mapping/);
  assert.throws(() => resolveConfig([]), /must be a mapping/);
  assert.throws(() => resolveConfig({ onlyWhenAway: 'yes' }), /must be a boolean/);
  assert.throws(() => resolveConfig({ includeSubagents: 1 }), /must be a boolean/);
  assert.throws(() => resolveConfig({ completion: 'off' }), /must be a boolean/);
  assert.throws(() => resolveConfig({ approval: 0 }), /must be a boolean/);
  assert.throws(() => resolveConfig({ body: '' }), /must be a non-empty string/);
  assert.throws(() => resolveConfig({ title: '   ' }), /must be a non-empty string/);
});

test('the plugin name is stable for diagnostics and the client bundle id', () => {
  assert.equal(PLUGIN_NAME, 'dsh-helper-plugin-notify-away');
});

test('event keys default on and are the documented kind switches', () => {
  assert.deepEqual([...EVENT_KEYS], ['completion', 'approval', 'question', 'planReview', 'otherWait']);
  assert.equal(SETTINGS_NAMESPACE, 'notify-away');
});
