import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_BODY, PLUGIN_NAME, resolveConfig } from '../lib/config.js';

test('defaults describe Cursor-like away-only notifications for root sessions', () => {
  const config = resolveConfig(undefined);
  assert.equal(config.onlyWhenAway, true);
  assert.equal(config.includeSubagents, false);
  assert.equal(config.title, undefined);
  assert.equal(config.body, DEFAULT_BODY);
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
  });
  assert.equal(config.onlyWhenAway, false);
  assert.equal(config.includeSubagents, true);
  assert.equal(config.title, 'DeepSeek Harness');
  assert.equal(config.body, 'Done.');
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
  assert.throws(() => resolveConfig({ body: '' }), /must be a non-empty string/);
  assert.throws(() => resolveConfig({ title: '   ' }), /must be a non-empty string/);
});

test('the plugin name is stable for diagnostics and the client bundle id', () => {
  assert.equal(PLUGIN_NAME, 'dsh-helper-plugin-notify-away');
});
