import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import {
  normalizeKnowledgeConsumeRef,
  type KnowledgeConsumeReceiptItem,
  type KnowledgeConsumeRef,
} from "../knowledge/consume-ref.js";
import { isRecord, numberValue, stringValue } from "../records.js";
import type { ContextMode, ContextScopeDeniedSource, ContextSource } from "./types.js";

export type ContextScopeAuditRecord = {
  recordedAtMs: number;
  runId?: string;
  sessionKey: string;
  groupId?: string | null;
  tenantId?: string | null;
  actorUserId?: string | null;
  agentId?: string | null;
  mode: ContextMode;
  confidentialityMaxLevel: "public" | "internal" | "restricted";
  allowedSources: Array<{ type: ContextSource["type"]; id: string; parentId?: string }>;
  deniedSources: ContextScopeDeniedSource[];
  consumeReceipts?: KnowledgeConsumeReceiptItem[];
  budgetMaxTokens: number;
  budgetMaxFiles: number;
  evidenceCount?: number;
  selectedSourceCount?: number;
};

/**
 * Local JSONL projection only. Collaboration Ledger `kind: "context_scope"`
 * is the production source of truth. Do not serve this file from gateway
 * methods or treat it as a second facts ledger.
 */
const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "context-scope-audit.jsonl");
const MAX_LIST = 200;
const MAX_FILE_LINES = 2_000;

function asString(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function asNumber(value: unknown): number | undefined {
  return numberValue(value) ?? undefined;
}

function parseAllowedSource(
  value: unknown,
): { type: ContextSource["type"]; id: string; parentId?: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = asString(value.type) as ContextSource["type"] | undefined;
  const id = asString(value.id);
  if (!type || !id) {
    return null;
  }
  const parentId = asString(value.parentId);
  return { type, id, ...(parentId ? { parentId } : {}) };
}

function parseDeniedSource(value: unknown): ContextScopeDeniedSource | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = asString(value.type) as ContextScopeDeniedSource["type"] | undefined;
  const id = asString(value.id);
  const reason = asString(value.reason);
  if (
    !type ||
    !id ||
    (reason !== "unauthorized" &&
      reason !== "ambiguous_identity" &&
      reason !== "confidentiality" &&
      reason !== "authorize_failed" &&
      reason !== "persist_failed")
  ) {
    return null;
  }
  const parentId = asString(value.parentId);
  return { type, id, ...(parentId ? { parentId } : {}), reason };
}

function parseConsumeReceipt(value: unknown): KnowledgeConsumeReceiptItem | null {
  if (!isRecord(value) || !isRecord(value.ref)) {
    return null;
  }
  const refType = asString(value.ref.type);
  const refId = asString(value.ref.id);
  if (!refType || !refId) {
    return null;
  }
  const parentId = asString(value.ref.parentId);
  const ref = normalizeKnowledgeConsumeRef({
    type: refType,
    id: refId,
    ...(parentId ? { parentId } : {}),
  } as KnowledgeConsumeRef);
  const status = asString(value.status);
  if (
    !ref ||
    (status !== "consumed" &&
      status !== "partial" &&
      status !== "unavailable" &&
      status !== "denied")
  ) {
    return null;
  }
  return { ...(value as KnowledgeConsumeReceiptItem), ref, status };
}

function parseAuditRecord(raw: string): ContextScopeAuditRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const sessionKey = asString(parsed.sessionKey);
  const mode = asString(parsed.mode) as ContextMode | undefined;
  const confidentialityMaxLevel = asString(parsed.confidentialityMaxLevel) as
    | ContextScopeAuditRecord["confidentialityMaxLevel"]
    | undefined;
  const recordedAtMs = asNumber(parsed.recordedAtMs);
  if (!sessionKey || !mode || !confidentialityMaxLevel || recordedAtMs == null) {
    return null;
  }
  const allowedSources = Array.isArray(parsed.allowedSources)
    ? parsed.allowedSources
        .map(parseAllowedSource)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const deniedSources = Array.isArray(parsed.deniedSources)
    ? parsed.deniedSources
        .map(parseDeniedSource)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const consumeReceipts = Array.isArray(parsed.consumeReceipts)
    ? parsed.consumeReceipts
        .map(parseConsumeReceipt)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  return {
    recordedAtMs,
    sessionKey,
    mode,
    confidentialityMaxLevel,
    allowedSources,
    deniedSources,
    ...(consumeReceipts.length > 0 ? { consumeReceipts } : {}),
    budgetMaxTokens: asNumber(parsed.budgetMaxTokens) ?? 0,
    budgetMaxFiles: asNumber(parsed.budgetMaxFiles) ?? 0,
    ...(asString(parsed.runId) ? { runId: asString(parsed.runId) } : {}),
    ...(asString(parsed.groupId) ? { groupId: asString(parsed.groupId) } : {}),
    ...(asString(parsed.tenantId) ? { tenantId: asString(parsed.tenantId) } : {}),
    ...(asString(parsed.actorUserId) ? { actorUserId: asString(parsed.actorUserId) } : {}),
    ...(asString(parsed.agentId) ? { agentId: asString(parsed.agentId) } : {}),
    ...(asNumber(parsed.evidenceCount) != null
      ? { evidenceCount: asNumber(parsed.evidenceCount) }
      : {}),
    ...(asNumber(parsed.selectedSourceCount) != null
      ? { selectedSourceCount: asNumber(parsed.selectedSourceCount) }
      : {}),
  };
}

export function allowedSourcesForAudit(
  sources: ContextSource[],
): ContextScopeAuditRecord["allowedSources"] {
  return sources.map((source) => {
    const parentId =
      source.type === "folder" || source.type === "file" || source.type === "api"
        ? source.parentId
        : undefined;
    const id =
      source.type === "conversation"
        ? source.id
        : source.type === "group"
          ? source.groupId
          : source.type === "knowledge"
            ? source.knowledgeBaseId
            : source.type === "folder"
              ? source.path
              : source.type === "file"
                ? source.fileId
                : source.connectorId;
    return {
      type: source.type,
      id,
      ...(parentId ? { parentId } : {}),
    };
  });
}

export function appendContextScopeAuditRecord(
  record: ContextScopeAuditRecord,
  storePath: string = DEFAULT_STORE_FILE,
): void {
  const payload: ContextScopeAuditRecord = {
    ...record,
    recordedAtMs: record.recordedAtMs || Date.now(),
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.appendFileSync(storePath, `${JSON.stringify(payload)}\n`, "utf8");
  trimAuditFile(storePath);
}

function trimAuditFile(storePath: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  if (lines.length <= MAX_FILE_LINES) {
    return;
  }
  fs.writeFileSync(storePath, `${lines.slice(-MAX_FILE_LINES).join("\n")}\n`, "utf8");
}

export function listContextScopeAuditRecords(params: {
  tenantId: string;
  groupId?: string | null;
  limit?: number;
  storePath?: string;
}): ContextScopeAuditRecord[] {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    return [];
  }
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const groupId = params.groupId?.trim() || undefined;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_LIST);
  const records: ContextScopeAuditRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const record = parseAuditRecord(line);
    if (!record || record.tenantId !== tenantId) {
      continue;
    }
    if (groupId && record.groupId !== groupId) {
      continue;
    }
    records.push(record);
  }
  return records.toReversed().slice(0, limit);
}
