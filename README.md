# Bot.nev2 — All-In-One Creative Platform

**Bot.nev2** is a comprehensive web platform for creating, sharing, and experiencing bots, projects, and interactive web apps — all in a unified ecosystem.

This project blends:
- immersive visual presentation
- modular editors
- social features (friends, chat)
- marketplaces for user creations
- user profile management
- Netlify Functions + Supabase backend support

It’s designed to feel like a *creative operating hub* rather than a typical website.

---

## 🚀 Project Overview

Bot.nev2 is organized into multiple sub-systems:

### 🧠 Core Pages
These are end-user experiences:
- `index.html` — homepage/login
- `profile.html` — user profile + status
- `marketplace.html` — general marketplace
- `explore.html` — explore bots/projects/web apps
- `friend-requests.html` — manage friend requests
- `chat.html` — chat interface
- Other landing and auth pages (`login.html`, `signup.html`) :contentReference[oaicite:1]{index=1}

### 🔧 Platform Section
Located in `page/`, this is the immersive **Platform Start Menu** with:
- animated background
- cutscene
- navigation to:
  - Boteos Editor
  - Projects Editor
  - Web Apps Editor
  - Marketplaces for each type

This section behaves more like a *creative dashboard/game launcher* than a standard site. :contentReference[oaicite:2]{index=2}

### 📦 Static Assets
- `assets/` — media (videos, music, cursor, animations)
- `espeakng-*.js` — speech engine for TTS features

---

## 🛠️ Architecture

### Frontend
- Pure **HTML/CSS/JavaScript**
- No frameworks — fast and portable
- Dynamic features via modular JS files (e.g., marketplaces, editors)
- Uses modern HTML5 media APIs

### Backend
- **Netlify Functions** (`netlify/functions/`) power:
  - Profile updates
  - Marketplace item CRUD
  - Voting
  - Friend requests
  - Folder uploads
  - Backups
- These functions interact with **Supabase** for storage and auth. :contentReference[oaicite:3]{index=3}

### Database
You’ve defined tables for:
- Users & sessions
- Boteos
- Projects
- Web apps
- Votes
- Friend requests
- More as needed for community features

---

## 📁 Project Structure
/
├─ index.html # Main landing/auth
├─ marketplace.html # Marketplace
├─ explore.html # Explore page
├─ profile.html # User profile
├─ friend-requests.html # Friend management
├─ chat.html # Chat UI
|
├─ page/ # Immersive Platform UI
│ ├─ index.html
│ ├─ main.js
│ ├─ style.css
│ ├─ editors/
│ └─ marketplaces/
|
├─ assets/ # Media (videos, audio, animations)
|
├─ netlify/functions/ # Serverless backend
│ ├─ manageItem.js
│ ├─ vote.js
│ ├─ getMarketItems.js
│ ├─ getEditorItem.js
│ ├─ uploadFolder.js
│ └─ backupItem.js
|
├─ supabaseClient.js # Shared Supabase client
└─ README.md # This file


---

## 🎮 Highlights

### Immersive Platform Start
- Fullscreen animated background
- User-triggered cutscene
- Settings panel (video/music toggles)
- Animated cursor
- Gateway to creation tools

### Editors
Three core editors (future extensible):
- **Boteos Editor** — bot creator
- **Projects Editor** — project file editing
- **Web Apps Editor** — full web app creator

Editors support:
- File tree navigation
- Syntax highlighting
- Upload and backup capabilities

### Marketplaces
Each type has its own marketplace:
- Boteos
- Projects
- Web Apps

Marketplaces support voting, listing, and download hooks.

---

## 🔧 Installation & Setup

1. **Clone the Repo**
   ```bash
   git clone https://github.com/sussybocca/bot.nev2.git


Install Dependencies
None required for frontend — everything is static + serverless.

Set Up Supabase
Connect your Supabase project and configure:

URL

API Key

Database tables as defined

Deploy

⚡ Netlify (recommended)

Make sure netlify.toml is configured

Run Locally
Use Netlify Dev for local functions testing:

netlify dev
