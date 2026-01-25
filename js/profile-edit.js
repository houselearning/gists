// /js/profile-edit.js
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
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* CONFIG: replace with your Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyDoXSwni65CuY1_32ZE8B1nwfQO_3VNpTw",
  authDomain: "contract-center-llc-10.firebaseapp.com",
  projectId: "contract-center-llc-10",
  storageBucket: "contract-center-llc-10.firebasestorage.app",
  messagingSenderId: "323221512767",
  appId: "1:323221512767:web:6421260f875997dbf64e8a",
  measurementId: "G-S2RJ0C6BWH"
};
/* END CONFIG */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM
const signedInAsEl = document.getElementById("signedInAs");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const avatarPreview = document.getElementById("avatarPreview");
const avatarUrlInput = document.getElementById("avatarUrl");
const displayNameInput = document.getElementById("displayName");
const bioInput = document.getElementById("bio");
const locationInput = document.getElementById("location");
const publicEmailInput = document.getElementById("publicEmail");
const profileForm = document.getElementById("profileForm");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");
const saveStatus = document.getElementById("saveStatus");
const deleteProfileBtn = document.getElementById("deleteProfileBtn");

let currentUser = null;
let userProfileRef = null;

// Auth handlers
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
    disableForm(true);
    return;
  }
  signedInAsEl.textContent = user.displayName || user.email || "User";
  signInBtn.classList.add("hidden");
  signOutBtn.classList.remove("hidden");
  userProfileRef = doc(db, "user_profiles", user.uid);
  await loadProfile(user.uid);
  disableForm(false);
});

// Load profile data into form
async function loadProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "user_profiles", uid));
    const data = snap.exists() ? snap.data() : {};
    displayNameInput.value = data.displayName || auth.currentUser?.displayName || "";
    bioInput.value = data.bio || "";
    locationInput.value = data.location || "";
    publicEmailInput.value = data.publicEmail || "";
    avatarUrlInput.value = data.avatarUrl || "";
    updateAvatarPreview();
  } catch (err) {
    console.error("Failed to load profile", err);
  }
}

function updateAvatarPreview() {
  const url = avatarUrlInput.value?.trim();
  if (url) {
    avatarPreview.style.backgroundImage = `url('${url}')`;
  } else {
    // fallback to robohash based on uid or anonymous
    const uid = currentUser?.uid || "anon";
    avatarPreview.style.backgroundImage = `url('https://robohash.org/${uid}.png?size=160x160&set=set3')`;
  }
}

avatarUrlInput.addEventListener("input", updateAvatarPreview);

// Save profile
profileForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!currentUser) return alert("Sign in to edit your profile.");
  saveStatus.textContent = "";
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const payload = {
    displayName: displayNameInput.value.trim() || null,
    bio: bioInput.value.trim() || null,
    location: locationInput.value.trim() || null,
    publicEmail: publicEmailInput.value.trim() || null,
    avatarUrl: avatarUrlInput.value.trim() || null,
    updatedAt: serverTimestamp()
  };

  // Remove empty strings to avoid storing null vs empty
  Object.keys(payload).forEach(k => {
    if (payload[k] === null || payload[k] === "") payload[k] = null;
  });

  try {
    // Use setDoc with merge to create or update
    await setDoc(userProfileRef, payload, { merge: true });
    saveStatus.textContent = "Saved.";
  } catch (err) {
    console.error("Save failed", err);
    saveStatus.textContent = "Save failed.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save profile";
  }
});

// Cancel button: reload last saved
cancelBtn.addEventListener("click", async () => {
  if (!currentUser) return;
  await loadProfile(currentUser.uid);
  saveStatus.textContent = "Changes reverted.";
  setTimeout(() => saveStatus.textContent = "", 2000);
});

// Delete profile (owner only)
deleteProfileBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Sign in to delete your profile.");
  if (!confirm("Delete your public profile? This removes profile fields but will not delete your blobs.")) return;
  try {
    // Clear public fields by setting them to deleteField()
    await updateDoc(userProfileRef, {
      displayName: deleteField(),
      bio: deleteField(),
      location: deleteField(),
      avatarUrl: deleteField(),
      publicEmail: deleteField(),
      followersCount: deleteField(),
      rating: deleteField(),
      updatedAt: serverTimestamp()
    });
    await loadProfile(currentUser.uid);
    alert("Profile cleared.");
  } catch (err) {
    console.error("Delete profile failed", err);
    alert("Could not delete profile.");
  }
});

function disableForm(disabled) {
  [avatarUrlInput, displayNameInput, bioInput, locationInput, publicEmailInput, saveBtn, cancelBtn, deleteProfileBtn].forEach(el => {
    el.disabled = disabled;
  });
  if (disabled) {
    avatarPreview.style.backgroundImage = `url('https://robohash.org/anon.png?size=160x160&set=set3')`;
  }
}

// initial state
disableForm(true);
