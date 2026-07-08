import { App, Notice, TFile, normalizePath, stringifyYaml } from "obsidian";
import { Settings } from "../types";
import { Manifest } from "../sync-core";
import {
  detectRemotePrefix as detectRemotePrefixForVault,
  localPath as localPathForVault,
  remotePath as remotePathForVault,
} from "../remote-paths";
import { gitBlobSha, matchesPattern, formatBytes } from "./helpers";
import {
  PLUGIN_ID,
  CONFLICT_STAMP,
  GITHUB_BLOB_LIMIT,
  GITHUB_RECOMMENDED_BLOB_LIMIT,
} from "../constants";

export class VaultHelper {
  public pluginWrites = new Set<string>();

  /** Call at the start of every sync so stale write-guards don't suppress real user edits. */
  clearPluginWrites() {
    this.pluginWrites.clear();
  }

  constructor(
    private app: App,
    private getSettings: () => Settings,
    private getSyncManifest: () => Manifest,
  ) {}

  isIgnored(path: string): boolean {
    path = normalizePath(path);
    const settings = this.getSettings();
    const configDir = this.app.vault.configDir;
    if (!settings.syncObsidianConfig && path.startsWith(configDir + "/"))
      return true;
    if (
      !settings.syncCommunityPlugins &&
      path.startsWith(configDir + "/plugins/") &&
      !path.startsWith(`${configDir}/plugins/${PLUGIN_ID}/`)
    )
      return true;
    return this.ignoreRules().some((pattern) => matchesPattern(path, pattern));
  }

  private ignoreRules(): string[] {
    return (this.getSettings().ignorePatterns || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  remotePath(path: string): string {
    return remotePathForVault(
      this.app.vault.getName(),
      this.getSettings().rootPath,
      path,
    );
  }

  localPath(remotePath: string, prefixOverride?: string): string | null {
    return localPathForVault(
      this.app.vault.getName(),
      this.getSettings().rootPath,
      remotePath,
      prefixOverride,
    );
  }

  /**
   * Given the raw list of paths from GitHub's recursive tree API, find the
   * remote folder that belongs to this vault. Returns the prefix string to
   * pass back into localPath().
   *
   * Strategy:
   *  1. Try exact match with the constructed prefix (vaultName[/rootPath]).
   *  2. Try case-insensitive match with the same prefix.
   *  3. Fall back to just the vault name, case-insensitive.
   * This survives rootPath mismatches between devices and name casing quirks.
   */
  detectRemotePrefix(remotePaths: string[]): string {
    return detectRemotePrefixForVault(
      this.app.vault.getName(),
      this.getSettings().rootPath,
      remotePaths,
    );
  }

  conflictPath(path: string): string {
    const stamp = new Date().toISOString().replace(CONFLICT_STAMP, "-");
    const dot = path.lastIndexOf(".");
    return dot > -1
      ? `${path.slice(0, dot)}.conflict-${stamp}${path.slice(dot)}`
      : `${path}.conflict-${stamp}`;
  }

  restoredPath(path: string, commitSha: string): string {
    const dot = path.lastIndexOf(".");
    const suffix = `.restored-${commitSha.slice(0, 8)}`;
    return dot > -1
      ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}`
      : `${path}${suffix}`;
  }

  async getMetadataMapping(): Promise<Record<string, string>> {
    const path = ".supersync-metadata.json";
    const exists = await this.app.vault.adapter.exists(path);
    if (!exists) return {};
    try {
      const text = await this.app.vault.adapter.read(path);
      return JSON.parse(text) || {};
    } catch {
      return {};
    }
  }

  async saveMetadataMapping(mapping: Record<string, string>) {
    const path = ".supersync-metadata.json";
    const content = JSON.stringify(mapping, null, 2);
    this.pluginWrites.add(path);
    await this.app.vault.adapter.write(path, content);
  }

  async ensureFileMetadata(file: TFile, mapping: Record<string, string>): Promise<{ id: string; bytes: ArrayBuffer }> {
    let content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    
    let id = frontmatter?.id || mapping[file.path];
    if (!id) {
      id = "supersync-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
    }
    
    if (mapping[file.path] !== id) {
      mapping[file.path] = id;
    }

    let needsUpdate = false;
    let contentWithoutFM = content;
    
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (fmMatch) {
      contentWithoutFM = content.slice(fmMatch[0].length);
    }

    // Strip id and title from frontmatter if they exist in file content
    if (frontmatter && (frontmatter.id || frontmatter.title)) {
      const newFM = { ...frontmatter };
      delete newFM.id;
      delete newFM.title;
      
      needsUpdate = true;
      
      if (Object.keys(newFM).length > 0) {
        const yaml = stringifyYaml(newFM).trim();
        content = `---\n${yaml}\n---\n` + contentWithoutFM;
      } else {
        content = contentWithoutFM;
      }
    }

    // Clean up title heading if present
    contentWithoutFM = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/) 
      ? content.slice(content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)![0].length).trimStart()
      : content.trimStart();
      
    const headingMatch = contentWithoutFM.match(/^#\s+(.*?)\r?\n/);
    if (headingMatch && headingMatch[1] === file.basename) {
      contentWithoutFM = contentWithoutFM.slice(headingMatch[0].length).trimStart();
      needsUpdate = true;
      
      const fmMatch2 = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      if (fmMatch2) {
        content = fmMatch2[0] + contentWithoutFM;
      } else {
        content = contentWithoutFM;
      }
    }
    
    if (needsUpdate) {
      this.pluginWrites.add(file.path);
      await this.app.vault.modify(file, content);
    }
    
    const bytes = new TextEncoder().encode(content).buffer;
    return { id, bytes };
  }

  async getFileMetadataOrDefaults(file: TFile, mapping: Record<string, string>): Promise<{ id: string; bytes: ArrayBuffer }> {
    if (file.extension !== "md") {
      const bytes = await this.app.vault.readBinary(file);
      return { id: file.path, bytes };
    }
    return this.ensureFileMetadata(file, mapping);
  }

  async listAllSyncablePaths(): Promise<string[]> {
    const paths = this.app.vault.getFiles().map((f) => f.path);
    const settings = this.getSettings();
    if (settings.syncObsidianConfig) {
      await this.scanFolderRecursive(this.app.vault.configDir, paths);
    }
    // Deduplicate: getFiles() already includes configDir TFiles on some platforms,
    // so scanFolderRecursive can produce duplicates that cause spurious upload loops.
    const seen = new Set<string>();
    return paths.filter((p) => {
      if (this.isIgnored(p)) return false;
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  }

  private async scanFolderRecursive(folderPath: string, paths: string[]): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(folderPath);
      if (!exists) return;
      
      const list = await this.app.vault.adapter.list(folderPath);
      for (const file of list.files) {
        paths.push(file);
      }
      for (const folder of list.folders) {
        if (!this.isIgnored(folder)) {
          await this.scanFolderRecursive(folder, paths);
        }
      }
    } catch (e) {
      console.error(`Failed to scan folder ${folderPath}:`, e);
    }
  }

  async localManifest(): Promise<Manifest> {
    const result: Manifest = {};
    const mapping = await this.getMetadataMapping();
    let needsSave = false;

    // Detect offline renames by matching file hashes
    const syncablePaths = await this.listAllSyncablePaths();
    const missingPaths = Object.keys(mapping).filter(p => !syncablePaths.includes(p));
    const untrackedFiles = syncablePaths
      .map(p => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md" && !mapping[f.path]);
    
    if (missingPaths.length > 0 && untrackedFiles.length > 0) {
      for (const file of untrackedFiles) {
        const bytes = await this.app.vault.readBinary(file);
        const sha = await gitBlobSha(bytes);
        const matchedPath = missingPaths.find(p => this.getSyncManifest()[p]?.sha === sha);
        if (matchedPath) {
          mapping[file.path] = mapping[matchedPath];
          delete mapping[matchedPath];
          missingPaths.splice(missingPaths.indexOf(matchedPath), 1);
          needsSave = true;
        }
      }
    }

    // Clean up any remaining dead paths in the mapping
    for (const p of missingPaths) {
      delete mapping[p];
      needsSave = true;
    }

    for (const path of syncablePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      let sha = "";
      let size = 0;
      let id = path;

      if (file instanceof TFile) {
        const oldMappingVal = mapping[file.path];
        const res = await this.getFileMetadataOrDefaults(file, mapping);
        id = res.id;
        sha = await gitBlobSha(res.bytes);
        size = res.bytes.byteLength;
        if (mapping[file.path] !== oldMappingVal) {
          needsSave = true;
        }
      } else {
        // Hidden file or config file (read directly from adapter)
        const bytes = await this.app.vault.adapter.readBinary(path);
        sha = await gitBlobSha(bytes);
        size = bytes.byteLength;
        id = path;
      }

      this.assertSyncableSize(path, size);
      result[path] = {
        sha,
        remoteSha: this.getSyncManifest()[path]?.remoteSha ?? null,
        size,
        id,
      };
    }

    if (needsSave) {
      await this.saveMetadataMapping(mapping);
    }

    // Manually add the metadata file to the manifest so it gets synced!
    const metadataPath = ".supersync-metadata.json";
    const exists = await this.app.vault.adapter.exists(metadataPath);
    if (exists) {
      const content = await this.app.vault.adapter.read(metadataPath);
      const bytes = new TextEncoder().encode(content).buffer;
      const sha = await gitBlobSha(bytes);
      result[metadataPath] = {
        sha,
        remoteSha: this.getSyncManifest()[metadataPath]?.remoteSha ?? null,
        size: bytes.byteLength,
        id: metadataPath,
      };
    }

    return result;
  }

  async ensureDirectoryExists(path: string) {
    const parts = path.split("/");
    parts.pop(); // Remove file name
    
    let currentPath = "";
    for (const part of parts) {
      if (!part) continue;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const normalized = normalizePath(currentPath);
      const isHidden = normalized.startsWith(".");
      
      if (isHidden) {
        const exists = await this.app.vault.adapter.exists(normalized);
        if (!exists) {
          await this.app.vault.adapter.mkdir(normalized);
        }
      } else {
        // Check the in-memory index first (fast path), then fall back to the
        // adapter (filesystem) because on mobile the index can lag after a
        // rapid sequence of downloads.
        const inIndex = this.app.vault.getAbstractFileByPath(normalized);
        const onDisk = inIndex ? true : await this.app.vault.adapter.exists(normalized);
        if (!onDisk) {
          try {
            await this.app.vault.createFolder(normalized);
          } catch {
            // Folder may have been created concurrently (e.g. by another change
            // in the same sync batch). Verify it actually exists now rather than
            // relying on an error-message string that varies by platform/locale.
            const nowExists = await this.app.vault.adapter.exists(normalized);
            if (!nowExists) throw new Error(`Failed to create folder: ${normalized}`);
          }
        }
      }
    }
  }

  async writeVaultFile(path: string, bytes: ArrayBuffer) {
    path = normalizePath(path);
    this.pluginWrites.add(path);
    await this.ensureDirectoryExists(path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const configDir = this.app.vault.configDir;
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, bytes);
    } else if (path.startsWith(configDir + "/")) {
      await this.app.vault.adapter.writeBinary(path, bytes);
    } else {
      await this.app.vault.createBinary(path, bytes);
    }
  }

  async backupLocalFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const bytes = await this.app.vault.readBinary(file);
    const backupPath = normalizePath(
      `.github-sync-backup/${new Date().toISOString().replace(CONFLICT_STAMP, "-")}/${path}`,
    );
    await this.writeVaultFile(backupPath, bytes);
  }

  async deleteVaultFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) {
      this.pluginWrites.add(path);
      await this.app.vault.delete(file, true);
    } else {
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        this.pluginWrites.add(path);
        await this.app.vault.adapter.remove(path);
      }
    }
  }

  async assertRemoteDownloadable(path: string) {
    const size = this.getSyncManifest()[path]?.size;
    if (size) this.assertSyncableSize(path, size);
  }

  assertSyncableSize(path: string, size: number) {
    if (size > GITHUB_BLOB_LIMIT)
      throw new Error(
        `${path} is ${formatBytes(size)}, above GitHub's 100 MB file limit. Move it to Git LFS/external storage or ignore it.`,
      );
    if (size > GITHUB_RECOMMENDED_BLOB_LIMIT)
      new Notice(
        `${path} is ${formatBytes(size)}. GitHub allows it, but large files make mobile sync slow.`,
        8000,
      );
  }
}
