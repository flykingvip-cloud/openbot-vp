/**
 * 模型授权审计（P1，独立于 EnterpriseAssetAuditEventType）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.4）。
 *
 * 轻量 append-only 审计：记录 seat/employee 模型授权与撤销。
 * 落盘 `CONFIG_DIR/openbot-model-grant-audit.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { ModelGrantSubjectType, ModelRef } from "./types.js";

const STORE_VERSION = 1;

export type ModelGrantAuditEventType = "model.granted" | "model.revoked";

export type ModelGrantAuditEvent = {
  id: string;
  seq: number;
  ts: string;
  type: ModelGrantAuditEventType;
  tenantId: string;
  subjectType: ModelGrantSubjectType;
  subjectId: string;
  seatId?: string;
  employeeId?: string;
  modelIds: ModelRef[];
  actorUserId?: string;
};

type Store = {
  version: number;
  nextSeq: number;
  events: ModelGrantAuditEvent[];
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, nextSeq: 1, events: [] };
}

export function resolveDefaultModelGrantAuditStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-model-grant-audit.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultModelGrantAuditStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || !Array.isArray(parsed.events)) {
    return createEmptyStore();
  }
  const events = parsed.events;
  const maxSeq = events.reduce((acc, e) => Math.max(acc, e.seq), 0);
  return {
    version: STORE_VERSION,
    nextSeq: typeof parsed.nextSeq === "number" ? Math.max(parsed.nextSeq, maxSeq + 1) : maxSeq + 1,
    events,
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultModelGrantAuditStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

/** 追加一条授权审计事件（append-only）。 */
export async function recordModelGrantAuditEvent(
  input: {
    type: ModelGrantAuditEventType;
    tenantId: string;
    subjectType: ModelGrantSubjectType;
    subjectId: string;
    seatId?: string;
    employeeId?: string;
    modelIds: ModelRef[];
    actorUserId?: string;
  },
  storePath?: string,
): Promise<ModelGrantAuditEvent> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const event: ModelGrantAuditEvent = {
      id: randomUUID(),
      seq: store.nextSeq,
      ts: new Date().toISOString(),
      type: input.type,
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ...(input.seatId ? { seatId: input.seatId } : {}),
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      modelIds: [...input.modelIds],
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    };
    store.events.push(event);
    store.nextSeq += 1;
    await saveStore(store, storePath);
    return event;
  });
}

export async function listModelGrantAuditEvents(
  storePath?: string,
): Promise<ModelGrantAuditEvent[]> {
  const store = await loadStore(storePath);
  return store.events;
}
