// /js/profile.js
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
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDocs,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* CONFIG */
const firebaseConfig = {
  apiKey: "AIzaSyDoXSwni65CuY1_32ZE8B1nwfQO_3VNpTw",
  authDomain: "contract-center-llc-10.firebaseapp.com",
  projectId: "contract-center-llc-10",
};
/* END CONFIG */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM
const signedInAsEl = document.getElementById("signedInAs");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const aboutText = document.getElementById("aboutText");
const followersCountEl = document.getElementById("followersCount");
const ratingStarsEl = document.getElementById("ratingStars");
const followBtn = document.getElementById("followBtn");
const reportBtn = document.getElementById("reportBtn");
const recentUploadsEl = document.getElementById("recentUploads");
const uploadsListEl = document.getElementById("uploadsList");
const shareProfileBtn = document.getElementById("shareProfileBtn");

let currentUser = null;
let viewedUid = null;
let isFollowing = false;

// Helpers
function qsParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function avatarUrl(uid) {
  return `https://robohash.org/${uid}.png?size=160x160&set=set3`;
}

// Auth UI
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
    followBtn.disabled = true;
  } else {
    signedInAsEl.textContent = user.displayName || user.email || "User";
    signInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    followBtn.disabled = false;
  }
  if (viewedUid) await loadFollowState();
});

// Load profile on page open
(async function init() {
  viewedUid = qsParam("uid") || null;
  if (!viewedUid) {
    const user = auth.currentUser;
    if (user) viewedUid = user.uid;
    else {
      profileName.textContent = "Profile not specified";
      aboutText.textContent = "Open a profile with ?uid=USER_ID or sign in to view your profile.";
      followBtn.style.display = "none";
      return;
    }
  }
  await renderProfile(viewedUid);
  subscribeUploads(viewedUid);
  subscribeRecentUploads(viewedUid);
})();

// Render profile metadata
async function renderProfile(uid) {
  const profileDocRef = doc(db, "user_profiles", uid);
  const snap = await getDoc(profileDocRef);
  const data = snap.exists() ? snap.data() : null;

  profileAvatar.style.backgroundImage = `url('${avatarUrl(uid)}')`;
  profileName.textContent = data?.displayName || data?.name || (uid === (auth.currentUser?.uid) ? "You" : "User");
  aboutText.textContent = data?.bio || (data?.location ? `${data.location}` : "No bio yet.");
  followersCountEl.textContent = data?.followersCount || 0;
  ratingStarsEl.textContent = data?.rating || "0";

  if (auth.currentUser && auth.currentUser.uid === uid) {
    followBtn.textContent = "Edit Profile";
    followBtn.onclick = () => window.location.href = "/profile-edit.html";
  } else {
    followBtn.textContent = "Follow";
    followBtn.onclick = async () => {
      const newState = await toggleFollow(uid);
      followBtn.textContent = newState ? "Unfollow" : "Follow";
    };
  }

  reportBtn.onclick = () => {
    const reason = prompt("Report this profile. Briefly describe the issue:");
    if (!reason) return;
    addDoc(collection(db, "profileReports"), {
      reportedUid: uid,
      reporterUid: auth.currentUser?.uid || null,
      reason,
      ts: serverTimestamp()
    }).then(() => alert("Report submitted."));
  };

  shareProfileBtn.onclick = async () => {
    const url = `${window.location.origin}${window.location.pathname}?uid=${encodeURIComponent(uid)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Profile link copied to clipboard.");
    } catch {
      prompt("Copy this link:", url);
    }
  };

  await loadFollowState();
}

// Follow/unfollow logic
async function loadFollowState() {
  if (!currentUser || !viewedUid || currentUser.uid === viewedUid) {
    isFollowing = false;
    updateFollowUI();
    return;
  }
  const followerDocRef = doc(db, "user_profiles", viewedUid, "followers", currentUser.uid);
  const snap = await getDoc(followerDocRef);
  isFollowing = snap.exists();
  updateFollowUI();
}

function updateFollowUI() {
  if (!currentUser || currentUser.uid === viewedUid) {
    followBtn.disabled = false;
    followBtn.textContent = (currentUser && currentUser.uid === viewedUid) ? "Edit Profile" : "Follow";
    return;
  }
  followBtn.textContent = isFollowing ? "Unfollow" : "Follow";
}

async function toggleFollow(targetUid) {
  if (!currentUser) return alert("Sign in to follow users.");
  if (currentUser.uid === targetUid) return;

  const followerRef = doc(db, "user_profiles", targetUid, "followers", currentUser.uid);
  const followingRef = doc(db, "user_profiles", currentUser.uid, "following", targetUid);
  const profileRef = doc(db, "user_profiles", targetUid);

  try {
    const result = await runTransaction(db, async (tx) => {
      const profileSnap = await tx.get(profileRef);
      const currentFollowers = profileSnap.exists() ? (profileSnap.data().followersCount || 0) : 0;

      const followerSnap = await tx.get(followerRef);
      if (followerSnap.exists()) {
        tx.delete(followerRef);
        tx.delete(followingRef);
        tx.update(profileRef, { followersCount: Math.max(0, currentFollowers - 1) });
        isFollowing = false;
        return false;
      } else {
        tx.set(followerRef, { uid: currentUser.uid, ts: serverTimestamp() });
        tx.set(followingRef, { uid: targetUid, ts: serverTimestamp() });
        tx.update(profileRef, { followersCount: currentFollowers + 1 });
        isFollowing = true;
        return true;
      }
    });

    followersCountEl.textContent = (await getDoc(profileRef)).data().followersCount || 0;
    return result;

  } catch (err) {
    console.error("Follow transaction failed", err);
    alert("Could not update follow status. Try again.");
  }
}

/* -------------------------
   Uploads listing
   ------------------------- */

function subscribeRecentUploads(uid) {
  const q = query(collection(db, "blobs"), where("ownerId", "==", uid), orderBy("createdAt", "desc"), limit(5));
  onSnapshot(q, (snap) => {
    recentUploadsEl.innerHTML = "";
    snap.forEach(docSnap => {
      const b = docSnap.data();
      const li = document.createElement("li");
      li.innerHTML = `<span class="file-name">${b.fileName}</span><span class="file-meta">${b.visibility === "public" ? "publ" : "priv"}</span>`;
      recentUploadsEl.appendChild(li);
    });
  });
}

function subscribeUploads(uid) {
  const q = query(collection(db, "blobs"), where("ownerId", "==", uid), orderBy("createdAt", "desc"), limit(50));
  onSnapshot(q, (snap) => {
    uploadsListEl.innerHTML = "";
    snap.forEach(docSnap => {
      const id = docSnap.id;
      const b = docSnap.data();
      const item = document.createElement("div");
      item.className = "feed-item";
      item.innerHTML = `
        <div>
          <div style="font-weight:600">${b.title || b.fileName}</div>
          <div class="feed-meta">${b.fileName} • ${b.sizeBytes ? Math.round(b.sizeBytes/1024) + " KB" : ""}</div>
        </div>
        <div style="display:flex;gap:0.4rem;align-items:center">
          <button data-id="${id}" class="download-btn hl-btn">Download</button>
          <button data-id="${id}" class="fork-btn hl-btn">Fork</button>
          <button data-id="${id}" class="like-btn hl-btn">Like (${b.likes||0})</button>
          <button data-id="${id}" class="share-btn hl-btn">Share</button>
        </div>
      `;
      uploadsListEl.appendChild(item);

      item.querySelector(".download-btn").addEventListener("click", async () => {
        if (window.downloadBlob) await window.downloadBlob(id, b);
      });
      item.querySelector(".fork-btn").addEventListener("click", async () => {
        if (window.forkBlob) await window.forkBlob(id, b);
      });
      item.querySelector(".like-btn").addEventListener("click", async () => {
        if (window.toggleLike) await window.toggleLike(id);
      });
      item.querySelector(".share-btn").addEventListener("click", async () => {
        if (window.shareBlob) await window.shareBlob(id, b.fileName);
      });
    });
  });
}

/* -------------------------
   Download helper
   ------------------------- */

async function downloadBlob(blobId, meta) {
  if (window.downloadBlob) return window.downloadBlob(blobId, meta);

  try {
    const chunksSnap = await getDocs(collection(db, `blobs/${blobId}/chunks`));
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
    a.download = meta.fileName || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Download failed", err);
    alert("Could not download file.");
  }
}

// Expose download helper for external callers (e.g., from HTML or other scripts)
window.downloadBlob = downloadBlob;

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// holding this off temporarily
//import { getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
