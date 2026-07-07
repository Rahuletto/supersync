# GitSync

GitSync is a lightweight, unified Obsidian plugin designed to synchronize your Obsidian vaults directly with a **private GitHub repository** using the GitHub REST and Git Data APIs. It works seamlessly across both desktop and mobile platforms.

---

## 🔒 Security & Privacy Notice
* **Private Repository**: GitSync is designed to sync with a **private** GitHub repository (defaulting to `obsidian-sync`). Always keep this repository private to protect your personal notes and vault contents.
* **Credentials**: Authentication is handled locally via the GitHub Device Flow. Your OAuth Access Token is saved securely inside your vault's local plugin settings file (`data.json`) and is never sent to any external server other than the official GitHub API.

---

## ✨ Features
* **Zero-Password Login**: Log in securely using GitHub's official **Device Authorization Flow** (entering a code in the browser). No need to copy-paste fine-grained Personal Access Tokens.
* **Safety First**: Prevents local data loss. In case of conflicting edits, local changes are preserved, and the remote version is downloaded as a `.conflict-` file.
* **Intelligent Ignores**: Exclude system files (`.DS_Store`), trash folders, or workspace configurations via customizable glob ignore rules.
* **Automated Syncing**: Configurable automatic syncing on vault startup, immediately following file changes, or periodically on an interval timer.
* **Version History Restore**: Browse commit history and restore individual files to past versions directly from Obsidian.

---

## 🛠️ Development & Building

GitSync uses **Bun** as its package manager and runtime execution engine.

### 1. Prerequisites
Ensure you have [Bun](https://bun.sh) installed:
```bash
# To install Bun (macOS/Linux)
curl -fsSL https://bun.sh/install | sh
```

### 2. Local Configuration
Create a local `.env` file in the root directory (this is automatically ignored by Git):
```env
OBSIDIAN_VAULT_PATH=/path/to/your/Obsidian/Vault
DEVICE_FLOW_CLIENT_ID=your_oauth_client_id
```

### 3. Scripts
* **Clean & Build**:
  Builds the production-ready bundle into `main.js`.
  ```bash
  bun run build
  ```
* **Run Tests**:
  Compiles and executes the unit tests for the core sync planning engine.
  ```bash
  bun run test
  ```
* **Sync to Local Vault**:
  Builds the plugin and copies the compiled assets (`main.js`, `manifest.json`, `styles.css`) directly to your vault's plugin directory for testing.
  ```bash
  bun run sync-plugin
  ```

---

*Developed by Rahuletto (https://marban.lol) for GitSync.*
