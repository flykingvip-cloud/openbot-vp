/**
 * Layer-2 store for non-localFolder passive connectors (git / cloudDrive / mail).
 * localFolder keeps its dedicated store; this store is the shared P5 path.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import type {
  PassiveConnectorBinding,
  PassiveConnectorBindingStatus,
  PassiveConnectorDeletePolicy,
  PassiveConnectorKind,
} from "./passive-connector-types.js";

type StoreFile = {
  bindings: Record<string, PassiveConnectorBinding>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "passive-connector-bindings.json");

export function defaultPassiveConnectorBindingStorePath(): string {
  return DEFAULT_STORE_FILE;
}

function readStore(storePath: string): StoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { bindings: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const bindings =
      typeof record.bindings === "object" &&
      record.bindings !== null &&
      !Array.isArray(record.bindings)
        ? (record.bindings as Record<string, PassiveConnectorBinding>)
        : {};
    return { bindings };
  } catch {
    return { bindings: {} };
  }
}

function writeStore(store: StoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function buildPassiveConnectorBindingId(params: {
  knowledgeBaseId: string;
  kind: PassiveConnectorKind;
  locator: string;
  deviceId?: string;
}): string {
  const key = `${params.knowledgeBaseId}::${params.kind}::${params.deviceId ?? ""}::${params.locator.trim()}`;
  return `pcb:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function upsertPassiveConnectorBinding(
  params: {
    bindingId?: string;
    sourceDescriptorId: string;
    knowledgeBaseId: string;
    kind: PassiveConnectorKind;
    label: string;
    locator: string;
    deviceId?: string;
    deletePolicy?: PassiveConnectorDeletePolicy;
    config?: Record<string, string>;
    status?: PassiveConnectorBindingStatus;
    lastSyncAt?: number;
    lastEventAt?: number;
    lastError?: string | null;
  },
  storePath: string = DEFAULT_STORE_FILE,
): PassiveConnectorBinding {
  if (params.kind === "localFolder") {
    throw new Error("localFolder uses knowledge.local-folder.* binding store");
  }
  const locator = params.locator.trim();
  if (!locator) {
    throw new Error("locator required");
  }
  const label = params.label.trim() || locator;
  const bindingId =
    params.bindingId?.trim() ||
    buildPassiveConnectorBindingId({
      knowledgeBaseId: params.knowledgeBaseId,
      kind: params.kind,
      locator,
      deviceId: params.deviceId,
    });
  const store = readStore(storePath);
  const existing = store.bindings[bindingId];
  const now = Date.now();
  const binding: PassiveConnectorBinding = {
    bindingId,
    sourceDescriptorId: params.sourceDescriptorId,
    knowledgeBaseId: params.knowledgeBaseId,
    kind: params.kind,
    label,
    locator,
    deviceId: params.deviceId?.trim() || existing?.deviceId,
    deletePolicy: params.deletePolicy ?? existing?.deletePolicy ?? "snapshot",
    config: params.config ?? existing?.config ?? {},
    status: params.status ?? existing?.status ?? "not_ready",
    lastSyncAt: params.lastSyncAt ?? existing?.lastSyncAt,
    lastEventAt: params.lastEventAt ?? existing?.lastEventAt,
    lastError: params.lastError === null ? undefined : (params.lastError ?? existing?.lastError),
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
  };
  store.bindings[bindingId] = binding;
  writeStore(store, storePath);
  return binding;
}

export function getPassiveConnectorBinding(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
): PassiveConnectorBinding | null {
  return readStore(storePath).bindings[bindingId.trim()] ?? null;
}

export function findPassiveConnectorBinding(params: {
  bindingId?: string;
  sourceDescriptorId?: string;
  knowledgeBaseId?: string;
  kind?: PassiveConnectorKind;
  storePath?: string;
}): PassiveConnectorBinding | null {
  const store = readStore(params.storePath ?? DEFAULT_STORE_FILE);
  if (params.bindingId?.trim()) {
    return store.bindings[params.bindingId.trim()] ?? null;
  }
  const all = Object.values(store.bindings);
  return (
    all.find((item) => {
      if (params.sourceDescriptorId && item.sourceDescriptorId !== params.sourceDescriptorId) {
        return false;
      }
      if (params.knowledgeBaseId && item.knowledgeBaseId !== params.knowledgeBaseId) {
        return false;
      }
      if (params.kind && item.kind !== params.kind) {
        return false;
      }
      return Boolean(params.sourceDescriptorId || params.knowledgeBaseId || params.kind);
    }) ?? null
  );
}

export function listPassiveConnectorBindings(
  filter: {
    knowledgeBaseId?: string;
    kind?: PassiveConnectorKind;
    sourceDescriptorId?: string;
  } = {},
  storePath: string = DEFAULT_STORE_FILE,
): PassiveConnectorBinding[] {
  return Object.values(readStore(storePath).bindings)
    .filter((item) =>
      filter.knowledgeBaseId ? item.knowledgeBaseId === filter.knowledgeBaseId : true,
    )
    .filter((item) => (filter.kind ? item.kind === filter.kind : true))
    .filter((item) =>
      filter.sourceDescriptorId ? item.sourceDescriptorId === filter.sourceDescriptorId : true,
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function updatePassiveConnectorBindingStatus(
  bindingId: string,
  patch: {
    status?: PassiveConnectorBindingStatus;
    lastSyncAt?: number;
    lastEventAt?: number;
    lastError?: string | null;
  },
  storePath: string = DEFAULT_STORE_FILE,
): PassiveConnectorBinding | null {
  const store = readStore(storePath);
  const existing = store.bindings[bindingId.trim()];
  if (!existing) {
    return null;
  }
  const next: PassiveConnectorBinding = {
    ...existing,
    status: patch.status ?? existing.status,
    lastSyncAt: patch.lastSyncAt ?? existing.lastSyncAt,
    lastEventAt: patch.lastEventAt ?? existing.lastEventAt,
    lastError: patch.lastError === null ? undefined : (patch.lastError ?? existing.lastError),
    updatedAtMs: Date.now(),
  };
  store.bindings[bindingId.trim()] = next;
  writeStore(store, storePath);
  return next;
}

export function deletePassiveConnectorBinding(
  bindingId: string,
  storePath: string = DEFAULT_STORE_FILE,
): boolean {
  const store = readStore(storePath);
  if (!store.bindings[bindingId.trim()]) {
    return false;
  }
  delete store.bindings[bindingId.trim()];
  writeStore(store, storePath);
  return true;
}

export function newPassiveConnectorBindingId(): string {
  return `pcb:${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
