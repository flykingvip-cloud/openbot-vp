import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import { backfillSourceBindingVisibilities } from "../knowledge-source-binding-visibility-backfill.js";
import {
  type KnowledgeSourceKind,
  type KnowledgeSourceVisibility,
  resolveSourcePlane,
  type SourceDescriptor,
} from "./source-descriptor.js";

/**
 * Declarative registry of knowledge-source bindings (knowledge space ↔ source). This
 * store ONLY records descriptors; it never ingests/chunk-indexes anything, so binding
 * an active (api/external) source registers it for the capability runtime without
 * crossing the consumption boundary.
 */

type SourceBindingStore = {
  bindings: Record<string, SourceDescriptor>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "source-bindings.json");

function readStore(storePath: string): SourceBindingStore {
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
        ? (record.bindings as Record<string, SourceDescriptor>)
        : {};
    return { bindings };
  } catch {
    return { bindings: {} };
  }
}

function writeStore(store: SourceBindingStore, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** Stable id so re-binding the same source/space updates one record (idempotent). */
function sourceBindingId(params: {
  knowledgeBaseId?: string;
  kind: KnowledgeSourceKind;
  endpoint?: string;
  title: string;
}): string {
  const key = `${params.knowledgeBaseId ?? ""}::${params.kind}::${params.endpoint?.trim() || params.title.trim()}`;
  return `src:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function bindKnowledgeSource(
  params: {
    kind: KnowledgeSourceKind;
    title: string;
    knowledgeBaseId?: string;
    ownerId?: string;
    visibility?: KnowledgeSourceVisibility;
    endpoint?: string;
    metadata?: Record<string, string>;
  },
  storePath: string = DEFAULT_STORE_FILE,
): SourceDescriptor {
  const id = sourceBindingId({
    knowledgeBaseId: params.knowledgeBaseId,
    kind: params.kind,
    endpoint: params.endpoint,
    title: params.title,
  });
  const store = readStore(storePath);
  const existing = store.bindings[id];
  const descriptor: SourceDescriptor = {
    id,
    kind: params.kind,
    plane: resolveSourcePlane(params.kind),
    title: params.title.trim() || params.endpoint?.trim() || id,
    knowledgeBaseId: params.knowledgeBaseId,
    ownerId: params.ownerId,
    visibility: params.visibility,
    freshness: "unknown",
    endpoint: params.endpoint?.trim() || undefined,
    metadata: params.metadata,
    createdAtMs: existing?.createdAtMs ?? Date.now(),
  };
  store.bindings[id] = descriptor;
  writeStore(store, storePath);
  return descriptor;
}

export function listKnowledgeSourceBindings(
  filter: { knowledgeBaseId?: string; ownerId?: string } = {},
  storePath: string = DEFAULT_STORE_FILE,
): SourceDescriptor[] {
  const store = readStore(storePath);
  const backfilled = backfillSourceBindingVisibilities({ bindings: store.bindings });
  if (backfilled.result.updated > 0) {
    writeStore({ bindings: backfilled.bindings }, storePath);
  }
  const all = Object.values(backfilled.bindings);
  return all
    .filter((item) =>
      filter.knowledgeBaseId ? item.knowledgeBaseId === filter.knowledgeBaseId : true,
    )
    .filter((item) => (filter.ownerId ? item.ownerId === filter.ownerId : true))
    .toSorted((left, right) => right.createdAtMs - left.createdAtMs);
}

export function backfillSourceBindingVisibilityStore(
  storePath: string = DEFAULT_STORE_FILE,
  kbStorePath?: string,
) {
  const store = readStore(storePath);
  const backfilled = backfillSourceBindingVisibilities({
    bindings: store.bindings,
    kbStorePath,
  });
  if (backfilled.result.updated > 0) {
    writeStore({ bindings: backfilled.bindings }, storePath);
  }
  return backfilled.result;
}

export function unbindKnowledgeSource(id: string, storePath: string = DEFAULT_STORE_FILE): boolean {
  const store = readStore(storePath);
  if (!store.bindings[id.trim()]) {
    return false;
  }
  delete store.bindings[id.trim()];
  writeStore(store, storePath);
  return true;
}

/** Merge string metadata onto an existing binding (e.g. lastIngestedAt / documentId). */
export function patchKnowledgeSourceBindingMetadata(
  id: string,
  metadata: Record<string, string>,
  storePath: string = DEFAULT_STORE_FILE,
): SourceDescriptor | null {
  const store = readStore(storePath);
  const existing = store.bindings[id.trim()];
  if (!existing) {
    return null;
  }
  const next: SourceDescriptor = {
    ...existing,
    metadata: {
      ...existing.metadata,
      ...metadata,
    },
  };
  store.bindings[id.trim()] = next;
  writeStore(store, storePath);
  return next;
}
