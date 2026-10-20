/**
 * Per-tenant enterprise control document.
 * Missing file means no policy. Corrupt JSON throws so callers can fail closed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { writeJsonAtomic } from "../../infra/json-files.js";

export const SERVER_ACCESS_CATALOG = ["usage:budget"] as const;
export type ServerAccessPermission = (typeof SERVER_ACCESS_CATALOG)[number];

export const HIGH_RISK_ACCESS_PERMISSIONS = new Set<string>(["usage:budget"]);

export const BUILTIN_ACCESS_ROLE_IDS = ["viewer", "operator", "admin"] as const;

export type AssetControlType = "agent" | "group";

export type AccessRoleRecord = {
  id: string;
  name: string;
  permissionIds: string[];
  revision: string;
};

export type MemberGrantRecord = {
  userId: string;
  permissionIds: string[];
  roleId?: string;
  revision: string;
};

export type AssetBudgetRecord = {
  assetType: "agent";
  assetId: string;
  monthlyLimitCents: number;
};

export type AssetPauseRecord = {
  assetType: AssetControlType;
  assetId: string;
  paused: boolean;
  reason: string;
};

export type TenantControlDocument = {
  version: 1;
  idleTimeoutMinutes?: number;
  ipAllowlist?: string[];
  roles: Record<string, AccessRoleRecord>;
  memberGrants: Record<string, MemberGrantRecord>;
  assetBudgets: Record<string, AssetBudgetRecord>;
  assetPauses: Record<string, AssetPauseRecord>;
};

let rootOverride: string | null = null;
let writeLock: Promise<void> = Promise.resolve();

export function setEnterpriseControlRootForTests(root: string | null): void {
  rootOverride = root;
}

export function enterpriseControlRoot(): string {
  return rootOverride ?? resolveStateDir();
}

export function emptyTenantControls(): TenantControlDocument {
  return {
    version: 1,
    roles: {},
    memberGrants: {},
    assetBudgets: {},
    assetPauses: {},
  };
}

export function safeTenantKey(tenantId: string): string {
  const trimmed = tenantId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) {
    throw new Error("tenant id cannot be used as a control path");
  }
  return trimmed;
}

function controlPath(tenantId: string): string {
  return path.join(
    enterpriseControlRoot(),
    "enterprise-controls",
    `${safeTenantKey(tenantId)}.json`,
  );
}

async function withWriteLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = writeLock;
  let release = () => {};
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function asDocument(value: unknown): TenantControlDocument {
  if (!value || typeof value !== "object") {
    throw new Error("enterprise control document is invalid");
  }
  const record = value as Partial<TenantControlDocument>;
  if (record.version !== 1) {
    throw new Error("enterprise control document is invalid");
  }
  return {
    version: 1,
    ...(typeof record.idleTimeoutMinutes === "number"
      ? { idleTimeoutMinutes: record.idleTimeoutMinutes }
      : {}),
    ...(Array.isArray(record.ipAllowlist) ? { ipAllowlist: record.ipAllowlist.map(String) } : {}),
    roles: record.roles ?? {},
    memberGrants: record.memberGrants ?? {},
    assetBudgets: record.assetBudgets ?? {},
    assetPauses: record.assetPauses ?? {},
  };
}

export async function readTenantControls(tenantId: string): Promise<TenantControlDocument> {
  const filePath = controlPath(tenantId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return asDocument(JSON.parse(raw) as unknown);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return emptyTenantControls();
    }
    throw error;
  }
}

export async function writeTenantControls(
  tenantId: string,
  document: TenantControlDocument,
): Promise<void> {
  await withWriteLock(async () => {
    await writeJsonAtomic(controlPath(tenantId), document, {
      mode: 0o600,
      ensureDirMode: 0o700,
    });
  });
}

export async function updateTenantControls(
  tenantId: string,
  mutate: (document: TenantControlDocument) => void,
): Promise<TenantControlDocument> {
  return withWriteLock(async () => {
    const document = await readTenantControls(tenantId);
    mutate(document);
    await writeJsonAtomic(controlPath(tenantId), document, {
      mode: 0o600,
      ensureDirMode: 0o700,
    });
    return document;
  });
}

export function assetControlKey(assetType: AssetControlType, assetId: string): string {
  return `${assetType}:${assetId}`;
}

export function builtinRolePermissions(roleId: string): string[] | null {
  if (roleId === "viewer" || roleId === "operator") {
    return [];
  }
  if (roleId === "admin") {
    return ["usage:budget"];
  }
  return null;
}
