import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, moderationLabel } from '../js/blob-ui-utils.mjs';

test('escapes user-controlled text before HTML insertion', () => {
  assert.equal(escapeHtml(`<img src=x onerror="run()" '&>`), '&lt;img src=x onerror=&quot;run()&quot; &#39;&amp;&gt;');
  assert.equal(escapeHtml(null), '');
});

test('maps moderation states to owner-facing labels without trusting unknown values', () => {
  assert.equal(moderationLabel('pending'), 'Awaiting safety check');
  assert.equal(moderationLabel('approved'), 'Safety checked');
  assert.equal(moderationLabel('review'), 'Needs manual review');
  assert.equal(moderationLabel('<script>'), 'Status unavailable');
});