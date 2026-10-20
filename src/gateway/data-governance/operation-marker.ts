import fs from "node:fs";
import path from "node:path";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";

export const GOV_OP_DIR_MARKER = ".openbot-gov-op.json";
export const GOV_OP_FILE_MARKER_SUFFIX = ".openbot-gov-op.json";
export const GOV_LOGICAL_OP_DIR = "governance-ops";

export type GovernanceOpMarker = {
  operationId: string;
  kind: "directory" | "file";
  createdAt: string;
};

export type GovernanceLogicalOpMarker = {
  operationId: string;
  kind: "logical";
  resourceId: string;
  resourceType: string;
  locator: string;
  objectKey: string;
  createdAt: string;
};

function resolveGovernanceLogicalOpMarkerPath(
  stateDir: string,
  operationId: string,
): string | null {
  try {
    const safeOperationId = assertSafeRecoveryReceiptToken(operationId.trim(), "operationId");
    const root = path.join(path.resolve(stateDir), GOV_LOGICAL_OP_DIR);
    const dest = path.resolve(root, `${safeOperationId}.json`);
    const rel = path.relative(root, dest);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return null;
    }
    return dest;
  } catch {
    return null;
  }
}

function markerPathFor(targetPath: string, kind: "directory" | "file"): string {
  const resolved = path.resolve(targetPath);
  return kind === "directory"
    ? path.join(resolved, GOV_OP_DIR_MARKER)
    : `${resolved}${GOV_OP_FILE_MARKER_SUFFIX}`;
}

export function writeGovernanceOpMarker(params: {
  targetPath: string;
  operationId: string;
  kind: "directory" | "file";
}): void {
  const markerPath = markerPathFor(params.targetPath, params.kind);
  if (params.kind === "directory") {
    fs.mkdirSync(path.resolve(params.targetPath), { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(path.resolve(params.targetPath)), { recursive: true });
  }
  const payload: GovernanceOpMarker = {
    operationId: params.operationId,
    kind: params.kind,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Marker for shared-aggregate logical creates. Never authorizes file quarantine of the shared locator.
 */
export function writeGovernanceLogicalOpMarker(params: {
  stateDir: string;
  operationId: string;
  resourceId: string;
  resourceType: string;
  locator: string;
  objectKey: string;
}): string {
  const markerPath = resolveGovernanceLogicalOpMarkerPath(params.stateDir, params.operationId);
  if (!markerPath) {
    throw new Error("invalid_logical_operation_id");
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const payload: GovernanceLogicalOpMarker = {
    operationId: assertSafeRecoveryReceiptToken(params.operationId.trim(), "operationId"),
    kind: "logical",
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    locator: path.resolve(params.locator),
    objectKey: params.objectKey,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return markerPath;
}

export function readGovernanceOpMarker(params: {
  targetPath: string;
  kind: "directory" | "file";
}): GovernanceOpMarker | null {
  const markerPath = markerPathFor(params.targetPath, params.kind);
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as GovernanceOpMarker;
    if (
      !parsed ||
      typeof parsed.operationId !== "string" ||
      !parsed.operationId.trim() ||
      (parsed.kind !== "directory" && parsed.kind !== "file")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True only when a marker exists and operationId matches. */
export function verifyGovernanceOpMarker(params: {
  targetPath: string;
  operationId: string;
  kind: "directory" | "file";
}): boolean {
  const marker = readGovernanceOpMarker(params);
  return Boolean(
    marker && marker.operationId === params.operationId && marker.kind === params.kind,
  );
}

export function readGovernanceLogicalOpMarker(params: {
  stateDir: string;
  operationId: string;
}): GovernanceLogicalOpMarker | null {
  const markerPath = resolveGovernanceLogicalOpMarkerPath(params.stateDir, params.operationId);
  if (!markerPath || !fs.existsSync(markerPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as GovernanceLogicalOpMarker;
    if (
      !parsed ||
      parsed.kind !== "logical" ||
      typeof parsed.operationId !== "string" ||
      !parsed.operationId.trim() ||
      parsed.operationId !==
        assertSafeRecoveryReceiptToken(params.operationId.trim(), "operationId")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** List logical operation markers whose operationId belongs to an M2 batch. */
export function listGovernanceLogicalOpMarkersForBatch(params: {
  stateDir: string;
  batchId: string;
}): GovernanceLogicalOpMarker[] {
  const batchId = params.batchId.trim();
  if (!batchId) {
    return [];
  }
  const prefix = `m2-${batchId}-`;
  const dir = path.join(path.resolve(params.stateDir), GOV_LOGICAL_OP_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const markers: GovernanceLogicalOpMarker[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const operationId = file.slice(0, -".json".length);
    if (!operationId.startsWith(prefix)) {
      continue;
    }
    try {
      assertSafeRecoveryReceiptToken(operationId, "operationId");
    } catch {
      continue;
    }
    const marker = readGovernanceLogicalOpMarker({ stateDir: params.stateDir, operationId });
    if (marker) {
      markers.push(marker);
    }
  }
  return markers;
}
