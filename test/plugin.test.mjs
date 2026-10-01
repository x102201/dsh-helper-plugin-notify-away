import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apply, inject, name, Config } from '../index.js';
import { PLUGIN_NAME, resolveConfig } from '../lib/config.js';
import { createFakeCtx } from '../test-support/harness.mjs';

test('the module exports the Cordis plugin shape', () => {
  assert.equal(name, PLUGIN_NAME);
  // The row injects nothing so it stays an active Loader entry (the client
  // scanner reads dsh.client from it) and mounts in profiles with no Settings.
  assert.deepEqual(inject, []);
  assert.equal(typeof apply, 'function');
});

test('the module exports a Config schema (when schemastery is available)', () => {
  // Config may be undefined in environments without schemastery,
  // but in the test environment (running inside the DSH profile)
  // schemastery should be resolvable.
  if (Config !== undefined) {
    assert.equal(typeof Config, 'function');
    assert.equal(Config.type, 'object');
    // Every live switch is volatile, so the page can change it without a restart.
    const dict = Config.dict;
    assert.equal(dict.completion.meta.volatile, true);
    assert.equal(dict.approval.meta.volatile, true);
    assert.equal(dict.question.meta.volatile, true);
    assert.equal(dict.planReview.meta.volatile, true);
    assert.equal(dict.otherWait.meta.volatile, true);
    assert.equal(dict.onlyWhenAway.meta.volatile, true);
    assert.equal(dict.includeSubagents.meta.volatile, true);
    assert.equal(dict.title.meta.volatile, undefined);
    assert.equal(dict.body.meta.volatile, undefined);
  }
});

test('apply validates config, provides notifyAway, and logs a ready line', () => {
  const ctx = createFakeCtx();
  apply(ctx, undefined);
  assert.deepEqual(ctx.provided.notifyAway.config, resolveConfig(undefined));
  assert.ok(Object.isFrozen(ctx.provided.notifyAway));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready') && line.includes('onlyWhenAway=false') && line.includes('completion=true')));
});

test('apply rejects a typo in the host-row config', () => {
  const ctx = createFakeCtx();
  assert.throws(() => apply(ctx, { onlyWhenAway: 'sometimes' }), /must be a boolean/);
});

test('apply installs the page policy through an optional settings child', () => {
  const configured = [];
  const settings = {
    configure(policy, fiber) {
      configured.push({ policy, fiber });
      return () => {}; // disposer
    },
  };
  const ctx = createFakeCtx({ settings });
  apply(ctx, { approval: false });
  assert.equal(configured.length, 1);
  // auto: false — this plugin ships its own page into the Plugins panel.
  assert.equal(configured[0].policy.auto, false);
  assert.equal(configured[0].fiber, ctx.fiber);
});

test('apply configures nothing when no settings service exists', () => {
  const ctx = createFakeCtx();
  apply(ctx, undefined);
  assert.equal(ctx.settings, undefined);
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});

test('a settings service without configure() is warned about, not fatal', () => {
  const ctx = createFakeCtx({ settings: {} });
  apply(ctx, undefined);
  assert.ok(ctx.warnings.some((line) => line.includes('configure is not available')));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});

test('a colliding notifyAway service does not prevent the row from mounting', () => {
  const ctx = createFakeCtx({ provideThrows: true });
  apply(ctx, undefined);
  assert.ok(ctx.warnings.some((line) => line.includes('could not be provided')));
  assert.ok(ctx.infos.some((line) => line.includes('notify-away ready')));
});
