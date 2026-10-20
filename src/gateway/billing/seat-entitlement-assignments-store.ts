/**
 * SeatEntitlementAssignment — 席位 → 商业能力档位绑定（P1）。
 *
 * 落盘：`CONFIG_DIR/openbot-seat-entitlement-assignments.json`。
 * 变更追加 AiProfileHistoryInterval，支撑月中升级按时间比例计费。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { AiProfileHistoryInterval } from "./ai-authorization-cost.js";
import {
  defaultSeatEntitlementProfileForRole,
  getSeatEntitlementProfile,
  isSeatEntitlementProfileId,
} from "./seat-entitlement-profiles.js";
import type { SeatEntitlementProfileId, SeatRole } from "./types.js";

const STORE_VERSION = 2;

export type SeatEntitlementAssignment = {
  enterpriseId: string;
  seatId: string;
  profileId: SeatEntitlementProfileId;
  assignedAt: string;
  updatedAt: string;
};

type Store = {
  version: number;
  /** key = `${enterpriseId}::${seatId}` */
  assignments: Record<string, SeatEntitlementAssignment>;
  /** 授权历史区间（append-only；endTime=null 表示仍生效）。 */
  intervals: AiProfileHistoryInterval[];
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, assignments: {}, intervals: [] };
}

export function resolveDefaultSeatEntitlementAssignmentsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-seat-entitlement-assignments.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

function assignmentKey(enterpriseId: string, seatId: string): string {
  return `${tenant(enterpriseId)}::${seatId.trim()}`;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSeatEntitlementAssignmentsStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.assignments !== "object" || parsed.assignments === null) {
    return createEmptyStore();
  }
  const intervals = Array.isArray(parsed.intervals) ? parsed.intervals : [];
  // 旧数据无 intervals：从当前 assignment 合成开放区间，保证历史重放可计费。
  if (intervals.length === 0) {
    for (const a of Object.values(parsed.assignments)) {
      intervals.push({
        id: `profile-iv-legacy-${a.seatId}`,
        seatId: a.seatId,
        enterpriseId: a.enterpriseId,
        profileId: a.profileId,
        startTime: a.assignedAt,
        endTime: null,
      });
    }
  }
  return { version: STORE_VERSION, assignments: parsed.assignments, intervals };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSeatEntitlementAssignmentsStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function getSeatEntitlementAssignment(
  enterpriseId: string,
  seatId: string,
  storePath?: string,
): Promise<SeatEntitlementAssignment | null> {
  const store = await loadStore(storePath);
  return store.assignments[assignmentKey(enterpriseId, seatId)] ?? null;
}

export async function upsertSeatEntitlementAssignment(
  input: {
    enterpriseId: string;
    seatId: string;
    profileId: SeatEntitlementProfileId;
  },
  storePath?: string,
): Promise<SeatEntitlementAssignment> {
  if (!getSeatEntitlementProfile(input.profileId)) {
    throw new Error(`unknown seat entitlement profile: ${input.profileId}`);
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = assignmentKey(input.enterpriseId, input.seatId);
    const now = new Date().toISOString();
    const existing = store.assignments[key];
    const seatId = input.seatId.trim();
    const enterpriseId = tenant(input.enterpriseId);
    if (!existing || existing.profileId !== input.profileId) {
      for (const iv of store.intervals) {
        if (iv.enterpriseId === enterpriseId && iv.seatId === seatId && iv.endTime === null) {
          iv.endTime = now;
        }
      }
      store.intervals.push({
        id: `profile-iv-${randomUUID()}`,
        seatId,
        enterpriseId,
        profileId: input.profileId,
        startTime: now,
        endTime: null,
      });
    }
    const assignment: SeatEntitlementAssignment = {
      enterpriseId,
      seatId,
      profileId: input.profileId,
      assignedAt: existing?.assignedAt ?? now,
      updatedAt: now,
    };
    store.assignments[key] = assignment;
    await saveStore(store, storePath);
    return assignment;
  });
}

export async function assignDefaultSeatEntitlementProfile(
  input: {
    enterpriseId: string;
    seatId: string;
    role: SeatRole;
  },
  storePath?: string,
): Promise<SeatEntitlementAssignment> {
  return upsertSeatEntitlementAssignment(
    {
      enterpriseId: input.enterpriseId,
      seatId: input.seatId,
      profileId: defaultSeatEntitlementProfileForRole(input.role),
    },
    storePath,
  );
}

export async function listSeatEntitlementAssignments(
  enterpriseId: string,
  storePath?: string,
): Promise<SeatEntitlementAssignment[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.assignments).filter((a) => a.enterpriseId === t);
}

/** 列出企业 AI 授权历史区间（含已关闭与开放区间）。 */
export async function listSeatEntitlementProfileIntervals(
  enterpriseId: string,
  storePath?: string,
): Promise<AiProfileHistoryInterval[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.intervals.filter((iv) => iv.enterpriseId === t);
}

export function parseSeatEntitlementProfileId(value: unknown): SeatEntitlementProfileId | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return isSeatEntitlementProfileId(raw) ? raw : null;
}

export async function __resetSeatEntitlementAssignmentsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
