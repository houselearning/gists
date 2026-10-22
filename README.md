# HouseLearning Gists (Blobs)
### The free, serverless file‑sharing platform powering https://gists.houselearning.org

HouseLearning Gists — also known as **Blobs** — is a serverless file-hosting and sharing system built on Firebase Firestore. It is designed to fit provider free quotas; quota overages are not guaranteed to cost $0.  
It enables users to upload, store, share, fork, and manage files without any backend servers or paid hosting.

This project is designed for:
- Students  
- Developers  
- Educators  
- Anyone who needs a lightweight, GitHub‑Gist‑style file sharing tool  
- Projects that must run on **$0 infrastructure**

---

## 🚀 Features

### 🔹 File Uploads (Blobs)
- Supports HTML, CSS, JS, text, images, audio, video, and binary files  
- Max file size: **15MB**  (*soon to increase*)
- Per‑user quota: **45MB**  (*soon to increase*)
- Chunked upload system (256KB per chunk)  
- No Firebase Storage required  

### 🔹 Public & Private Visibility
- Public gists appear in Trending and Global Feed after moderation approval
- Private gists are visible only to the owner  

### 🔹 Public Upload Moderation
- New public uploads stay out of public feeds until a moderator approves them.
- Moderation is manual and uses no AI inference, paid API, or moderation Cloud Function invocation.
- Only designated SafeAI administrators can approve or block pending uploads; Firestore rules validate the decision and reviewer identity.
- Owners can see whether their public upload is awaiting a check, approved, blocked, or awaiting manual review. Private uploads are not submitted to moderation.

### 🔹 Forking
- Users can fork any public gist  
- Forks preserve file name, content, and metadata  
- Forks count toward user quota  

### 🔹 Sharing Modal
Includes:
- **Mail** (mailto link with file name + link)  
- **Copy Link**  
- **Forum Post** (opens HouseLearning Forum with prefilled content)  

### 🔹 Likes
- One‑click like toggle  
- Stored per‑user in `/blobs/{id}/likes/{uid}`  
- Like count stored on blob metadata  

### 🔹 Follow System
- Users can follow each other  
- Stored in:
  - `/user_profiles/{uid}/followers/{followerUid}`
  - `/user_profiles/{uid}/following/{targetUid}`  
- Follower count stored on profile  

### 🔹 Profile Pages
- Public profiles for every user  
- Shows avatar, bio, followers, recent uploads, and all uploads  
- Follow/Unfollow integrated  

### 🔹 Inactivity Cleanup
- Blobs older than **45 days without access** are marked `deleted`  
- Users can still **Recover & Download**  

### 🔹 Trending Algorithm
- Based on view count  
- Updated in real time  

## Moderation deployment

The Gists frontend is hosted by GitHub Pages. Firestore rules and indexes are configured in the HouseLearning home repository; deploy them with `firebase deploy --only firestore:rules,firestore:indexes` after verifying the project's billing plan and free-quota budget. No moderation model, secret, or moderation Cloud Function is required. Then, with an authorized service account in `GOOGLE_APPLICATION_CREDENTIALS`, run `npm run moderate:legacy` once to queue older active public Gists. The migration performs bounded Firestore reads/writes and must remain within the project's free quotas. Until rules/indexes are deployed, the production project does not enforce this moderation lifecycle.
