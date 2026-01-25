// /js/blob-firestore.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* CONFIG: replace with your Firebase config */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
};
/* END CONFIG */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_USER_BYTES = 45 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024; // 256 KB per chunk (base64 expands slightly)

const signedInAsEl = document.getElementById("signedInAs");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const uploadForm = document.getElementById("uploadForm");
const blobTitleEl = document.getElementById("blobTitle");
const blobVisibilityEl = document.getElementById("blobVisibility");
const blobFileEl = document.getElementById("blobFile");
const quotaInfoEl = document.getElementById("quotaInfo");
const fileSizeInfoEl = document.getElementById("fileSizeInfo");
const uploadStatusEl = document.getElementById("uploadStatus");
const myUploadsList = document.getElementById("myUploadsList");
const trendingList = document.getElementById("trendingList");
const feedList = document.getElementById("feedList");

let currentUser = null;
let currentUserUsage = 0;

signInBtn.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});

signOutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    signedInAsEl.textContent = "Guest";
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    uploadForm.classList.add("hidden");
    quotaInfoEl.textContent = "Sign in to upload.";
    feedList.innerHTML = "<p class='muted'>Sign in to see your personalized feed.</p>";
    return;
  }

  signedInAsEl.textContent = user.displayName || user.email || "User";
  signInBtn.classList.add("hidden");
  signOutBtn.classList.remove("hidden");
  uploadForm.classList.remove("hidden");

  await ensureUserDoc(user.uid);
  subscribeMyUploads(user.uid);
  subscribeTrending();
  subscribeFeed();
});

blobFileEl.addEventListener("change", () => {
  const file = blobFileEl.files[0];
  if (!file) {
    fileSizeInfoEl.textContent = "";
    return;
  }
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
  fileSizeInfoEl.textContent = `Selected: ${sizeMB} MB`;
  if (file.size > MAX_FILE_BYTES) {
    fileSizeInfoEl.textContent += " (too large, max 15MB)";
  }
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadStatusEl.textContent = "";

  if (!currentUser) {
    uploadStatusEl.textContent = "You must be signed in.";
    return;
  }

  const file = blobFileEl.files[0];
  if (!file) {
    uploadStatusEl.textContent = "Choose a file.";
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    uploadStatusEl.textContent = "File exceeds 15MB limit.";
    return;
  }
  if (currentUserUsage + file.size > MAX_USER_BYTES) {
    uploadStatusEl.textContent = "You have reached your 45MB account limit.";
    return;
  }

  const title = blobTitleEl.value.trim() || file.name;
  const visibility = blobVisibilityEl.value;

  try {
    uploadStatusEl.textContent = "Reading file...";
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Convert to base64 in chunks to avoid huge strings in memory at once
    const totalBytes = uint8.length;
    const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE);

    // Create metadata doc first (so rules can check quota)
    const blobMetaRef = doc(collection(db, "blobs"));
    const now = new Date();

    // Prepare metadata doc (without chunks yet)
    await setDoc(blobMetaRef, {
      ownerId: currentUser.uid,
      ownerName: currentUser.displayName || null,
      title,
      fileName: file.name,
      sizeBytes: totalBytes,
      mimeType: file.type || "application/octet-stream",
      visibility,
      chunkCount,
      createdAt: now,
      lastAccessedAt: now,
      status: "uploading",
      likes: 0,
      views: 0
    });

    uploadStatusEl.textContent = `Uploading ${chunkCount} chunks...`;

    // Write chunks sequentially (could be parallel but sequential is safer for quota)
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const slice = uint8.subarray(start, end);
      // convert slice to base64
      const base64 = arrayBufferToBase64(slice.buffer);
      const chunkRef = doc(db, `blobs/${blobMetaRef.id}/chunks/${i}`);
      await setDoc(chunkRef, {
        index: i,
        dataBase64: base64
      });
      uploadStatusEl.textContent = `Uploaded chunk ${i + 1}/${chunkCount}`;
    }

    // Update metadata to active
    await updateDoc(blobMetaRef, { status: "active" });

    // Update user quota
    await updateUserUsage(currentUser.uid, totalBytes);

    uploadStatusEl.textContent = "Upload complete!";
    uploadForm.reset();
    fileSizeInfoEl.textContent = "";
  } catch (err) {
    console.error(err);
    uploadStatusEl.textContent = "Upload failed.";
  }
});

// Helper: convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Helper: base64 to Uint8Array
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* -------------------------
   User doc & quota
   ------------------------- */
async function ensureUserDoc(uid) {
  const userRef = doc(db, "blobUsers", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      totalBytesUsed: 0,
      createdAt: new Date()
    });
    currentUserUsage = 0;
  } else {
    currentUserUsage = snap.data().totalBytesUsed || 0;
  }
  updateQuotaInfo();
}

async function updateUserUsage(uid, deltaBytes) {
  const userRef = doc(db, "blobUsers", uid);
  const snap = await getDoc(userRef);
  const current = (snap.data()?.totalBytesUsed || 0) + deltaBytes;
  await updateDoc(userRef, { totalBytesUsed: current });
  currentUserUsage = current;
  updateQuotaInfo();
}

function updateQuotaInfo() {
  const usedMB = (currentUserUsage / (1024 * 1024)).toFixed(2);
  const maxMB = (MAX_USER_BYTES / (1024 * 1024)).toFixed(0);
  quotaInfoEl.textContent = `You are using ${usedMB}MB of ${maxMB}MB.`;
}

/* -------------------------
   Feed & subscriptions
   ------------------------- */
function subscribeMyUploads(uid) {
  const q = query(
    collection(db, "blobs"),
    where("ownerId", "==", uid),
    orderBy("createdAt", "desc"),
    limit(10)
  );
  onSnapshot(q, (snap) => {
    myUploadsList.innerHTML = "";
    snap.forEach((docSnap) => {
      const b = docSnap.data();
      const li = document.createElement("li");
      const visLabel = b.status === "deleted"
        ? "deleted"
        : (b.visibility === "public" ? "publ" : "priv");
      li.innerHTML = `
        <span class="file-name">${b.fileName}</span>
        <span class="file-meta">${visLabel}</span>
        <button data-id="${docSnap.id}" class="download-btn">Download</button>
        <button data-id="${docSnap.id}" class="delete-btn">Delete</button>
      `;
      myUploadsList.appendChild(li);

      li.querySelector(".download-btn").addEventListener("click", async () => {
        await downloadBlob(docSnap.id, b);
      });
      li.querySelector(".delete-btn").addEventListener("click", async () => {
        if (!confirm("Delete this blob and its chunks? This cannot be undone.")) return;
        await deleteBlobAndChunks(docSnap.id, b);
      });
    });
  });
}

function subscribeTrending() {
  const q = query(
    collection(db, "blobs"),
    where("visibility", "==", "public"),
    orderBy("views", "desc"),
    limit(5)
  );
  onSnapshot(q, (snap) => {
    trendingList.innerHTML = "";
    snap.forEach((docSnap) => {
      const b = docSnap.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="file-name">${b.fileName}</span>
        <span class="file-meta">${b.views || 0} Views</span>
      `;
      trendingList.appendChild(li);
    });
  });
}

function subscribeFeed() {
  const q = query(
    collection(db, "blobs"),
    where("visibility", "==", "public"),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  onSnapshot(q, (snap) => {
    feedList.innerHTML = "";
    snap.forEach((docSnap) => {
      const id = docSnap.id;
      const b = docSnap.data();
      const item = document.createElement("div");
      item.className = "feed-item";

      const snippet = b.status === "deleted"
        ? `<strong>This Project has been deleted due to inactivity,</strong>
           <a href="#" data-id="${id}" class="recover-link">Recover &amp; Download</a>`
        : (b.previewText || "Preview not available.");

      item.innerHTML = `
        <div class="feed-header">
          <div class="feed-avatar" style="background-image:url('https://robohash.org/${b.ownerId}.png?size=80x80&set=set3');background-size:cover;"></div>
          <div>
            <div class="feed-user">${b.ownerName || "Anonymous"}</div>
            <div class="feed-meta">Uploaded - ${b.fileName}</div>
          </div>
        </div>
        <div class="feed-preview">
          <div class="feed-actions">
            <button data-action="profile" data-owner="${b.ownerId}">view profile</button>
            <button data-action="fork" data-id="${id}">Fork</button>
            <button data-action="like" data-id="${id}">Like</button>
            <button data-action="share" data-id="${id}">Share</button>
          </div>
          <div class="feed-snippet">${snippet}</div>
        </div>
      `;
      feedList.appendChild(item);

      const recoverLink = item.querySelector(".recover-link");
      if (recoverLink) {
        recoverLink.addEventListener("click", async (ev) => {
          ev.preventDefault();
          await recoverAndDownload(id);
        });
      }
    });
  });
}

/* -------------------------
   Download / reassemble
   ------------------------- */
async function downloadBlob(blobId, meta) {
  if (meta.status === "deleted") {
    alert("This blob is deleted. Use Recover to download if available.");
    return;
  }
  // fetch chunks
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  const chunks = [];
  chunksSnap.forEach(c => chunks.push({ index: c.data().index, dataBase64: c.data().dataBase64 }));
  chunks.sort((a,b) => a.index - b.index);
  // assemble
  const byteArrays = chunks.map(c => base64ToUint8Array(c.dataBase64));
  const totalLen = byteArrays.reduce((s, arr) => s + arr.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of byteArrays) {
    combined.set(arr, offset);
    offset += arr.length;
  }
  // create blob and download
  const blob = new Blob([combined], { type: meta.mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.fileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  // update lastAccessedAt and views
  const metaRef = doc(db, "blobs", blobId);
  await updateDoc(metaRef, { lastAccessedAt: new Date(), views: (meta.views || 0) + 1 });
}

async function recoverAndDownload(blobId) {
  // For deleted blobs, if chunks still exist (e.g., you archived instead of deleting), reassemble
  const metaSnap = await getDoc(doc(db, "blobs", blobId));
  if (!metaSnap.exists()) return alert("Blob not found.");
  const meta = metaSnap.data();
  if (meta.status !== "deleted") return alert("Blob is not deleted.");
  // Try to fetch chunks (if you archived them to deletedChunks or left them, adjust path)
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  if (chunksSnap.empty) {
    return alert("No recovery data available. The file was permanently removed.");
  }
  // assemble and download
  const chunks = [];
  chunksSnap.forEach(c => chunks.push({ index: c.data().index, dataBase64: c.data().dataBase64 }));
  chunks.sort((a,b) => a.index - b.index);
  const byteArrays = chunks.map(c => base64ToUint8Array(c.dataBase64));
  const totalLen = byteArrays.reduce((s, arr) => s + arr.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of byteArrays) {
    combined.set(arr, offset);
    offset += arr.length;
  }
  const blob = new Blob([combined], { type: meta.mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.fileName || "recovered";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------
   Delete blob and chunks (owner)
   ------------------------- */
async function deleteBlobAndChunks(blobId, meta) {
  // Delete chunk docs
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  for (const c of chunksSnap.docs) {
    await deleteDoc(c.ref);
  }
  // Delete metadata doc
  await deleteDoc(doc(db, "blobs", blobId));
  // Decrement user quota
  if (meta.ownerId && meta.sizeBytes) {
    await updateUserUsage(meta.ownerId, -Math.abs(meta.sizeBytes));
  }
}

/* -------------------------
   Client-side archive/cleanup (user-run)
   ------------------------- */
async function archiveInactiveBlobsForUser() {
  if (!currentUser) return alert("Sign in first.");
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const q = query(collection(db, "blobs"), where("ownerId", "==", currentUser.uid), where("status", "==", "active"));
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    if (!b.lastAccessedAt) continue;
    const last = b.lastAccessedAt.toDate ? b.lastAccessedAt.toDate() : new Date(b.lastAccessedAt);
    if (last > cutoff) continue;
    // Mark as deleted but keep chunks for recovery (or delete them to free space)
    await updateDoc(doc(db, "blobs", docSnap.id), {
      status: "deleted",
      deletedAt: serverTimestamp()
    });
    // Optionally: move chunks to deletedChunks collection (not implemented here)
    // Optionally: keep chunks for a grace period, then delete them permanently
  }
  alert("Archive pass complete. Marked inactive blobs as deleted (chunks still present).");
}

/* -------------------------
   Expose archive function to console for manual runs
   ------------------------- */
window.archiveInactiveBlobsForUser = archiveInactiveBlobsForUser;

/* -------------------------
   Utility: getDocs import
   ------------------------- */
import { getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
