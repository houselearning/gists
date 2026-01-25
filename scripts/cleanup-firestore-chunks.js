// scripts/cleanup-firestore-chunks.js
const admin = require("firebase-admin");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to service account JSON path.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function cleanup() {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const snap = await db.collection("blobs").where("status", "==", "active").get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const last = data.lastAccessedAt ? data.lastAccessedAt.toDate() : null;
    if (!last || last > cutoff) continue;

    // Delete chunk docs
    const chunksSnap = await db.collection(`blobs/${doc.id}/chunks`).get();
    for (const c of chunksSnap.docs) {
      await c.ref.delete();
    }

    // Update metadata
    await doc.ref.update({
      status: "deleted",
      deletedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Decrement user quota
    if (data.ownerId && data.sizeBytes) {
      const userRef = db.collection("blobUsers").doc(data.ownerId);
      await userRef.update({
        totalBytesUsed: admin.firestore.FieldValue.increment(-Math.abs(data.sizeBytes))
      });
    }

    console.log("Deleted blob", doc.id);
  }
  console.log("Cleanup done");
}

cleanup().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
