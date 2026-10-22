const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { FieldPath, getFirestore } = require('firebase-admin/firestore');

const PAGE_SIZE = 400;

function isLegacyPublicBlob(blob) {
  return blob.visibility === 'public'
    && blob.status === 'active'
    && !Object.hasOwn(blob, 'moderationStatus');
}

async function queueLegacyPublicBlobs(db) {
  let cursor = null;
  let scanned = 0;
  let queued = 0;

  while (true) {
    let pageQuery = db.collection('blobs')
      .where('visibility', '==', 'public')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);

    const page = await pageQuery.get();
    if (page.empty) break;

    const batch = db.batch();
    let pageQueued = 0;
    for (const document of page.docs) {
      scanned += 1;
      if (!isLegacyPublicBlob(document.data())) continue;
      batch.update(document.ref, { moderationStatus: 'pending' });
      pageQueued += 1;
    }
    if (pageQueued) {
      await batch.commit();
      queued += pageQueued;
    }

    cursor = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  return { scanned, queued };
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to an authorized service-account JSON file.');
  }

  initializeApp({ credential: applicationDefault() });
  const result = await queueLegacyPublicBlobs(getFirestore());
  process.stdout.write(`Scanned ${result.scanned} public Gists; queued ${result.queued} for moderation.\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Legacy moderation queue failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { isLegacyPublicBlob, queueLegacyPublicBlobs };