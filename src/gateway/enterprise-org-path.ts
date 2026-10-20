export function splitOrganizationPath(teamLabel: string | null | undefined): string[] {
  const normalized = teamLabel?.trim();
  if (!normalized) {
    return ["未分组"];
  }
  return normalized
    .split(/[/>＞｜|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function organizationPathKey(parts: string[]): string {
  return parts.join("/");
}

export function resolveOrganizationFullPath(parts: string[]): string {
  if (!parts.length) {
    return "未分组";
  }
  return organizationPathKey(parts);
}

export function remapOrganizationTeamLabel(params: {
  teamLabel: string | null | undefined;
  oldPrefix: string;
  newPrefix: string;
}): string | null {
  const normalized = params.teamLabel?.trim();
  if (!normalized) {
    return null;
  }
  const oldPrefix = params.oldPrefix.trim();
  const newPrefix = params.newPrefix.trim();
  if (!oldPrefix) {
    return normalized;
  }
  if (normalized === oldPrefix) {
    return newPrefix || normalized;
  }
  if (normalized.startsWith(`${oldPrefix}/`)) {
    const suffix = normalized.slice(oldPrefix.length + 1);
    return newPrefix ? `${newPrefix}/${suffix}` : suffix;
  }
  return normalized;
}

export function collectOrganizationStructurePrefixPaths(paths: string[]): string[] {
  const collected = new Set<string>();
  for (const rawPath of paths) {
    const parts = splitOrganizationPath(rawPath);
    if (parts.length === 1 && parts[0] === "未分组") {
      continue;
    }
    for (let index = 0; index < parts.length; index += 1) {
      collected.add(resolveOrganizationFullPath(parts.slice(0, index + 1)));
    }
  }
  return [...collected].toSorted((left, right) => left.localeCompare(right, "zh-CN"));
}
