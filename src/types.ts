
export interface Settings {
  token: string;
  deviceFlowClientId: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  authorName: string;
  authorEmail: string;
  autoSync: boolean;
  syncOnStartup: boolean;
  syncOnFileChange: boolean;
  intervalMinutes: number;
  syncObsidianConfig: boolean;
  syncCommunityPlugins: boolean;
  ignorePatterns: string;
}

export interface VersionEntry {
  sha: string;
  message: string;
  date: string;
}

export interface SyncLogEntry {
  startedAt: string;
  endedAt: string;
  reason: string;
  status: "success" | "error";
  changes: number;
  uploads: number;
  downloads: number;
  deletes: number;
  conflicts: number;
  commitSha?: string;
  error?: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type ConflictResolution = "local" | "remote" | "both";

export const DEFAULT_SETTINGS: Settings = {
  token: "",
  deviceFlowClientId: process.env.DEVICE_FLOW_CLIENT_ID || "",
  owner: "",
  repo: "obsidian-sync",
  branch: "main",
  rootPath: "",
  authorName: "SuperSync",
  authorEmail: "supersync@marban.lol",
  autoSync: true,
  syncOnStartup: true,
  syncOnFileChange: true,
  intervalMinutes: 5,
  syncObsidianConfig: true,
  syncCommunityPlugins: false,
  ignorePatterns: "",
};
