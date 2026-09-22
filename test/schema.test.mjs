import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_KEYS } from '../lib/config.js';
import { createEventSettingsSchema, eventSettingsEntry } from '../lib/schema.js';

test('the event settings schema defaults every kind on and fills omitted keys', () => {
  const schema = createEventSettingsSchema();
  assert.equal(typeof schema, 'function');
  assert.deepEqual(schema({}), Object.fromEntries(EVENT_KEYS.map((key) => [key, true])));
  assert.equal(schema({ approval: false }).approval, false);
  assert.equal(schema({ approval: false }).question, true);
  const json = schema.toJSON();
  assert.equal(typeof json, 'object');
  assert.ok(json.refs || json.type === 'object');
});

test('eventSettingsEntry copies only the kind switches from a resolved config', () => {
  assert.deepEqual(eventSettingsEntry({
    onlyWhenAway: true,
    includeSubagents: false,
    completion: true,
    approval: false,
    question: true,
    planReview: true,
    otherWait: true,
  }), {
    completion: true,
    approval: false,
    question: true,
    planReview: true,
    otherWait: true,
  });
});
