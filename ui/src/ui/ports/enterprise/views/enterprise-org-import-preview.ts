import type { PlatformEmployeeProvisionInput } from "../../../controllers/platform-auth.ts";
import {
  composeOrganizationTeamPath,
  collectOrganizationStructurePrefixPaths,
} from "./enterprise-org-path.ts";
import {
  buildEnterpriseOrgTreeFromProvisionRows,
  type EnterpriseOrgDepartmentNode,
} from "./enterprise-org-tree-model.ts";
import { isOrganizationEmailLikeLabel } from "./enterprise-organization-display-label.ts";

export type OrganizationImportPreviewRow = {
  rowNumber: number;
  employeeName: string;
  employeeEmail: string;
  teamLabel: string;
  seatTitle: string;
  responsibility: string | null;
  status: "valid" | "error";
  errorMessage: string | null;
};

export type OrganizationImportPreview = {
  rows: OrganizationImportPreviewRow[];
  validRows: PlatformEmployeeProvisionInput[];
  tree: EnterpriseOrgDepartmentNode[];
  errorCount: number;
  structureSyncPlan: {
    paths: string[];
    newDepartmentPaths: string[];
  };
};

const ORGANIZATION_IMPORT_COLUMN_ALIASES = {
  employeeName: ["姓名", "成员", "成员姓名", "员工姓名", "负责人", "name", "employeeName"],
  employeeEmail: ["邮箱", "成员邮箱", "员工邮箱", "邮件", "email", "employeeEmail", "mail"],
  teamLabel: ["部门", "团队", "所属团队", "组织", "department", "team", "teamLabel"],
  parentTeamLabel: ["上级部门", "上级团队", "父部门", "parentTeam", "parentDepartment"],
  seatTitle: ["岗位", "岗位名称", "职位", "职务", "position", "seatTitle", "roleTitle"],
  manager: ["直属上级", "上级", "汇报对象", "manager", "reportTo"],
  positionType: ["岗位类型", "类型", "positionType", "roleType"],
  positionLevel: ["岗位等级", "等级", "职级", "level", "positionLevel"],
  region: ["地区", "区域", "region", "area"],
  responsibility: ["岗位职责", "职责", "描述", "responsibility", "description"],
} as const;

type OrganizationImportColumnKey = keyof typeof ORGANIZATION_IMPORT_COLUMN_ALIASES;

function normalizeOrganizationImportHeader(value: string) {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[\s_\-（）()]/g, "")
    .toLowerCase();
}

function resolveOrganizationImportColumn(headers: string[], key: OrganizationImportColumnKey) {
  const candidates = new Set(
    ORGANIZATION_IMPORT_COLUMN_ALIASES[key].map(normalizeOrganizationImportHeader),
  );
  return headers.findIndex((header) => candidates.has(normalizeOrganizationImportHeader(header)));
}

function readOrganizationImportCell(row: string[], index: number) {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

export function buildOrganizationImportPreview(table: string[][]): OrganizationImportPreview {
  const rows = table.filter((row) => row.some((entry) => entry.trim()));
  if (rows.length < 2) {
    throw new Error("组织名录至少需要表头和一条成员记录。");
  }
  const headers = rows[0] ?? [];
  const columnIndex = {
    employeeName: resolveOrganizationImportColumn(headers, "employeeName"),
    employeeEmail: resolveOrganizationImportColumn(headers, "employeeEmail"),
    teamLabel: resolveOrganizationImportColumn(headers, "teamLabel"),
    parentTeamLabel: resolveOrganizationImportColumn(headers, "parentTeamLabel"),
    seatTitle: resolveOrganizationImportColumn(headers, "seatTitle"),
    manager: resolveOrganizationImportColumn(headers, "manager"),
    positionType: resolveOrganizationImportColumn(headers, "positionType"),
    positionLevel: resolveOrganizationImportColumn(headers, "positionLevel"),
    region: resolveOrganizationImportColumn(headers, "region"),
    responsibility: resolveOrganizationImportColumn(headers, "responsibility"),
  };
  const missing = [
    ["姓名", columnIndex.employeeName],
    ["邮箱", columnIndex.employeeEmail],
    ["部门", columnIndex.teamLabel],
    ["岗位", columnIndex.seatTitle],
  ]
    .filter(([, index]) => index === -1)
    .map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(`缺少核心字段：${missing.join("、")}。`);
  }

  const previewRows: OrganizationImportPreviewRow[] = [];
  const validRows: PlatformEmployeeProvisionInput[] = [];
  const seen = new Set<string>();

  for (const [offset, row] of rows.slice(1).entries()) {
    const rowNumber = offset + 2;
    const employeeName = readOrganizationImportCell(row, columnIndex.employeeName);
    const employeeEmail = readOrganizationImportCell(row, columnIndex.employeeEmail).toLowerCase();
    const teamLabelCell = readOrganizationImportCell(row, columnIndex.teamLabel);
    const parentTeamLabel = readOrganizationImportCell(row, columnIndex.parentTeamLabel);
    const teamLabel = composeOrganizationTeamPath({
      teamLabel: teamLabelCell,
      parentTeamLabel,
    });
    const seatTitle = readOrganizationImportCell(row, columnIndex.seatTitle);
    const responsibility = readOrganizationImportCell(row, columnIndex.responsibility);
    const metadataResponsibility = [
      ["直属上级", readOrganizationImportCell(row, columnIndex.manager)],
      ["岗位类型", readOrganizationImportCell(row, columnIndex.positionType)],
      ["岗位等级", readOrganizationImportCell(row, columnIndex.positionLevel)],
      ["地区", readOrganizationImportCell(row, columnIndex.region)],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}：${value}`)
      .join("；");
    const resolvedResponsibility = responsibility || metadataResponsibility || null;

    let errorMessage: string | null = null;
    if (!employeeName || !employeeEmail || !teamLabelCell || !seatTitle) {
      errorMessage = "缺少姓名、邮箱、部门或岗位";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) {
      errorMessage = "邮箱格式不正确";
    } else if (
      isOrganizationEmailLikeLabel(seatTitle) ||
      isOrganizationEmailLikeLabel(employeeName)
    ) {
      errorMessage = "岗位和姓名不能填写邮箱";
    } else {
      const key = `${employeeEmail}:${seatTitle}:${teamLabel}`;
      if (seen.has(key)) {
        errorMessage = "重复记录";
      } else {
        seen.add(key);
        validRows.push({
          employeeName,
          employeeEmail,
          seatTitle,
          teamLabel,
          responsibility: resolvedResponsibility,
        });
      }
    }

    previewRows.push({
      rowNumber,
      employeeName,
      employeeEmail,
      teamLabel,
      seatTitle,
      responsibility: resolvedResponsibility,
      status: errorMessage ? "error" : "valid",
      errorMessage,
    });
  }

  const structurePaths = collectOrganizationStructurePrefixPaths(
    validRows.map((row) => row.teamLabel?.trim() ?? ""),
  );

  return {
    rows: previewRows,
    validRows,
    tree: buildEnterpriseOrgTreeFromProvisionRows(validRows),
    errorCount: previewRows.filter((row) => row.status === "error").length,
    structureSyncPlan: {
      paths: structurePaths,
      newDepartmentPaths: structurePaths,
    },
  };
}

export function organizationImportPreviewToSubmitRows(
  preview: OrganizationImportPreview,
): PlatformEmployeeProvisionInput[] {
  if (preview.errorCount > 0) {
    throw new Error(`仍有 ${preview.errorCount} 行校验未通过，请先修正后再导入。`);
  }
  if (preview.validRows.length === 0) {
    throw new Error("没有可导入的有效组织记录。");
  }
  return preview.validRows;
}
