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

export function matchesOrganizationTeamPath(
  teamLabel: string | null | undefined,
  activeTeam: string,
): boolean {
  if (activeTeam === "all") {
    return true;
  }
  const normalized = teamLabel?.trim() || "未分组";
  if (normalized === activeTeam) {
    return true;
  }
  const activeKey = organizationPathKey(splitOrganizationPath(activeTeam));
  const labelKey = organizationPathKey(splitOrganizationPath(normalized));
  if (!activeKey || activeKey === "未分组") {
    return labelKey === "未分组";
  }
  return labelKey === activeKey || labelKey.startsWith(`${activeKey}/`);
}

export function composeOrganizationTeamPath(params: {
  teamLabel: string;
  parentTeamLabel?: string | null;
}): string {
  const teamLabel = params.teamLabel.trim();
  const parentTeamLabel = params.parentTeamLabel?.trim() ?? "";
  if (!teamLabel) {
    return parentTeamLabel || "未分组";
  }
  if (!parentTeamLabel) {
    return teamLabel;
  }
  if (
    teamLabel.includes("/") ||
    teamLabel.includes(">") ||
    teamLabel.includes("|") ||
    teamLabel.includes("｜")
  ) {
    return teamLabel;
  }
  return `${parentTeamLabel}/${teamLabel}`;
}

/** 判断部门拖放到目标节点时应执行移动（改父级）还是合并（迁入并删除源节点）。 */
export function resolveOrganizationDepartmentDropAction(
  sourcePath: string,
  targetPath: string,
): "move" | "merge" | null {
  const source = sourcePath.trim();
  const target = targetPath.trim();
  if (!source) {
    return null;
  }
  // 拖到「全部组织」根节点：仅提升为顶级部门，不做合并。
  if (!target) {
    return "move";
  }
  if (source === target) {
    return null;
  }
  if (target.startsWith(`${source}/`)) {
    return null;
  }
  const sourceParent = splitOrganizationPath(source).slice(0, -1).join("/");
  const targetParent = splitOrganizationPath(target).slice(0, -1).join("/");
  if (target === sourceParent || sourceParent === targetParent) {
    return "merge";
  }
  return "move";
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
