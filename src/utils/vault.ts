import { App, Notice, TFile, TAbstractFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { Settings } from "../types";
import { Manifest } from "../sync-core";
import { gitBlobSha, matchesPattern, formatBytes } from "./helpers";
import {
  PLUGIN_ID,
  CONFLICT_STAMP,
  GITHUB_BLOB_LIMIT,
  GITHUB_RECOMMENDED_BLOB_LIMIT,
} from "../constants";

export class VaultHelper {
  public pluginWrites = new Set<string>();

  constructor(
    private app: App,
    private getSettings: () => Settings,
    private getSyncManifest: () => Manifest,
  ) {}

  isIgnored(path: string): boolean {
    path = normalizePath(path);
    const settings = this.getSettings();
    if (!settings.syncObsidianConfig && path.startsWith(".obsidian/"))
      return true;
    if (
      !settings.syncCommunityPlugins &&
      path.startsWith(".obsidian/plugins/") &&
      !path.startsWith(`.obsidian/plugins/${PLUGIN_ID}/`)
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
    const p = normalizePath(path);
    if (p === "README" || p === "README.md") {
      return p;
    }
    const vaultName = this.app.vault.getName();
    const root = this.getSettings().rootPath.trim();
    return normalizePath(
      [vaultName, root, p].filter(Boolean).join("/"),
    );
  }

  localPath(remotePath: string): string | null {
    const p = normalizePath(remotePath);
    if (p === "README" || p === "README.md") {
      return p;
    }
    
    const vaultName = this.app.vault.getName();
    const root = this.getSettings().rootPath.trim();
    const prefix = normalizePath([vaultName, root].filter(Boolean).join("/"));
    
    if (p === prefix) return "";
    return p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : null;
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
    const path = ".obsidiansync-metadata.json";
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
    const path = ".obsidiansync-metadata.json";
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
      id = "obsidiansync-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
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

  async localManifest(): Promise<Manifest> {
    const result: Manifest = {};
    const mapping = await this.getMetadataMapping();
    let needsSave = false;

    // Detect offline renames by matching file hashes
    const currentFiles = this.app.vault.getFiles().filter(f => !this.isIgnored(f.path));
    const missingPaths = Object.keys(mapping).filter(p => !this.app.vault.getAbstractFileByPath(p));
    const untrackedFiles = currentFiles.filter(f => !mapping[f.path]);
    
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

    for (const file of this.app.vault.getFiles()) {
      if (this.isIgnored(file.path)) continue;
      const oldMappingVal = mapping[file.path];
      const { id, bytes } = await this.getFileMetadataOrDefaults(file, mapping);
      if (mapping[file.path] !== oldMappingVal) {
        needsSave = true;
      }
      this.assertSyncableSize(file.path, bytes.byteLength);
      result[file.path] = {
        sha: await gitBlobSha(bytes),
        remoteSha: this.getSyncManifest()[file.path]?.remoteSha ?? null,
        size: bytes.byteLength,
        id,
      };
    }

    if (needsSave) {
      await this.saveMetadataMapping(mapping);
    }

    // Manually add the metadata file to the manifest so it gets synced!
    const metadataPath = ".obsidiansync-metadata.json";
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
      const exist = this.app.vault.getAbstractFileByPath(normalized);
      if (!exist) {
        try {
          await this.app.vault.createFolder(normalized);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (!msg.toLowerCase().includes("already exists")) {
            throw error;
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
    if (existing instanceof TFile)
      await this.app.vault.modifyBinary(existing, bytes);
    else await this.app.vault.createBinary(path, bytes);
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
