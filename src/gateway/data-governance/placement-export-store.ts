/**
 * Durable P4-d placement export receipts. Unique by replayId.
 * Not a promotion store and not a P5 longevity bundle.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolvePlacementExportRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type { PlacementExportReceipt, StorageBinding } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

type ExportFileShape = {
  schemaVersion: 1;
  revision: number;
  receipts: Record<string, PlacementExportReceipt>;
  images: Record<string, StorageBinding[]>;
};

function sleep(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

function withExclusiveLockSync(lockPath: string, fn: () => void): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // raced unlock
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("placement_export_lock_timeout");
}

function storePathFor(stateDir: string): string {
  return path.join(resolvePlacementExportRoot(stateDir), "exports.json");
}

function emptyFile(): ExportFileShape {
  return { schemaVersion: 1, revision: 0, receipts: {}, images: {} };
}

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, storePath);
}

export function parsePlacementExportReceipt(value: unknown): PlacementExportReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "p4_placement_export_receipt") {
    return null;
  }
  for (const key of [
    "receiptId",
    "replayId",
    "grantId",
    "resourceId",
    "agentAssetId",
    "tenantId",
    "fromBindingId",
    "toCanonicalBindingId",
    "contentVersion",
    "checksum",
    "bindingsChecksum",
    "createdAt",
    "updatedAt",
  ] as const) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") {
      return null;
    }
  }
  if (
    raw.canonicalHome !== "local" &&
    raw.canonicalHome !== "managed_encrypted_cloud" &&
    raw.canonicalHome !== "tenant_managed_cloud" &&
    raw.canonicalHome !== "dedicated_regional" &&
    raw.canonicalHome !== "byos" &&
    raw.canonicalHome !== "cold_archive"
  ) {
    return null;
  }
  if (
    raw.mode !== "local-only" &&
    raw.mode !== "encrypted-cloud" &&
    raw.mode !== "tenant-cloud" &&
    raw.mode !== "dedicated" &&
    raw.mode !== "byos" &&
    raw.mode !== "cold-archive"
  ) {
    return null;
  }
  if (raw.state !== "prepared" && raw.state !== "applied" && raw.state !== "failed") {
    return null;
  }
  if (raw.projectionBindingId !== null && typeof raw.projectionBindingId !== "string") {
    return null;
  }
  if (typeof raw.projectionBindingId === "string" && raw.projectionBindingId.trim() === "") {
    return null;
  }
  return {
    kind: "p4_placement_export_receipt",
    receiptId: raw.receiptId as string,
    replayId: raw.replayId as string,
    grantId: raw.grantId as string,
    resourceId: raw.resourceId as string,
    agentAssetId: raw.agentAssetId as string,
    tenantId: raw.tenantId as string,
    fromBindingId: raw.fromBindingId as string,
    toCanonicalBindingId: raw.toCanonicalBindingId as string,
    projectionBindingId:
      typeof raw.projectionBindingId === "string" ? raw.projectionBindingId : null,
    canonicalHome: raw.canonicalHome,
    mode: raw.mode,
    contentVersion: raw.contentVersion as string,
    checksum: raw.checksum as string,
    bindingsChecksum: raw.bindingsChecksum as string,
    state: raw.state,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function readFile(storePath: string): ExportFileShape {
  if (!fs.existsSync(storePath)) {
    return emptyFile();
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as ExportFileShape;
  if (
    parsed?.schemaVersion !== 1 ||
    !parsed.receipts ||
    typeof parsed.receipts !== "object" ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("placement_export_store_corrupt");
  }
  return {
    ...parsed,
    images:
      parsed.images && typeof parsed.images === "object" && !Array.isArray(parsed.images)
        ? parsed.images
        : {},
  };
}

export function getPlacementExportReceipt(params: {
  replayId: string;
  stateDir?: string;
}): PlacementExportReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  try {
    return parsePlacementExportReceipt(readFile(storePathFor(stateDir)).receipts[replayId]);
  } catch {
    return null;
  }
}

export function getPlacementExportImage(params: {
  replayId: string;
  stateDir?: string;
}): StorageBinding[] | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  try {
    const image = readFile(storePathFor(stateDir)).images[replayId];
    return Array.isArray(image) && image.length > 0 ? image : null;
  } catch {
    return null;
  }
}

export function uniqueCreatePlacementExportReceipt(params: {
  receipt: PlacementExportReceipt;
  bindings: readonly StorageBinding[];
  stateDir?: string;
}): { ok: true; receipt: PlacementExportReceipt; created: boolean } | { ok: false } {
  const parsed = parsePlacementExportReceipt(params.receipt);
  if (!parsed || parsed.state !== "prepared" || params.bindings.length === 0) {
    return { ok: false };
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  let created = false;
  let result: PlacementExportReceipt | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const file = readFile(storePath);
    const existing = parsePlacementExportReceipt(file.receipts[parsed.replayId]);
    if (existing) {
      result = existing;
      return;
    }
    writeFileDurable(storePath, {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [parsed.replayId]: parsed },
      images: { ...file.images, [parsed.replayId]: [...params.bindings] },
    });
    created = true;
    result = parsed;
  });
  return result ? { ok: true, receipt: result, created } : { ok: false };
}

export function finalizePlacementExportReceipt(params: {
  replayId: string;
  state: "applied" | "failed";
  stateDir?: string;
}): PlacementExportReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  let result: PlacementExportReceipt | null = null;
  withExclusiveLockSync(`${storePath}.lock`, () => {
    const file = readFile(storePath);
    const existing = parsePlacementExportReceipt(file.receipts[replayId]);
    if (!existing) {
      return;
    }
    if (existing.state === "applied" && params.state === "applied") {
      result = existing;
      return;
    }
    if (existing.state !== "prepared") {
      result = existing;
      return;
    }
    const next: PlacementExportReceipt = {
      ...existing,
      state: params.state,
      updatedAt: new Date().toISOString(),
    };
    if (!parsePlacementExportReceipt(next)) {
      throw new Error("placement_export_invalid_final_receipt");
    }
    writeFileDurable(storePath, {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [replayId]: next },
      images: file.images,
    });
    result = next;
  });
  return result;
}
