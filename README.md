# HouseLearning Gists (Blobs)
### The free, serverless file‑sharing platform powering https://gists.houselearning.org

HouseLearning Gists — also known as **Blobs** — is a fully serverless, zero‑cost file hosting and sharing system built on Firebase Firestore.  
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
- Public gists appear in Trending and Global Feed  
- Private gists are visible only to the owner  

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
