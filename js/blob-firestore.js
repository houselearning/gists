// /js/blob-firestore.js
// Full Blob implementation with:
// - Chunked uploads to Firestore (data: URIs in chunks)
// - 15MB per-file limit, 45MB per-user quota
// - My uploads, Trending, Feed
// - View profile, Follow/Unfollow, Like, Fork, Share (Mail/Copy/Forum)
// - Soft delete after inactivity (status=deleted) with Recover & Download

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
  deleteDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================
   CONFIG: replace with your Firebase config
   ============================ */
const firebaseConfig = {
  apiKey: "AIzaSyDoXSwni65CuY1_32ZE8B1nwfQO_3VNpTw",
  authDomain: "contract-center-llc-10.firebaseapp.com",
  projectId: "contract-center-llc-10",
};
/* ============================ */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const MAX_FILE_BYTES = 15 * 1024 * 1024;   // 15MB per file
const MAX_USER_BYTES = 45 * 1024 * 1024;   // 45MB per user
const CHUNK_SIZE = 256 * 1024;             // 256KB per chunk

// Core UI elements (must exist in blob.html)
const signedInAsEl   = document.getElementById("signedInAs");
const signInBtn      = document.getElementById("signInBtn");
const signOutBtn     = document.getElementById("signOutBtn");
const uploadForm     = document.getElementById("uploadForm");
const blobTitleEl    = document.getElementById("blobTitle");
const blobVisibilityEl = document.getElementById("blobVisibility");
const blobFileEl     = document.getElementById("blobFile");
const quotaInfoEl    = document.getElementById("quotaInfo");
const fileSizeInfoEl = document.getElementById("fileSizeInfo");
const uploadStatusEl = document.getElementById("uploadStatus");
const myUploadsList  = document.getElementById("myUploadsList");
const trendingList   = document.getElementById("trendingList");
const feedList       = document.getElementById("feedList");

// Share modal elements (must exist in blob.html)
const shareModal     = document.getElementById("shareModal");
const shareMail      = document.getElementById("shareMail");
const shareCopy      = document.getElementById("shareCopy");
const shareForum     = document.getElementById("shareForum");
const shareClose     = document.getElementById("shareClose");

let currentUser = null;
let currentUserUsage = 0;
let shareCurrentBlobId = null;
let shareCurrentFileName = null;

/* ============================
   AUTH
   ============================ */

signInBtn?.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});

signOutBtn?.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    if (signedInAsEl) signedInAsEl.textContent = "Guest";
    signInBtn?.classList.remove("hidden");
    signOutBtn?.classList.add("hidden");
    uploadForm?.classList.add("hidden");
    if (quotaInfoEl) quotaInfoEl.textContent = "Sign in to upload.";
    if (feedList) {
      feedList.innerHTML = "<p class='muted'>Sign in to see your personalized feed.</p>";
    }
    return;
  }

  if (signedInAsEl) {
    signedInAsEl.textContent = user.displayName || user.email || "User";
  }
  signInBtn?.classList.add("hidden");
  signOutBtn?.classList.remove("hidden");
  uploadForm?.classList.remove("hidden");

  await ensureUserDoc(user.uid);
  subscribeMyUploads(user.uid);
  subscribeTrending();
  subscribeFeed();
});

/* ============================
   UPLOAD FORM
   ============================ */

blobFileEl?.addEventListener("change", () => {
  const file = blobFileEl.files[0];
  if (!file) {
    if (fileSizeInfoEl) fileSizeInfoEl.textContent = "";
    return;
  }
  const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
  if (fileSizeInfoEl) {
    fileSizeInfoEl.textContent = `Selected: ${sizeMB} MB`;
    if (file.size > MAX_FILE_BYTES) {
      fileSizeInfoEl.textContent += " (too large, max 15MB)";
    }
  }
});

uploadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (uploadStatusEl) uploadStatusEl.textContent = "";

  if (!currentUser) {
    if (uploadStatusEl) uploadStatusEl.textContent = "You must be signed in.";
    return;
  }

  const file = blobFileEl.files[0];
  if (!file) {
    if (uploadStatusEl) uploadStatusEl.textContent = "Choose a file.";
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    if (uploadStatusEl) uploadStatusEl.textContent = "File exceeds 15MB limit.";
    return;
  }
  if (currentUserUsage + file.size > MAX_USER_BYTES) {
    if (uploadStatusEl) uploadStatusEl.textContent = "You have reached your 45MB account limit.";
    return;
  }

  const title = (blobTitleEl?.value || "").trim() || file.name;
  const visibility = blobVisibilityEl?.value || "private";

  try {
    if (uploadStatusEl) uploadStatusEl.textContent = "Reading file...";
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const totalBytes = uint8.length;
    const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE);

    const blobMetaRef = doc(collection(db, "blobs"));
    const now = new Date();

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

    if (uploadStatusEl) uploadStatusEl.textContent = `Uploading ${chunkCount} chunks...`;

    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const slice = uint8.subarray(start, end);
      const base64 = arrayBufferToBase64(slice.buffer);
      const chunkRef = doc(db, `blobs/${blobMetaRef.id}/chunks/${i}`);
      await setDoc(chunkRef, {
        index: i,
        dataBase64: base64
      });
      if (uploadStatusEl) uploadStatusEl.textContent = `Uploaded chunk ${i + 1}/${chunkCount}`;
    }

    await updateDoc(blobMetaRef, { status: "active" });
    await updateUserUsage(currentUser.uid, totalBytes);

    if (uploadStatusEl) uploadStatusEl.textContent = "Upload complete!";
    uploadForm.reset();
    if (fileSizeInfoEl) fileSizeInfoEl.textContent = "";
  } catch (err) {
    console.error(err);
    if (uploadStatusEl) uploadStatusEl.textContent = "Upload failed.";
  }
});

/* ============================
   UTILS: base64 <-> Uint8Array
   ============================ */

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ============================
   USER QUOTA
   ============================ */

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
  if (!quotaInfoEl) return;
  const usedMB = (currentUserUsage / (1024 * 1024)).toFixed(2);
  const maxMB = (MAX_USER_BYTES / (1024 * 1024)).toFixed(0);
  quotaInfoEl.textContent = `You are using ${usedMB}MB of ${maxMB}MB.`;
}

/* ============================
   SUBSCRIPTIONS: My uploads, Trending, Feed
   ============================ */

function subscribeMyUploads(uid) {
  if (!myUploadsList) return;
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
        <button data-owner="${b.ownerId}" data-action="profile" class="action-btn">View profile</button>
        <button data-id="${docSnap.id}" class="fork-btn">Fork</button>
        <button data-id="${docSnap.id}" class="like-btn">Like (${b.likes || 0})</button>
        <button data-id="${docSnap.id}" class="share-btn">Share</button>
      `;
      myUploadsList.appendChild(li);

      li.querySelector(".download-btn")?.addEventListener("click", async () => {
        await downloadBlob(docSnap.id, b);
      });
      li.querySelector(".delete-btn")?.addEventListener("click", async () => {
        if (!confirm("Delete this blob and its chunks? This cannot be undone.")) return;
        await deleteBlobAndChunks(docSnap.id, b);
      });
      li.querySelector(".action-btn")?.addEventListener("click", (ev) => {
        const owner = ev.target.dataset.owner;
        viewProfile(owner);
      });
      li.querySelector(".fork-btn")?.addEventListener("click", async () => {
        await forkBlob(docSnap.id, b);
      });
      li.querySelector(".like-btn")?.addEventListener("click", async () => {
        await toggleLike(docSnap.id);
      });
      li.querySelector(".share-btn")?.addEventListener("click", async () => {
        await shareBlob(docSnap.id, b.fileName);
      });
    });
  });
}

function subscribeTrending() {
  if (!trendingList) return;
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
        <button data-owner="${b.ownerId}" class="view-profile-small">Profile</button>
        <button data-id="${docSnap.id}" class="fork-small">Fork</button>
        <button data-id="${docSnap.id}" class="share-small">Share</button>
      `;
      trendingList.appendChild(li);

      li.querySelector(".view-profile-small")?.addEventListener("click", (ev) => {
        viewProfile(ev.target.dataset.owner);
      });
      li.querySelector(".fork-small")?.addEventListener("click", async () => {
        await forkBlob(docSnap.id, b);
      });
      li.querySelector(".share-small")?.addEventListener("click", async () => {
        await shareBlob(docSnap.id, b.fileName);
      });
    });
  });
}

function subscribeFeed() {
  if (!feedList) return;
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
            <button data-action="follow" data-owner="${b.ownerId}">Follow</button>
            <button data-action="fork" data-id="${id}">Fork</button>
            <button data-action="like" data-id="${id}">Like (${b.likes || 0})</button>
            <button data-action="share" data-id="${id}">Share</button>
          </div>
          <div class="feed-snippet">${snippet}</div>
        </div>
      `;
      feedList.appendChild(item);

      item.querySelectorAll(".feed-actions button").forEach(btn => {
        btn.addEventListener("click", async (ev) => {
          const action = ev.target.dataset.action;
          if (action === "profile") {
            viewProfile(ev.target.dataset.owner);
          } else if (action === "follow") {
            const newState = await toggleFollow(ev.target.dataset.owner);
            if (newState === true) ev.target.textContent = "Unfollow";
            else if (newState === false) ev.target.textContent = "Follow";
          } else if (action === "fork") {
            await forkBlob(ev.target.dataset.id, b);
          } else if (action === "like") {
            await toggleLike(ev.target.dataset.id);
          } else if (action === "share") {
            await shareBlob(ev.target.dataset.id, b.fileName);
          }
        });
      });

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

/* ============================
   VIEW PROFILE
   ============================ */

function viewProfile(ownerId) {
  if (!ownerId) return;
  window.location.href = `/profile.html?uid=${encodeURIComponent(ownerId)}`;
}

/* ============================
   LIKE
   ============================ */

async function toggleLike(blobId) {
  if (!currentUser) {
    alert("Sign in to like.");
    return;
  }
  const likeRef = doc(db, `blobs/${blobId}/likes/${currentUser.uid}`);
  const blobRef = doc(db, "blobs", blobId);

  try {
    await runTransaction(db, async (tx) => {
      const likeSnap = await tx.get(likeRef);
      const blobSnap = await tx.get(blobRef);
      if (!blobSnap.exists()) throw new Error("Blob not found.");
      const currentLikes = blobSnap.data().likes || 0;

      if (likeSnap.exists()) {
        tx.delete(likeRef);
        tx.update(blobRef, { likes: Math.max(0, currentLikes - 1) });
      } else {
        tx.set(likeRef, { uid: currentUser.uid, ts: serverTimestamp() });
        tx.update(blobRef, { likes: currentLikes + 1 });
      }
    });
  } catch (err) {
    console.error("Like transaction failed", err);
    alert("Could not update like. Try again.");
  }
}

/* ============================
   FOLLOW / UNFOLLOW
   ============================ */

async function toggleFollow(targetUid) {
  if (!currentUser) {
    alert("Sign in to follow users.");
    return false;
  }
  if (currentUser.uid === targetUid) {
    alert("You cannot follow yourself.");
    return false;
  }

  const followerRef = doc(db, "user_profiles", targetUid, "followers", currentUser.uid);
  const followingRef = doc(db, "user_profiles", currentUser.uid, "following", targetUid);
  const profileRef = doc(db, "user_profiles", targetUid);

  try {
    const result = await runTransaction(db, async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const followerSnap = await tx.get(followerRef);

      const currentFollowers = profileSnap.exists()
        ? (profileSnap.data().followersCount || 0)
        : 0;

      if (followerSnap.exists()) {
        tx.delete(followerRef);
        tx.delete(followingRef);
        tx.update(profileRef, {
          followersCount: Math.max(0, currentFollowers - 1)
        });
        return false;
      } else {
        tx.set(followerRef, {
          uid: currentUser.uid,
          ts: serverTimestamp()
        });
        tx.set(followingRef, {
          uid: targetUid,
          ts: serverTimestamp()
        });
        tx.update(profileRef, {
          followersCount: currentFollowers + 1
        });
        return true;
      }
    });

    return result;
  } catch (err) {
    console.error("Follow transaction failed:", err);
    alert("Could not update follow status.");
    return null;
  }
}

/* ============================
   FORK
   ============================ */

async function forkBlob(sourceBlobId, sourceMeta) {
  if (!currentUser) {
    alert("Sign in to fork.");
    return;
  }

  let meta = sourceMeta;
  if (!meta) {
    const snap = await getDoc(doc(db, "blobs", sourceBlobId));
    if (!snap.exists()) {
      alert("Source blob not found.");
      return;
    }
    meta = snap.data();
  }

  if (meta.visibility !== "public" && meta.ownerId !== currentUser.uid) {
    alert("Cannot fork a private blob you don't own.");
    return;
  }

  if (currentUserUsage + (meta.sizeBytes || 0) > MAX_USER_BYTES) {
    alert("Not enough quota to fork this blob.");
    return;
  }

  try {
    const newBlobRef = doc(collection(db, "blobs"));
    const now = new Date();

    await runTransaction(db, async (tx) => {
      const userRef = doc(db, "blobUsers", currentUser.uid);
      const userSnap = await tx.get(userRef);
      const currentTotal = userSnap.exists() ? (userSnap.data().totalBytesUsed || 0) : 0;
      const newTotal = currentTotal + (meta.sizeBytes || 0);
      if (newTotal > MAX_USER_BYTES) throw new Error("Quota exceeded during transaction.");

      tx.set(newBlobRef, {
        ownerId: currentUser.uid,
        ownerName: currentUser.displayName || null,
        title: (meta.title || meta.fileName || "Untitled") + " (fork)",
        fileName: meta.fileName,
        sizeBytes: meta.sizeBytes,
        mimeType: meta.mimeType || "application/octet-stream",
        visibility: "private",
        chunkCount: meta.chunkCount || 0,
        createdAt: now,
        lastAccessedAt: now,
        status: "uploading",
        likes: 0,
        views: 0,
        forkedFrom: sourceBlobId
      });

      tx.update(userRef, { totalBytesUsed: newTotal });
    });

    const sourceChunksSnap = await getDocs(collection(db, `blobs/${sourceBlobId}/chunks`));
    const chunks = [];
    sourceChunksSnap.forEach(c => chunks.push({ id: c.id, data: c.data() }));
    chunks.sort((a, b) => a.data.index - b.data.index);

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const destRef = doc(db, `blobs/${newBlobRef.id}/chunks/${i}`);
      await setDoc(destRef, {
        index: i,
        dataBase64: c.data.dataBase64
      });
    }

    await updateDoc(newBlobRef, { status: "active" });

    alert("Fork complete. You can find it in your uploads.");
  } catch (err) {
    console.error("Fork failed", err);
    alert("Fork failed: " + (err.message || "unknown error"));
  }
}

/* ============================
   SHARE (MODAL: Mail / Copy / Forum)
   ============================ */

async function shareBlob(blobId, fileName) {
  shareCurrentBlobId = blobId;
  shareCurrentFileName = fileName;
  if (shareModal) shareModal.classList.remove("hidden");
}

shareClose?.addEventListener("click", () => {
  if (shareModal) shareModal.classList.add("hidden");
});

shareMail?.addEventListener("click", () => {
  if (!shareCurrentBlobId) return;
  const link = `${window.location.origin}/blob.html?blobId=${shareCurrentBlobId}`;
  const subject = encodeURIComponent("Check out this file!");
  const body = encodeURIComponent(
    `Hey there! I want to share a file with you!\n\n${shareCurrentFileName || ""}\n${link}`
  );
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
});

shareCopy?.addEventListener("click", async () => {
  if (!shareCurrentBlobId) return;
  const link = `${window.location.origin}/blob.html?blobId=${shareCurrentBlobId}`;
  try {
    await navigator.clipboard.writeText(link);
    alert("Link copied to clipboard!");
  } catch {
    prompt("Copy this link:", link);
  }
});

shareForum?.addEventListener("click", () => {
  if (!shareCurrentBlobId) return;
  const link = `${window.location.origin}/blob.html?blobId=${shareCurrentBlobId}`;
  window.location.href = `/docs/forum.html?newpost=${encodeURIComponent(link)}`;
});

/* ============================
   DOWNLOAD / RECOVER
   ============================ */

async function downloadBlob(blobId, meta) {
  if (meta.status === "deleted") {
    alert("This blob is deleted. Use Recover to download if available.");
    return;
  }
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  const chunks = [];
  chunksSnap.forEach(c => chunks.push({ index: c.data().index, dataBase64: c.data().dataBase64 }));
  chunks.sort((a, b) => a.index - b.index);
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
  a.download = meta.fileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const metaRef = doc(db, "blobs", blobId);
  await updateDoc(metaRef, {
    lastAccessedAt: new Date(),
    views: (meta.views || 0) + 1
  });
}

async function recoverAndDownload(blobId) {
  const metaSnap = await getDoc(doc(db, "blobs", blobId));
  if (!metaSnap.exists()) {
    alert("Blob not found.");
    return;
  }
  const meta = metaSnap.data();
  if (meta.status !== "deleted") {
    alert("Blob is not deleted.");
    return;
  }
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  if (chunksSnap.empty) {
    alert("No recovery data available. The file was permanently removed.");
    return;
  }
  const chunks = [];
  chunksSnap.forEach(c => chunks.push({ index: c.data().index, dataBase64: c.data().dataBase64 }));
  chunks.sort((a, b) => a.index - b.index);
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

/* ============================
   DELETE BLOB + CHUNKS
   ============================ */

async function deleteBlobAndChunks(blobId, meta) {
  const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
  for (const c of chunksSnap.docs) {
    await deleteDoc(c.ref);
  }
  await deleteDoc(doc(db, "blobs", blobId));
  if (meta.ownerId && meta.sizeBytes) {
    await updateUserUsage(meta.ownerId, -Math.abs(meta.sizeBytes));
  }
}

/* ============================
   ARCHIVE INACTIVE BLOBS (client-side helper)
   ============================ */

async function archiveInactiveBlobsForUser() {
  if (!currentUser) {
    alert("Sign in first.");
    return;
  }
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const q = query(
    collection(db, "blobs"),
    where("ownerId", "==", currentUser.uid),
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    if (!b.lastAccessedAt) continue;
    const last = b.lastAccessedAt.toDate ? b.lastAccessedAt.toDate() : new Date(b.lastAccessedAt);
    if (last > cutoff) continue;
    await updateDoc(doc(db, "blobs", docSnap.id), {
      status: "deleted",
      deletedAt: serverTimestamp()
    });
  }
  alert("Archive pass complete. Marked inactive blobs as deleted (chunks still present).");
}

// Expose some helpers globally if you want to call them from HTML
window.archiveInactiveBlobsForUser = archiveInactiveBlobsForUser;
window.downloadBlob = downloadBlob;
window.forkBlob = forkBlob;
window.toggleLike = toggleLike;
window.toggleFollow = toggleFollow;
window.shareBlob = shareBlob;
