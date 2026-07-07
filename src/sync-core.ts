export interface ManifestEntry {
  sha: string;
  remoteSha: string | null;
  size?: number;
  id?: string;
}

export type Manifest = Record<string, ManifestEntry>;
export type RemoteTree = Record<string, { sha: string; size?: number }>;

export type ConflictKind =
  | "both_modified"
  | "both_added"
  | "local_modified_remote_deleted"
  | "local_deleted_remote_modified";

export type Change =
  | { type: "upload"; path: string }
  | { type: "download"; path: string; remoteSha: string }
  | { type: "downloadConflictCopy"; path: string; remoteSha: string }
  | { type: "deleteLocal"; path: string }
  | { type: "deleteRemote"; path: string }
  | { type: "conflict"; path: string; remoteSha: string | null; kind: ConflictKind };

export function planChanges(
  local: Manifest,
  remote: RemoteTree,
  baseManifest: Manifest,
  isIgnored: (path: string) => boolean = () => false,
): Change[] {
  const changes: Change[] = [];
  const paths = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(baseManifest),
  ]);
  for (const path of [...paths].sort()) {
    if (isIgnored(path)) continue;
    const base = baseManifest[path];
    const localEntry = local[path];
    const remoteEntry = remote[path];
    const baseLocal = base?.sha ?? null;
    const baseRemote = base?.remoteSha ?? null;
    const localSha = localEntry?.sha ?? null;
    const remoteSha = remoteEntry?.sha ?? null;
    const localChanged = localSha !== baseLocal;
    const remoteChanged = remoteSha !== baseRemote;

    if (localSha && remoteSha && localSha === remoteSha) continue;

    if (localSha && remoteSha && !base && localSha !== remoteSha)
      changes.push({ type: "conflict", path, remoteSha, kind: "both_added" });
    else if (localSha && !remoteSha && !base) changes.push({ type: "upload", path });
    else if (!localSha && remoteSha && !base) changes.push({ type: "download", path, remoteSha });
    else if (localChanged && remoteChanged && localSha && remoteSha)
      changes.push({ type: "conflict", path, remoteSha, kind: "both_modified" });
    else if (localChanged && remoteChanged && localSha && !remoteSha)
      changes.push({
        type: "conflict",
        path,
        remoteSha: null,
        kind: "local_modified_remote_deleted",
      });
    else if (localChanged && remoteChanged && !localSha && remoteSha)
      changes.push({ type: "conflict", path, remoteSha, kind: "local_deleted_remote_modified" });
    else if (localChanged && localSha) changes.push({ type: "upload", path });
    else if (localChanged && !localSha) changes.push({ type: "deleteRemote", path });
    else if (remoteChanged && remoteSha) changes.push({ type: "download", path, remoteSha });
    else if (remoteChanged && !remoteSha) changes.push({ type: "deleteLocal", path });
  }
  return changes;
}
