function normalizePathLikeObsidian(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function cleanRemoteRootSegment(segment: string): string {
  return segment
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function cleanRemoteRootPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map(cleanRemoteRootSegment)
    .filter(Boolean)
    .join("/");
}

export function remoteBasePrefix(vaultName: string, rootPath: string): string {
  return normalizePathLikeObsidian(
    [cleanRemoteRootSegment(vaultName), cleanRemoteRootPath(rootPath)]
      .filter(Boolean)
      .join("/"),
  );
}

export function remotePath(vaultName: string, rootPath: string, path: string): string {
  const p = normalizePathLikeObsidian(path);
  if (p === "README" || p === "README.md") return p;
  return normalizePathLikeObsidian(
    [remoteBasePrefix(vaultName, rootPath), p].filter(Boolean).join("/"),
  );
}

export function localPath(
  vaultName: string,
  rootPath: string,
  path: string,
  prefixOverride?: string,
): string | null {
  const p = normalizePathLikeObsidian(path);
  if (p === "README" || p === "README.md") return p;

  const prefix = prefixOverride ?? remoteBasePrefix(vaultName, rootPath);
  const pLower = p.toLowerCase();
  const prefixLower = prefix.toLowerCase();

  if (pLower === prefixLower) return "";
  return pLower.startsWith(`${prefixLower}/`) ? p.slice(prefix.length + 1) : null;
}

export function detectRemotePrefix(
  vaultName: string,
  rootPath: string,
  remotePaths: string[],
): string {
  const expectedPrefix = remoteBasePrefix(vaultName, rootPath);
  const expectedLower = expectedPrefix.toLowerCase();
  const candidates = new Set<string>();

  for (const rp of remotePaths) {
    const firstSlash = rp.indexOf("/");
    if (firstSlash === -1) continue;
    candidates.add(rp.slice(0, firstSlash));
  }

  if (remotePaths.some((rp) => rp.startsWith(`${expectedPrefix}/`) || rp === expectedPrefix))
    return expectedPrefix;

  for (const rp of remotePaths) {
    const rpLower = rp.toLowerCase();
    if (rpLower.startsWith(`${expectedLower}/`) || rpLower === expectedLower)
      return rp.slice(0, expectedPrefix.length);
  }

  const vaultLower = vaultName.trim().toLowerCase();
  for (const candidate of candidates) {
    if (candidate.trim().toLowerCase() === vaultLower) {
      const root = rootPath.trim();
      return normalizePathLikeObsidian([candidate.trim(), root].filter(Boolean).join("/"));
    }
  }

  return expectedPrefix;
}
