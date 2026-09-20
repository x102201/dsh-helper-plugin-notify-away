import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, inject, name } from '../index.js';
import { PLUGIN_NAME, resolveConfig } from '../lib/config.js';
import { createFakeCtx } from '../test-support/harness.mjs';

test('the module exports the Cordis plugin shape', () => {
  assert.equal(name, PLUGIN_NAME);
  assert.deepEqual(inject, []);
  assert.equal(typeof apply, 'function');
});

test('apply validates config, provides notifyAway, and logs a ready line', () => {
  const ctx = createFakeCtx();
  apply(ctx, undefined);
  assert.deepEqual(ctx.provided.notifyAway.config, resolveConfig(undefined));
  assert.ok(Object.isFrozen(ctx.provided.notifyAway));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready') && line.includes('onlyWhenAway=true')));
});

test('apply rejects a typo in the host-row config', () => {
  const ctx = createFakeCtx();
  assert.throws(() => apply(ctx, { onlyWhenAway: 'sometimes' }), /must be a boolean/);
});

test('a colliding notifyAway service does not prevent the row from mounting', () => {
  const ctx = createFakeCtx({ provideThrows: true });
  apply(ctx, undefined);
  assert.ok(ctx.warnings.some((line) => line.includes('could not be provided')));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});
