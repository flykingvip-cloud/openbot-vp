import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/pairing-files.js";
import { CONFIG_DIR } from "../utils.js";
import type { RecordOwnership } from "./scope-attribution.js";

const withLock = createAsyncLock();

function ownershipPath(baseDir = CONFIG_DIR): string {
  return path.join(baseDir, "governance", "node-ownership.json");
}

async function loadOwnership(baseDir?: string): Promise<Record<string, RecordOwnership>> {
  return (await readJsonFile<Record<string, RecordOwnership>>(ownershipPath(baseDir))) ?? {};
}

export async function getManagementNodeOwnership(
  nodeId: string,
  baseDir?: string,
): Promise<RecordOwnership | null> {
  const normalized = nodeId.trim();
  if (!normalized) {
    return null;
  }
  const ownership = (await loadOwnership(baseDir))[normalized];
  return ownership ? { ...ownership } : null;
}

export async function setManagementNodeOwnership(
  nodeId: string,
  ownership: { tenantId: string; ownerId?: string },
  baseDir?: string,
): Promise<void> {
  const normalized = nodeId.trim();
  const tenantId = ownership.tenantId.trim();
  if (!normalized || !tenantId) {
    throw new Error("nodeId and tenantId are required");
  }
  await withLock(async () => {
    const state = await loadOwnership(baseDir);
    state[normalized] = {
      tenantId,
      ...(ownership.ownerId?.trim() ? { ownerId: ownership.ownerId.trim() } : {}),
    };
    await writeJsonAtomic(ownershipPath(baseDir), state);
  });
}
