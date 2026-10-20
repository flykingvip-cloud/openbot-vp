import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type GovernanceRecoveryReceipt = {
  operationId: string;
  stage: string;
  reason: string;
  error?: string;
  agentId?: string;
  resourceIds?: string[];
  haltCompensation: boolean;
  createdAt: string;
};

/** Safe receipt token: no path separators, no `..`, bounded charset. */
const SAFE_RECEIPT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeRecoveryReceiptToken(
  value: string,
  label: "operationId" | "stage",
): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    !SAFE_RECEIPT_TOKEN.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`invalid_recovery_${label}`);
  }
  return trimmed;
}

/** Durable recovery_required breadcrumb under stateDir/data-governance/recovery/. */
export function resolveGovernanceRecoveryRoot(stateDir?: string): string {
  return path.join(path.resolve(stateDir ?? resolveStateDir()), "data-governance", "recovery");
}

function resolveReceiptFilePath(params: {
  operationId: string;
  stage: string;
  stateDir?: string;
}): string {
  const operationId = assertSafeRecoveryReceiptToken(params.operationId, "operationId");
  const stage = assertSafeRecoveryReceiptToken(params.stage, "stage");
  const root = path.resolve(resolveGovernanceRecoveryRoot(params.stateDir));
  const dest = path.resolve(root, `${operationId}-${stage}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_recovery_path");
  }
  return dest;
}

export function writeGovernanceRecoveryReceipt(params: {
  operationId: string;
  stage: string;
  reason: string;
  error?: string;
  agentId?: string;
  resourceIds?: string[];
  haltCompensation: boolean;
  stateDir?: string;
}): string {
  const root = resolveGovernanceRecoveryRoot(params.stateDir);
  fs.mkdirSync(root, { recursive: true });
  const dest = resolveReceiptFilePath(params);
  const receipt: GovernanceRecoveryReceipt = {
    operationId: assertSafeRecoveryReceiptToken(params.operationId, "operationId"),
    stage: assertSafeRecoveryReceiptToken(params.stage, "stage"),
    reason: params.reason,
    error: params.error,
    agentId: params.agentId,
    resourceIds: params.resourceIds,
    haltCompensation: params.haltCompensation,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(dest, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return dest;
}

export function readGovernanceRecoveryReceipt(params: {
  operationId: string;
  stage: string;
  stateDir?: string;
}): GovernanceRecoveryReceipt | null {
  // Throws on unsafe tokens / path escape — callers must treat as invalid request.
  const dest = resolveReceiptFilePath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(dest, "utf8")) as GovernanceRecoveryReceipt;
  } catch {
    return null;
  }
}

export type ListedRecoveryReceipt = {
  fileName: string;
  path: string;
  receipt: GovernanceRecoveryReceipt;
};

/** List recovery receipts (newest createdAt first). Machine-checkable A3 surface. */
export function listGovernanceRecoveryReceipts(params?: {
  stateDir?: string;
  operationId?: string;
  limit?: number;
}): ListedRecoveryReceipt[] {
  const root = path.resolve(resolveGovernanceRecoveryRoot(params?.stateDir));
  if (!fs.existsSync(root)) {
    return [];
  }
  const operationId = params?.operationId
    ? assertSafeRecoveryReceiptToken(params.operationId, "operationId")
    : undefined;
  const limit = params?.limit ?? 200;
  const out: ListedRecoveryReceipt[] = [];
  for (const fileName of fs.readdirSync(root)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      continue;
    }
    if (operationId && !fileName.startsWith(`${operationId}-`)) {
      continue;
    }
    const full = path.resolve(root, fileName);
    const rel = path.relative(root, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    try {
      const receipt = JSON.parse(fs.readFileSync(full, "utf8")) as GovernanceRecoveryReceipt;
      out.push({ fileName, path: full, receipt });
    } catch {
      // skip corrupt
    }
  }
  out.sort((a, b) => b.receipt.createdAt.localeCompare(a.receipt.createdAt));
  return out.slice(0, limit);
}
