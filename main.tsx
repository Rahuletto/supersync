import {
  Notice,
  Plugin,
  TFile,
  debounce,
  TAbstractFile,
} from "obsidian";
import {
  Change,
  Manifest,
  RemoteTree,
  planChanges as classifyChanges,
} from "./src/sync-core";
import {
  Settings,
  SyncLogEntry,
  DeviceCodeResponse,
  DEFAULT_SETTINGS,
} from "./src/types";
import {
  PLUGIN_ID,
  VIEW_TYPE_SYNC_STATUS,
} from "./src/constants";
import { VaultHelper } from "./src/utils/vault";
import { GithubClient } from "./src/utils/github";
import { gitBlobSha } from "./src/utils/helpers";
import { ConflictModal } from "./src/ui/conflict-modal";
import { SyncLogModal } from "./src/ui/sync-log-modal";
import { DeviceFlowModal } from "./src/ui/device-flow-modal";
import { VersionRestoreModal } from "./src/ui/version-restore-modal";
import { SyncStatusView } from "./src/ui/sync-status-view";
import { SuperSyncSettingTab } from "./src/ui/settings-tab";

export default class SuperSyncPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  syncManifest: Manifest = {};
  vaultHelper!: VaultHelper;
  githubClient!: GithubClient;
  settingTab?: SuperSyncSettingTab;
  
  private syncing = false;
  private queued = false;
  private statusBar?: HTMLElement;
  private syncLog: SyncLogEntry[] = [];
  private lastStatus = "GitHub Sync: idle";
  private lastSyncAt = "";
  private lastError = "";
  private lastChangeCount = 0;
  private syncAfterChange = debounce(
    () => void this.sync("file change"),
    3000,
    true,
  );

  async onload() {
    // Initialize helpers synchronously first so they are immediately available
    this.vaultHelper = new VaultHelper(
      this.app,
      () => this.settings,
      () => this.syncManifest,
    );
    this.githubClient = new GithubClient(
      this.app,
      () => this.settings,
      async () => await this.saveSettings(),
      this.vaultHelper,
    );
    this.githubClient.onStatusUpdate = (status) => {
      this.setStatus(`GitHub Sync: ${status}`);
    };

    const data = await this.loadData();
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      data?.settings ?? data ?? {},
    );
    this.syncManifest = data?.manifest ?? {};
    this.syncLog = data?.syncLog ?? [];

    this.statusBar = this.addStatusBarItem();
    this.setStatus("GitHub Sync: idle");
    this.settingTab = new SuperSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerView(
      VIEW_TYPE_SYNC_STATUS,
      (leaf) => new SyncStatusView(leaf, this),
    );
    this.addRibbonIcon(
      "refresh-cw",
      "GitHub Sync",
      () => void this.activateStatusView(),
    );

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => void this.sync("manual"),
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "s",
        },
      ],
    });
    this.addCommand({
      id: "open-sync-status",
      name: "Open sync status panel",
      callback: () => void this.activateStatusView(),
    });
    this.addCommand({
      id: "show-sync-log",
      name: "Show sync log",
      callback: () => new SyncLogModal(this.app, this.syncLog).open(),
    });
    this.addCommand({
      id: "github-device-login",
      name: "Sign in to GitHub with device code",
      callback: () => void this.startDeviceFlowLogin(),
    });
    this.addCommand({
      id: "restore-current-file-version",
      name: "Restore current file from version history",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || this.vaultHelper.isIgnored(file.path)) return false;
        if (!checking) void this.openVersionRestore(file);
        return true;
      },
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => this.onVaultChange(file)),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => this.onVaultChange(file)),
    );
    this.registerEvent(this.app.vault.on("delete", () => this.onVaultChange()));
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        const mapping = await this.vaultHelper.getMetadataMapping();
        if (mapping[oldPath]) {
          mapping[file.path] = mapping[oldPath];
          delete mapping[oldPath];
          await this.vaultHelper.saveMetadataMapping(mapping);
        }
        this.onVaultChange(file);
      }),
    );
    this.registerInterval(
      window.setInterval(
        () => {
          if (this.settings.autoSync && this.settings.intervalMinutes > 0)
            void this.sync("interval");
        },
        Math.max(1, this.settings.intervalMinutes) * 60_000,
      ),
    );

    if (this.settings.syncOnStartup)
      this.app.workspace.onLayoutReady(() => void this.sync("startup"));
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      manifest: this.syncManifest,
      syncLog: this.syncLog,
    });
  }

  async openVersionRestore(file: TFile) {
    try {
      this.validateSettings();
      await this.githubClient.ensureRepositoryReady();
      const versions = await this.githubClient.fileVersions(file.path);
      if (versions.length === 0) {
        new Notice(`No GitHub history found for ${file.path}.`);
        return;
      }
      new VersionRestoreModal(this.app, this, file, versions, async (version) => {
        const bytes = await this.githubClient.downloadBytesAtCommit(file.path, version.sha);
        await this.vaultHelper.writeVaultFile(file.path, bytes);
        new Notice(`Restored ${file.name} to the version from commit ${version.sha.slice(0, 8)}.`);
      }).open();
    } catch (error) {
      this.fail("Version restore failed", error);
    }
  }

  async startDeviceFlowLogin() {
    try {
      const clientId = this.settings.deviceFlowClientId.trim();
      if (!clientId)
        throw new Error(
          "Set GitHub OAuth Client ID in settings first, or paste a fine-grained token instead.",
        );
      const device = await this.githubClient.githubOauth<DeviceCodeResponse>(
        "POST",
        "/login/device/code",
        {
          client_id: clientId,
          scope: "repo",
        },
      );
      new DeviceFlowModal(
        this.app,
        device,
        clientId,
        this.githubClient,
        async (token) => {
          this.settings.token = token;
          this.settings.owner = "";
          await this.githubClient.ensureRepositoryReady();
          await this.saveSettings();
          new Notice("GitHub sign-in complete.");
          this.refreshStatusViews();
          this.settingTab?.display();
        },
      ).open();
    } catch (error) {
      this.fail("GitHub sign-in failed", error);
    }
  }

  async ensureReadmeExists() {
    const oldPath = "README.md";
    const newPath = "README";

    // Clean up old README.md if it exists
    const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
    if (oldFile) {
      this.vaultHelper.pluginWrites.add(oldPath);
      await this.app.vault.delete(oldFile, true);
    }

    const exists = this.app.vault.getAbstractFileByPath(newPath);
    if (!exists) {
      this.vaultHelper.pluginWrites.add(newPath);
      await this.app.vault.create(
        newPath,
        `# 🔒 Private Obsidian Vault\n\nThis repository stores a private, secure backup of your Obsidian vault, synchronized automatically by **SuperSync**.\n\n## ⚠️ Important Notes\n* **Keep Private**: This repository contains your personal notes. Do not make this repository public.\n* **Automated Sync**: Files are synced automatically by the SuperSync plugin. Avoid manual modifications to the files directly on GitHub to prevent sync conflicts.\n`,
      );
    }
  }

  private onVaultChange(file?: TAbstractFile) {
    if (!this.settings.autoSync || !this.settings.syncOnFileChange) return;
    if (file?.path && this.vaultHelper.isIgnored(file.path)) return;
    if (file?.path && this.vaultHelper.pluginWrites.has(file.path)) {
      this.vaultHelper.pluginWrites.delete(file.path);
      return;
    }
    this.syncAfterChange();
  }

  async sync(reason: string) {
    if (this.syncing) {
      this.queued = true;
      return;
    }
    this.syncing = true;
    this.queued = false;
    const startedAt = new Date().toISOString();
    let changesForLog: Change[] = [];
    let commitSha: string | undefined;
    this.setStatus(`GitHub Sync: syncing (${reason})`);

    try {
      this.validateSettings();
      await this.githubClient.ensureRepositoryReady();
      await this.ensureReadmeExists();
      const [local, remoteInfo] = await Promise.all([
        this.vaultHelper.localManifest(),
        this.githubClient.remoteTree(),
      ]);
      const changes = this.planChanges(local, remoteInfo.tree);
      
      // Clean up old README.md on remote if it got planned or exists there
      if (remoteInfo.tree["README.md"] && !local["README.md"]) {
        const cleanChanges = changes.filter(c => !(c.type === "download" && c.path === "README.md"));
        cleanChanges.push({ type: "deleteRemote", path: "README.md" });
        changes.length = 0;
        changes.push(...cleanChanges);
      }
      
      changesForLog = changes;
      if (changes.length === 0) {
        this.setStatus("GitHub Sync: synced");
        this.lastSyncAt = new Date().toLocaleString();
        this.lastChangeCount = 0;
        this.lastError = "";
        this.refreshStatusViews();
        await this.saveSettings();
        this.recordSyncLog(startedAt, reason, "success", changesForLog);
        return;
      }

      const resolvedChanges = await this.resolveConflicts(changes, local);
      changesForLog = resolvedChanges;
      const remoteUpdates = await this.applyLocalChanges(
        resolvedChanges,
        local,
      );
      const commitNeeded = resolvedChanges.some(
        (c) => c.type === "upload" || c.type === "deleteRemote",
      );
      let nextRemote = { ...remoteInfo.tree, ...remoteUpdates };
      if (commitNeeded) {
        const commitResult = await this.githubClient.commitRemoteChangesWithRetry(
          resolvedChanges,
          remoteInfo,
          nextRemote,
          () => this.vaultHelper.localManifest(),
          (l, r) => this.planChanges(l, r),
          (c, l) => this.resolveConflicts(c, l),
        );
        nextRemote = commitResult.remote;
        commitSha = commitResult.commitSha;
      }

      const finalLocal = await this.vaultHelper.localManifest();
      this.syncManifest = this.nextManifest(finalLocal, nextRemote);
      await this.saveSettings();
      this.lastSyncAt = new Date().toLocaleString();
      this.lastChangeCount = changes.length;
      this.lastError = "";
      this.setStatus(
        `GitHub Sync: synced ${resolvedChanges.length} change${resolvedChanges.length === 1 ? "" : "s"}`,
      );
      this.recordSyncLog(
        startedAt,
        reason,
        "success",
        changesForLog,
        commitSha,
      );
    } catch (error) {
      this.recordSyncLog(
        startedAt,
        reason,
        "error",
        changesForLog,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
      this.fail("Sync failed", error);
    } finally {
      this.syncing = false;
      if (this.queued) void this.sync("queued");
    }
  }

  private validateSettings() {
    if (!this.settings.token.trim())
      throw new Error("GitHub token is required.");
    if (!this.settings.repo.trim()) this.settings.repo = DEFAULT_SETTINGS.repo;
    if (!this.settings.branch.trim())
      this.settings.branch = DEFAULT_SETTINGS.branch;
  }

  private planChanges(local: Manifest, remote: RemoteTree): Change[] {
    return classifyChanges(local, remote, this.syncManifest, (path) =>
      this.vaultHelper.isIgnored(path),
    );
  }

  private async resolveConflicts(
    changes: Change[],
    local: Manifest,
  ): Promise<Change[]> {
    const conflicts = changes.filter((change) => change.type === "conflict") as Array<Extract<Change, { type: "conflict" }>>;
    if (conflicts.length === 0) return changes;
    const resolutions = await new ConflictModal(this.app, this, conflicts).resolve();
    const resolved: Change[] = changes.filter(
      (change) => change.type !== "conflict",
    );
    for (const conflict of conflicts) {
      const choice = resolutions.get(conflict.path) ?? "both";
      if (choice === "local") {
        if (local[conflict.path])
          resolved.push({ type: "upload", path: conflict.path });
        else resolved.push({ type: "deleteRemote", path: conflict.path });
      } else if (choice === "remote") {
        if (conflict.remoteSha)
          resolved.push({
            type: "download",
            path: conflict.path,
            remoteSha: conflict.remoteSha,
          });
        else resolved.push({ type: "deleteLocal", path: conflict.path });
      } else {
        if (conflict.remoteSha)
          resolved.push({
            type: "downloadConflictCopy",
            path: conflict.path,
            remoteSha: conflict.remoteSha,
          });
        if (local[conflict.path])
          resolved.push({ type: "upload", path: conflict.path });
        else resolved.push({ type: "deleteRemote", path: conflict.path });
      }
    }
    return resolved;
  }

  private async applyLocalChanges(
    changes: Change[],
    local: Manifest,
  ): Promise<RemoteTree> {
    const updates: RemoteTree = {};
    for (const change of changes) {
      if (change.type === "download") {
        await this.vaultHelper.backupLocalFile(change.path);
        await this.vaultHelper.writeVaultFile(
          change.path,
          await this.githubClient.downloadBytes(change.path),
        );
      }
      if (change.type === "deleteLocal") {
        await this.vaultHelper.backupLocalFile(change.path);
        await this.vaultHelper.deleteVaultFile(change.path);
      }
      if (change.type === "downloadConflictCopy") {
        const conflictPath = this.vaultHelper.conflictPath(change.path);
        const bytes = await this.githubClient.downloadBytes(change.path);
        await this.vaultHelper.writeVaultFile(conflictPath, bytes);
        const sha = await gitBlobSha(bytes);
        updates[conflictPath] = { sha, size: bytes.byteLength };
        new Notice(`Conflict kept: ${conflictPath}`, 10000);
      }
    }
    return updates;
  }

  private nextManifest(local: Manifest, remote: RemoteTree): Manifest {
    const next: Manifest = {};
    for (const path of new Set([
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      if (this.vaultHelper.isIgnored(path)) continue;
      if (local[path] && remote[path])
        next[path] = {
          sha: local[path].sha,
          remoteSha: remote[path].sha,
          size: local[path].size,
        };
    }
    return next;
  }

  private setStatus(text: string) {
    this.lastStatus = text;
    this.statusBar?.setText(text);
    this.refreshStatusViews();
  }

  private fail(prefix: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.setStatus(`${prefix}: ${message}`);
    new Notice(`${prefix}: ${message}`, 10000);
    console.error(prefix, error);
  }

  getStatusSnapshot() {
    return {
      status: this.lastStatus,
      lastSyncAt: this.lastSyncAt || "Never",
      lastError: this.lastError || "None",
      lastChangeCount: this.lastChangeCount,
      trackedFiles: Object.keys(this.syncManifest).length,
      logEntries: this.syncLog.length,
      configured: Boolean(
        this.settings.token &&
        this.settings.owner &&
        this.settings.repo &&
        this.settings.branch,
      ),
      repo:
        this.settings.owner && this.settings.repo
          ? `${this.settings.owner}/${this.settings.repo}`
          : "Not configured",
      branch: this.settings.branch || "Not configured",
    };
  }

  async activateStatusView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SYNC_STATUS);
    const leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_SYNC_STATUS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshStatusViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_SYNC_STATUS,
    )) {
      const view = leaf.view;
      if (view instanceof SyncStatusView) view.render();
    }
  }

  showSyncLog() {
    new SyncLogModal(this.app, this.syncLog).open();
  }

  private recordSyncLog(
    startedAt: string,
    reason: string,
    status: "success" | "error",
    changes: Change[],
    commitSha?: string,
    error?: string,
  ) {
    this.syncLog.unshift({
      startedAt,
      endedAt: new Date().toISOString(),
      reason,
      status,
      changes: changes.length,
      uploads: changes.filter((c) => c.type === "upload").length,
      downloads: changes.filter((c) => c.type === "download").length,
      deletes: changes.filter(
        (c) => c.type === "deleteLocal" || c.type === "deleteRemote",
      ).length,
      conflicts: changes.filter((c) => c.type === "conflict").length,
      commitSha,
      error,
    });
    this.syncLog = this.syncLog.slice(0, 100);
    void this.saveSettings();
    this.refreshStatusViews();
  }
}
