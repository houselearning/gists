// /js/blob.js
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/*// TODO: use your existing config
const firebaseConfig = {
  // ...
};*/

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_USER_BYTES = 45 * 1024 * 1024;

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
  fileSizeInfoEl.textContent = `Selected: ${sizeMB}MB`;
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
    uploadStatusEl.textContent = "Uploading...";
    const blobId = crypto.randomUUID();
    const storagePath = `blob/${currentUser.uid}/${blobId}/${file.name}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);

    const downloadURL = await getDownloadURL(storageRef);
    const now = new Date();

    await addDoc(collection(db, "blobs"), {
      ownerId: currentUser.uid,
      ownerName: currentUser.displayName || null,
      ownerAvatar: `https://robohash.org/${currentUser.uid}.png?size=80x80&set=set3`,
      title,
      fileName: file.name,
      sizeBytes: file.size,
      visibility,
      storagePath,
      downloadURL,
      createdAt: now,
      lastAccessedAt: now,
      status: "active",
      likes: 0,
      views: 0
    });

    await updateUserUsage(currentUser.uid, file.size);

    uploadStatusEl.textContent = "Uploaded!";
    uploadForm.reset();
    fileSizeInfoEl.textContent = "";
  } catch (err) {
    console.error(err);
    uploadStatusEl.textContent = "Upload failed.";
  }
});

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
      `;
      myUploadsList.appendChild(li);
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

      const snippet = buildSnippet(b);

      item.innerHTML = `
        <div class="feed-header">
          <div class="feed-avatar" style="background-image:url('${b.ownerAvatar}');background-size:cover;"></div>
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
    });
  });
}

function buildSnippet(blob) {
  if (blob.status === "deleted" && blob.recoveryDataUri) {
    return `
      <strong>This Project has been deleted due to inactivity,</strong>
      <a href="${blob.recoveryDataUri}" download="${blob.fileName}">Recover &amp; Download</a>
    `;
  }
  // For text-like files, you can store a short preview in Firestore when uploading via Cloud Function.
  if (blob.previewText) {
    return blob.previewText;
  }
  return "Preview not available.";
}
