import { requestUrl, App, TFile } from "obsidian";
import { Settings, DeviceCodeResponse, VersionEntry } from "../types";
import { RemoteTree, Change, Manifest } from "../sync-core";
import { VaultHelper } from "./vault";
import {
  sleep,
  encodePath,
  base64FromBytes,
  bytesFromBase64,
  gitBlobSha,
  formatBytes,
} from "./helpers";
import { GITHUB_BLOB_LIMIT } from "../constants";

export class RemoteAdvancedError extends Error {}

export class GithubClient {
  public onStatusUpdate?: (status: string) => void;

  constructor(
    private app: App,
    private getSettings: () => Settings,
    private saveSettings: () => Promise<void>,
    private vaultHelper: VaultHelper,
  ) {}

  async github<T = unknown>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<T> {
    const settings = this.getSettings();
    return this.githubRaw<T>(
      method,
      `repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}${endpoint}`,
      body,
      false,
    );
  }

  async githubRaw<T = unknown>(
    method: string,
    endpoint: string,
    body?: unknown,
    allowFailure = false,
    baseUrl = "https://api.github.com/",
  ): Promise<T & { ok?: boolean; status?: number; message?: string }> {
    const settings = this.getSettings();
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
    const response = await requestUrl({
      url,
      method,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      const message =
        typeof response.json === "object" && response.json?.message
          ? response.json.message
          : response.text;
      if (allowFailure)
        return { ok: false, status: response.status, message } as T & {
          ok: boolean;
          status: number;
          message: string;
        };
      throw new Error(
        `GitHub ${method} ${endpoint} failed (${response.status}): ${message}`,
      );
    }
    if (allowFailure && typeof response.json === "object")
      return Object.assign(response.json ?? {}, {
        ok: true,
        status: response.status,
      }) as T & {
        ok: boolean;
        status: number;
      };
    return response.json as T & {
      ok?: boolean;
      status?: number;
      message?: string;
    };
  }

  async githubOauth<T>(
    method: string,
    endpoint: string,
    body: unknown,
  ): Promise<T> {
    const response = await requestUrl({
      url: `https://github.com${endpoint}`,
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        `GitHub OAuth failed (${response.status}): ${response.text}`,
      );
    return response.json as T;
  }

  async githubUser(): Promise<{ login: string }> {
    return this.githubRaw<{ login: string }>(
      "GET",
      "/user",
      undefined,
      false,
      "https://api.github.com",
    );
  }

  async pollDeviceToken(
    clientId: string,
    device: DeviceCodeResponse,
  ): Promise<string> {
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = Math.max(5, device.interval) * 1000;
    while (Date.now() < deadline) {
      await sleep(interval);
      const result = await this.githubOauth<{
        access_token?: string;
        error?: string;
        error_description?: string;
      }>("POST", "/login/oauth/access_token", {
        client_id: clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (result.access_token) return result.access_token;
      if (result.error === "authorization_pending") continue;
      if (result.error === "slow_down") {
        interval += 5000;
        continue;
      }
      if (result.error === "expired_token")
        throw new Error("Device code expired. Start sign-in again.");
      if (result.error === "access_denied")
        throw new Error("GitHub sign-in was denied.");
      throw new Error(
        result.error_description || result.error || "GitHub sign-in failed.",
      );
    }
    throw new Error("Device code expired. Start sign-in again.");
  }

  async ensureRepositoryReady() {
    this.onStatusUpdate?.("checking credentials...");
    const settings = this.getSettings();
    if (!settings.owner.trim()) {
      const user = await this.githubUser();
      settings.owner = user.login;
      await this.saveSettings();
    }

    this.onStatusUpdate?.("verifying repository exists...");
    const repo = await this.githubRaw<{ default_branch?: string }>(
      "GET",
      `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`,
      undefined,
      true,
    );
    if (!repo.ok) {
      if (repo.status !== 404)
        throw new Error(
          `GitHub repo lookup failed (${repo.status}): ${repo.message}`,
        );
      this.onStatusUpdate?.("creating remote repository...");
      await this.githubRaw(
        "POST",
        "/user/repos",
        {
          name: settings.repo,
          private: true,
          auto_init: true,
          description: "ObsidianSync private Obsidian vault synchronization repository."
        },
        false,
      );
    }

    this.onStatusUpdate?.("checking branch reference...");
    const branch = await this.githubRaw(
      "GET",
      `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/git/ref/heads/${encodeURIComponent(settings.branch)}`,
      undefined,
      true,
    );
    if (!branch.ok) {
      if (settings.branch !== "main")
        throw new Error(
          `Branch ${settings.branch} does not exist. Create it on GitHub or use main.`,
        );
      throw new Error(
        "New repository is still initializing on GitHub. Wait a few seconds and sync again.",
      );
    }
  }

  async remoteTree(): Promise<{
    headSha: string;
    treeSha: string;
    tree: RemoteTree;
  }> {
    this.onStatusUpdate?.("fetching remote tree...");
    const settings = this.getSettings();
    const ref = await this.github<{ object: { sha: string } }>(
      "GET",
      `/git/ref/heads/${encodeURIComponent(settings.branch)}?t=${Date.now()}`,
    );
    const commit = await this.github<{ tree: { sha: string } }>(
      "GET",
      `/git/commits/${ref.object.sha}`,
    );
    const treeResponse = await this.github<{
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated?: boolean;
    }>("GET", `/git/trees/${commit.tree.sha}?recursive=1`);
    if (treeResponse.truncated)
      throw new Error(
        "GitHub truncated the repository tree. Split the vault with Root path or reduce repository size before syncing.",
      );
    const tree: RemoteTree = {};
    for (const item of treeResponse.tree) {
      if (item.type !== "blob") continue;
      const path = this.vaultHelper.localPath(item.path);
      if (!path || this.vaultHelper.isIgnored(path)) continue;
      if (item.size && item.size > GITHUB_BLOB_LIMIT)
        throw new Error(
          `${path} is ${formatBytes(item.size)}, above GitHub's 100 MB file limit. Move it to Git LFS/external storage or ignore it.`,
        );
      tree[path] = { sha: item.sha, size: item.size };
    }
    return { headSha: ref.object.sha, treeSha: commit.tree.sha, tree };
  }

  async downloadBytes(path: string): Promise<ArrayBuffer> {
    const settings = this.getSettings();
    await this.vaultHelper.assertRemoteDownloadable(path);
    const data = await this.github<{ content: string; encoding: string }>(
      "GET",
      `/contents/${encodePath(this.vaultHelper.remotePath(path))}?ref=${encodeURIComponent(settings.branch)}`,
    );
    if (data.encoding !== "base64")
      throw new Error(`Unsupported GitHub content encoding for ${path}`);
    const bytes = bytesFromBase64(data.content.replace(/\s/g, ""));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async downloadBytesAtCommit(
    path: string,
    commitSha: string,
  ): Promise<ArrayBuffer> {
    const data = await this.github<{
      content: string;
      encoding: string;
      size?: number;
    }>(
      "GET",
      `/contents/${encodePath(this.vaultHelper.remotePath(path))}?ref=${encodeURIComponent(commitSha)}`,
    );
    if (data.size) this.vaultHelper.assertSyncableSize(path, data.size);
    if (data.encoding !== "base64")
      throw new Error(`Unsupported GitHub content encoding for ${path}`);
    const bytes = bytesFromBase64(data.content.replace(/\s/g, ""));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async fileVersions(path: string): Promise<VersionEntry[]> {
    const settings = this.getSettings();
    const commits = await this.github<
      Array<{
        sha: string;
        commit: { message: string; author?: { date?: string } };
      }>
    >(
      "GET",
      `/commits?sha=${encodeURIComponent(settings.branch)}&path=${encodePath(this.vaultHelper.remotePath(path))}&per_page=50`,
    );
    return commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message.split("\n")[0],
      date: commit.commit.author?.date ?? "",
    }));
  }

  async commitRemoteChangesWithRetry(
    changes: Change[],
    remoteInfo: { headSha: string; treeSha: string; tree: RemoteTree },
    remote: RemoteTree,
    localManifestCallback: () => Promise<Manifest>,
    planChangesCallback: (local: Manifest, tree: RemoteTree) => Change[],
    resolveConflictsCallback: (changes: Change[], local: Manifest) => Promise<Change[]>,
  ): Promise<{ remote: RemoteTree; commitSha?: string }> {
    try {
      return await this.commitRemoteChanges(changes, remoteInfo, remote);
    } catch (error) {
      if (!(error instanceof RemoteAdvancedError)) throw error;
      const fresh = await this.remoteTree();
      const local = await localManifestCallback();
      const retryChanges = await resolveConflictsCallback(
        planChangesCallback(local, fresh.tree),
        local,
      );
      const retryRemote = { ...fresh.tree };
      return this.commitRemoteChanges(retryChanges, fresh, retryRemote);
    }
  }

  async commitRemoteChanges(
    changes: Change[],
    remoteInfo: { headSha: string; treeSha: string; tree: RemoteTree },
    remote: RemoteTree,
  ): Promise<{ remote: RemoteTree; commitSha?: string }> {
    const settings = this.getSettings();
    const tree: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string | null;
    }> = [];
    const touched = new Set<string>();
    
    const totalUploads = changes.filter(c => c.type === "upload").length;
    let currentUpload = 0;

    for (const change of changes) {
      if (touched.has(change.path)) continue;
      touched.add(change.path);
      if (change.type === "upload") {
        currentUpload++;
        this.onStatusUpdate?.(`uploading files (${currentUpload}/${totalUploads})...`);
        const file = this.app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile)) continue;
        const bytes = await this.app.vault.readBinary(file);
        this.vaultHelper.assertSyncableSize(change.path, bytes.byteLength);
        const blob = await this.github<{ sha: string }>("POST", "/git/blobs", {
          content: base64FromBytes(bytes),
          encoding: "base64",
        });
        tree.push({
          path: this.vaultHelper.remotePath(change.path),
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        });
        remote[change.path] = {
          sha: await gitBlobSha(bytes),
          size: bytes.byteLength,
        };
      }
      if (change.type === "deleteRemote") {
        tree.push({
          path: this.vaultHelper.remotePath(change.path),
          mode: "100644",
          type: "blob",
          sha: null,
        });
        delete remote[change.path];
      }
    }
    if (tree.length === 0) return { remote };
    this.onStatusUpdate?.("creating remote tree...");
    const newTree = await this.github<{ sha: string }>("POST", "/git/trees", {
      base_tree: remoteInfo.treeSha,
      tree,
    });
    
    this.onStatusUpdate?.("creating git commit...");
    const commit = await this.github<{ sha: string }>("POST", "/git/commits", {
      message: `Obsidian sync ${new Date().toISOString()}`,
      tree: newTree.sha,
      parents: [remoteInfo.headSha],
      author: {
        name: settings.authorName,
        email: settings.authorEmail,
      },
    });
    
    this.onStatusUpdate?.("pushing reference patch...");
    try {
      await this.github(
        "PATCH",
        `/git/refs/heads/${encodeURIComponent(settings.branch)}`,
        {
          sha: commit.sha,
          force: false,
        },
      );
    } catch (error) {
      throw new RemoteAdvancedError(
        error instanceof Error ? error.message : String(error),
      );
    }
    return { remote, commitSha: commit.sha };
  }

  async checkDeviceToken(
    clientId: string,
    deviceCode: string,
  ): Promise<{ access_token?: string; error?: string; error_description?: string }> {
    return this.githubOauth<{
      access_token?: string;
      error?: string;
      error_description?: string;
    }>("POST", "/login/oauth/access_token", {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
  }
}
