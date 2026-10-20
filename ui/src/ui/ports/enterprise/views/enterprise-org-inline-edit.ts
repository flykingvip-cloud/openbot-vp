import { splitOrganizationPath } from "./enterprise-org-path.ts";

export type OrganizationTreeInlineEditState = {
  kind: "department" | "position";
  departmentPath?: string;
  seatId?: string;
  draft: string;
  original: string;
};

export function createOrganizationTreeInlineEditState(): OrganizationTreeInlineEditState | null {
  return null;
}

function lastOrganizationPathSegment(path: string): string {
  const parts = splitOrganizationPath(path);
  return parts.at(-1) ?? path;
}

function siblingDepartmentLabels(parentPath: string, departmentPaths: string[]): string[] {
  const parentKey = parentPath.trim();
  const parentDepth = parentKey ? splitOrganizationPath(parentKey).length : 0;
  return departmentPaths
    .filter((path) => {
      if (path === "未分组") {
        return false;
      }
      const parts = splitOrganizationPath(path);
      if (parentKey) {
        if (!path.startsWith(`${parentKey}/`)) {
          return false;
        }
        return parts.length === parentDepth + 1;
      }
      return parts.length === 1;
    })
    .map((path) => lastOrganizationPathSegment(path));
}

export function uniqueDefaultDepartmentLabel(
  parentPath: string,
  departmentPaths: string[],
  baseLabel = "新部门",
): string {
  const siblings = siblingDepartmentLabels(parentPath, departmentPaths);
  if (!siblings.includes(baseLabel)) {
    return baseLabel;
  }
  let sequence = 2;
  while (siblings.includes(`${baseLabel} (${sequence})`)) {
    sequence += 1;
  }
  return `${baseLabel} (${sequence})`;
}

export function uniqueDefaultPositionTitle(seatTitles: string[], baseTitle = "新岗位"): string {
  const siblings = new Set(
    seatTitles.map((title) => title.trim()).filter((title) => title.length > 0),
  );
  if (!siblings.has(baseTitle)) {
    return baseTitle;
  }
  let sequence = 2;
  while (siblings.has(`${baseTitle} (${sequence})`)) {
    sequence += 1;
  }
  return `${baseTitle} (${sequence})`;
}

export function focusOrganizationTreeInlineInput() {
  if (typeof document === "undefined") {
    return;
  }
  queueMicrotask(() => {
    const rail = document.querySelector(".enterprise-org-layout__rail .enterprise-org-tree");
    const input = rail?.querySelector<HTMLInputElement>(".enterprise-org-tree__inline-input");
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  });
}
