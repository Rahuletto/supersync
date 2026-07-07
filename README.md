<p align="center">
  <img src="./icon.png" alt="SuperSync Logo" width="120" height="120" />
</p>

# SuperSync

<p align="center">
  <a href="obsidian://show-plugin?id=supersync">
    <img src="https://img.shields.io/badge/Install%20in-Obsidian-purple?style=for-the-badge&logo=obsidian&logoColor=white" alt="Install in Obsidian" />
  </a>
</p>

**SuperSync** is a simple, no-fuss Obsidian plugin that backs up and syncs your vault directly to a private GitHub repository. 

Unlike other git plugins, SuperSync doesn't need Git installed on your device or command-line setup. It uses GitHub's official APIs under the hood, meaning it works perfectly out-of-the-box on both desktop and mobile (iOS & Android).

---

## Features

* **Works Everywhere**: Syncs across iOS, Android, macOS, Windows, and Linux without any extra setup.
* **Easy Login**: Authenticate securely using GitHub's official device code flow. No copy-pasting personal access tokens or passwords—just enter the code in your browser and you're good.
* **Safe Conflicts**: Never lose your edits. If you modify a file on two devices at once, SuperSync keeps both—it preserves your local changes and saves the remote version with a `.conflict-[timestamp]` suffix.
* **Flexible Syncing**: Choose to sync automatically on startup, immediately after making changes, or on a timer.
* **File History**: Browse past versions of any note and restore them directly inside Obsidian.
* **Simple Ignore Rules**: Keep things clean by ignoring system files (`.DS_Store`), trash folders, or workspace states with standard glob patterns.

---

## Installation

### From the Obsidian Community Store
If you have Obsidian open, click the badge below to jump straight to the plugin page:

<p align="center">
  <a href="obsidian://show-plugin?id=supersync">
    <img src="https://img.shields.io/badge/Install-Open%20in%20Obsidian-purple?style=for-the-badge&logo=obsidian&logoColor=white" alt="Install in Obsidian" />
  </a>
</p>

### Manual Install
If you prefer doing it manually:
1. Download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/rahuletto/supersync/releases) page.
2. Put them in your vault under `.obsidian/plugins/supersync`.
3. Open Obsidian, go to **Settings > Community plugins**, hit refresh, and enable **SuperSync**.

---

## Setup Guide

### Step 1: Log In
1. Go to **Settings > SuperSync** in Obsidian.
2. Click **Sign in with GitHub**.
3. Copy the code that pops up and authorize it at [github.com/login/device](https://github.com/login/device).

### Step 2: Start Syncing
Trigger a sync (click **Sync now** in the settings tab, open the status panel, or press `Mod + S`). 
SuperSync will automatically look for a repository named `obsidian-sync` in your account. If it doesn't exist yet, it will **automatically create it as a private repository** for you and start backing up your files.

### Step 3: Customize (Optional)
You can change the default repository name, branch, root folder, and sync interval directly in the settings tab.

---

## Local Development

SuperSync is built using **Bun**.

### Prerequisites
Make sure you have [Bun](https://bun.sh) installed:
```bash
curl -fsSL https://bun.sh/install | sh
```

### Getting Started
1. Clone this repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Create a `.env` file in the root directory:
   ```env
   OBSIDIAN_VAULT_PATH=/absolute/path/to/your/Obsidian/Vault
   DEVICE_FLOW_CLIENT_ID=your_github_oauth_client_id
   ```

### Handy Scripts
* **Build**: `bun run build`
* **Test**: `bun run test`
* **Sync code to vault**: `bun run sync-plugin`

---

## Security & Privacy

* **Direct connection**: The plugin connects directly to GitHub. Your data is never sent to any third-party servers.
* **Local tokens**: Your GitHub OAuth token is saved locally in your vault (`.obsidian/plugins/supersync/data.json`) and never shared.

---

*Developed by [Rahuletto](https://marban.lol).*
