const test = require('node:test');
const assert = require('node:assert/strict');
const { isLegacyPublicBlob } = require('../scripts/queue-legacy-public-moderation');

test('queues only active public Gists without a moderation state', () => {
  assert.equal(isLegacyPublicBlob({ visibility: 'public', status: 'active' }), true);
  assert.equal(isLegacyPublicBlob({ visibility: 'private', status: 'active' }), false);
  assert.equal(isLegacyPublicBlob({ visibility: 'public', status: 'uploading' }), false);
  assert.equal(isLegacyPublicBlob({ visibility: 'public', status: 'active', moderationStatus: 'approved' }), false);
});