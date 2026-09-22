import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, inject, name } from '../index.js';
import { PLUGIN_NAME, resolveConfig } from '../lib/config.js';
import { createFakeCtx } from '../test-support/harness.mjs';

test('the module exports the Cordis plugin shape', () => {
  assert.equal(name, PLUGIN_NAME);
  assert.deepEqual(inject, ['settings']);
  assert.equal(typeof apply, 'function');
});

test('apply validates config, provides notifyAway, and logs a ready line', () => {
  const ctx = createFakeCtx();
  apply(ctx, undefined);
  assert.deepEqual(ctx.provided.notifyAway.config, resolveConfig(undefined));
  assert.ok(Object.isFrozen(ctx.provided.notifyAway));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready') && line.includes('onlyWhenAway=true') && line.includes('completion=true')));
});

test('apply rejects a typo in the host-row config', () => {
  const ctx = createFakeCtx();
  assert.throws(() => apply(ctx, { onlyWhenAway: 'sometimes' }), /must be a boolean/);
});

test('apply registers the notify-away settings namespace when settings is present', () => {
  const installed = [];
  const settings = {
    installSection(owner, ns, schema, entry, hooks) {
      installed.push({ owner, ns, schema, entry, hooks });
      hooks.setSource(() => schema(entry));
      hooks.onChange();
    },
  };
  const ctx = createFakeCtx({ settings });
  apply(ctx, { approval: false });
  assert.equal(installed.length, 1);
  assert.equal(installed[0].ns, 'notify-away');
  assert.equal(typeof installed[0].schema, 'function');
  assert.equal(installed[0].entry.approval, false);
  assert.equal(installed[0].entry.completion, true);
  assert.deepEqual(installed[0].schema({}), {
    completion: true,
    approval: true,
    question: true,
    planReview: true,
    otherWait: true,
  });
  assert.equal(installed[0].owner, ctx);
});

test('apply still mounts when settings is absent (UI-less profiles)', () => {
  const ctx = createFakeCtx();
  apply(ctx, undefined);
  assert.equal(ctx.settings, undefined);
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});

test('a colliding notifyAway service does not prevent the row from mounting', () => {
  const ctx = createFakeCtx({ provideThrows: true });
  apply(ctx, undefined);
  assert.ok(ctx.warnings.some((line) => line.includes('could not be provided')));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});
