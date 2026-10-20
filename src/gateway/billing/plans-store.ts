/**
 * 平台端套餐 / 定价 store（控制平面）。
 *
 * 版本生命周期（R24/R25）：
 * - `createPlan` 首版本直接 `active`；
 * - `createPlanVersion` / `updatePlan` 创建 `draft` 版本（不隐式激活、不动 currentVersionId）；
 * - `activatePlanVersion` 在 **Plan 级串行锁** 内原子地把原 active 降级 deprecated、目标置 active，
 *   并以 `requestId` 幂等短路（R25.3/25.4）；
 * - `deprecatePlanVersion` 终态化某 active 版本；
 * - 状态流转写 append-only `PlanVersionStatusChangeEvent`（R24.4）；
 * - 仅 draft 态允许编辑 pricing（R24.5/24.6）。
 *
 * 兼容（R27.1）：加载时为缺 `status` 的旧版本归一化（currentVersionId→active，余→deprecated）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-plans.json`。平台全局数据（非租户隔离）。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { appendLedgerRecord } from "./append-only-ledger.js";
import {
  freezeMetersForNewPlanVersion,
  normalizeMeterInput,
  validateMetersAgainstPricing,
  type PersistedMeterDefinition,
} from "./meter-contract.js";
import type {
  BillingCycle,
  Plan,
  PlanCommercialPolicy,
  PlanMarketingTag,
  PlanMatchingProfile,
  PlanPricing,
  PlanStatus,
  PlanVersion,
  PlanVersionStatusChangeEvent,
  PricingType,
  SeatRole,
} from "./types.js";
import { reduceVersionStatuses } from "./version-lifecycle.js";

const PLANS_STORE_VERSION = 1;

type PlansStore = {
  version: number;
  plans: Record<string, Plan>;
  planVersions: PlanVersion[]; // append-only（记录本身不删；status 字段经合法流转更新）
  statusChangeEvents: PlanVersionStatusChangeEvent[]; // append-only 审计
};

function createEmptyStore(): PlansStore {
  return { version: PLANS_STORE_VERSION, plans: {}, planVersions: [], statusChangeEvents: [] };
}

export function resolveDefaultPlansStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-plans.json");
}

const withLock = createAsyncLock();

/** 兼容归一化（R27.1）：旧版本无 status → 匹配 currentVersionId 置 active，余置 deprecated。 */
function normalizeVersionStatuses(store: PlansStore): void {
  for (const v of store.planVersions) {
    if (v.status === undefined) {
      const plan = store.plans[v.planId];
      v.status = plan?.currentVersionId === v.id ? "active" : "deprecated";
    }
  }
}

async function loadStore(storePath?: string): Promise<PlansStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultPlansStorePath());
  const parsed = await readJsonFile<Partial<PlansStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  const store: PlansStore = {
    version: PLANS_STORE_VERSION,
    plans: parsed.plans ?? {},
    planVersions: Array.isArray(parsed.planVersions) ? parsed.planVersions : [],
    statusChangeEvents: Array.isArray(parsed.statusChangeEvents) ? parsed.statusChangeEvents : [],
  };
  normalizeVersionStatuses(store);
  return store;
}

async function saveStore(store: PlansStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultPlansStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function buildPricing(
  planId: string,
  versionId: string,
  pricing: Array<{ type: PricingType; key: string; priceCents: number }>,
): PlanPricing[] {
  return pricing.map((p) => ({
    id: `pp-${randomUUID()}`,
    planId,
    planVersionId: versionId,
    type: p.type,
    key: p.key,
    priceCents: p.priceCents,
  }));
}

export type CreatePlanInput = {
  name: string;
  billingCycle: BillingCycle;
  basePriceCents: number;
  seatQuota: Partial<Record<SeatRole, number>>;
  botQuota: number;
  pricing: Array<{ type: PricingType; key: string; priceCents: number }>;
  /** 显式计量合同；缺省则按 pricing + WELL_KNOWN 兼容生成。 */
  meters?: PersistedMeterDefinition[];
  createdByUserId: string;
  commercial?: PlanCommercialPolicy;
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
};

/** 新 PlanVersion 快照：复制 plan.commercial 或上一版本 snapshot.commercial。 */
function resolveSnapshotCommercial(
  plan: Plan,
  current?: PlanVersion | null,
  override?: PlanCommercialPolicy,
): PlanCommercialPolicy | undefined {
  const source = override ?? current?.snapshot.commercial ?? plan.commercial;
  return source ? { ...source } : undefined;
}

function withSnapshotCommercial<T extends PlanVersion["snapshot"]>(
  snapshot: T,
  commercial: PlanCommercialPolicy | undefined,
): T {
  if (!commercial) {
    return snapshot;
  }
  return { ...snapshot, commercial };
}

/** 创建 Plan + 初始 PlanVersion（version=1，直接 active）。返回 plan。 */
export async function createPlan(input: CreatePlanInput, storePath?: string): Promise<Plan> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const planId = `plan-${randomUUID()}`;
    const versionId = `pv-${randomUUID()}`;
    const pricing = buildPricing(planId, versionId, input.pricing);
    const frozenMeters = resolveMetersForSnapshot({
      explicit: input.meters,
      previous: null,
      versionId,
      planId,
      versionNumber: 1,
      status: "active",
      basePriceCents: input.basePriceCents,
      seatQuota: input.seatQuota,
      botQuota: input.botQuota,
      pricing,
      createdAt: now,
      createdByUserId: input.createdByUserId,
    });
    const version: PlanVersion = {
      id: versionId,
      planId,
      version: 1,
      status: "active",
      snapshot: withSnapshotCommercial(
        {
          basePriceCents: input.basePriceCents,
          seatQuota: input.seatQuota,
          botQuota: input.botQuota,
          pricing,
          meters: frozenMeters,
        },
        input.commercial ? { ...input.commercial } : undefined,
      ),
      createdAt: now,
      createdByUserId: input.createdByUserId,
      activatedAt: now,
    };
    const plan: Plan = {
      id: planId,
      name: input.name,
      billingCycle: input.billingCycle,
      basePriceCents: input.basePriceCents,
      currentVersionId: versionId,
      seatQuota: input.seatQuota,
      botQuota: input.botQuota,
      status: "active",
      ...(input.commercial ? { commercial: { ...input.commercial } } : {}),
      ...(input.slogan ? { slogan: input.slogan } : {}),
      ...(input.targetAudience ? { targetAudience: input.targetAudience } : {}),
      ...(input.marketingFeatures?.length
        ? { marketingFeatures: [...input.marketingFeatures] }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    store.plans[planId] = plan;
    store.planVersions = appendLedgerRecord(store.planVersions, version);
    store.statusChangeEvents = appendLedgerRecord(store.statusChangeEvents, {
      id: `pvsc-${randomUUID()}`,
      planId,
      versionId,
      fromStatus: null,
      toStatus: "active",
      requestId: `create-${planId}`,
      changedByUserId: input.createdByUserId,
      occurredAt: now,
    });
    await saveStore(store, storePath);
    return plan;
  });
}

function nextVersionNumber(store: PlansStore, planId: string): number {
  const max = store.planVersions
    .filter((v) => v.planId === planId)
    .reduce((acc, v) => Math.max(acc, v.version), 0);
  return max + 1;
}

export type CreatePlanVersionInput = {
  planId: string;
  pricing: Array<{ type: PricingType; key: string; priceCents: number }>;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  /** 显式 meters；缺省则继承/按 pricing 重建 */
  meters?: PersistedMeterDefinition[];
  createdByUserId: string;
  commercial?: PlanCommercialPolicy;
};

function resolveMetersForSnapshot(args: {
  explicit?: PersistedMeterDefinition[] | null;
  previous?: PersistedMeterDefinition[] | null;
  versionId: string;
  planId: string;
  versionNumber: number;
  status: PlanVersion["status"];
  basePriceCents: number;
  seatQuota: Partial<Record<SeatRole, number>>;
  botQuota: number;
  pricing: PlanPricing[];
  createdAt: string;
  createdByUserId: string;
}): PersistedMeterDefinition[] {
  let meters: PersistedMeterDefinition[];
  if (args.explicit && args.explicit.length > 0) {
    meters = normalizeMeterInput(args.explicit);
  } else {
    const skeleton: PlanVersion = {
      id: args.versionId,
      planId: args.planId,
      version: args.versionNumber,
      status: args.status,
      snapshot: {
        basePriceCents: args.basePriceCents,
        seatQuota: args.seatQuota,
        botQuota: args.botQuota,
        pricing: args.pricing,
      },
      createdAt: args.createdAt,
      createdByUserId: args.createdByUserId,
    };
    meters = freezeMetersForNewPlanVersion({
      version: skeleton,
      previousMeters: args.previous,
    });
  }
  validateMetersAgainstPricing(meters, args.pricing);
  return meters;
}

/** 创建一个 draft 版本（不激活、不动 currentVersionId）。返回该版本。 */
export async function createPlanVersion(
  input: CreatePlanVersionInput,
  storePath?: string,
): Promise<PlanVersion | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const plan = store.plans[input.planId];
    if (!plan) {
      return null;
    }
    const now = new Date().toISOString();
    const versionId = `pv-${randomUUID()}`;
    const current = store.planVersions.find((v) => v.id === plan.currentVersionId);
    const basePriceCents =
      input.basePriceCents ?? current?.snapshot.basePriceCents ?? plan.basePriceCents;
    const seatQuota = input.seatQuota ?? current?.snapshot.seatQuota ?? plan.seatQuota;
    const botQuota = input.botQuota ?? current?.snapshot.botQuota ?? plan.botQuota;
    const pricing = buildPricing(input.planId, versionId, input.pricing);
    const verNum = nextVersionNumber(store, input.planId);
    const meters = resolveMetersForSnapshot({
      explicit: input.meters,
      previous: current?.snapshot.meters,
      versionId,
      planId: input.planId,
      versionNumber: verNum,
      status: "draft",
      basePriceCents,
      seatQuota,
      botQuota,
      pricing,
      createdAt: now,
      createdByUserId: input.createdByUserId,
    });
    const version: PlanVersion = {
      id: versionId,
      planId: input.planId,
      version: verNum,
      status: "draft",
      snapshot: withSnapshotCommercial(
        {
          basePriceCents,
          seatQuota,
          botQuota,
          pricing,
          meters,
        },
        resolveSnapshotCommercial(plan, current, input.commercial),
      ),
      createdAt: now,
      createdByUserId: input.createdByUserId,
    };
    store.planVersions = appendLedgerRecord(store.planVersions, version);
    await saveStore(store, storePath);
    return version;
  });
}

export type UpdatePlanInput = {
  planId: string;
  name?: string;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing?: Array<{ type: PricingType; key: string; priceCents: number }>;
  meters?: PersistedMeterDefinition[];
  status?: PlanStatus;
  commercial?: PlanCommercialPolicy;
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
  createdByUserId: string;
};

/**
 * 更新 Plan：定价/配额变更以**创建 draft 版本**承载（不再隐式激活，R24）；
 * 仅 plan 头的 name/status 即时更新。返回 { plan, version(draft) }。
 */
export async function updatePlan(
  input: UpdatePlanInput,
  storePath?: string,
): Promise<{ plan: Plan; version: PlanVersion } | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.plans[input.planId];
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const current = store.planVersions.find((v) => v.id === existing.currentVersionId);
    const versionId = `pv-${randomUUID()}`;
    const basePriceCents =
      input.basePriceCents ?? current?.snapshot.basePriceCents ?? existing.basePriceCents;
    const seatQuota = input.seatQuota ?? current?.snapshot.seatQuota ?? existing.seatQuota;
    const botQuota = input.botQuota ?? current?.snapshot.botQuota ?? existing.botQuota;
    const pricingSource =
      input.pricing ??
      (current?.snapshot.pricing ?? []).map((p) => ({
        type: p.type,
        key: p.key,
        priceCents: p.priceCents,
      }));
    const pricing = buildPricing(input.planId, versionId, pricingSource);
    const verNum = nextVersionNumber(store, input.planId);
    const meters = resolveMetersForSnapshot({
      explicit: input.meters,
      previous: current?.snapshot.meters,
      versionId,
      planId: input.planId,
      versionNumber: verNum,
      status: "draft",
      basePriceCents,
      seatQuota,
      botQuota,
      pricing,
      createdAt: now,
      createdByUserId: input.createdByUserId,
    });
    const version: PlanVersion = {
      id: versionId,
      planId: input.planId,
      version: verNum,
      status: "draft",
      snapshot: withSnapshotCommercial(
        {
          basePriceCents,
          seatQuota,
          botQuota,
          pricing,
          meters,
        },
        resolveSnapshotCommercial(existing, current, input.commercial),
      ),
      createdAt: now,
      createdByUserId: input.createdByUserId,
    };
    // 仅 plan 头的非定价字段即时更新；basePrice/quota 以版本快照为准（激活后由 currentVersionId 反映）。
    const plan: Plan = {
      ...existing,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      ...(input.commercial ? { commercial: { ...input.commercial } } : {}),
      updatedAt: now,
    };
    if (input.slogan !== undefined) {
      if (input.slogan.trim()) {
        plan.slogan = input.slogan.trim();
      } else {
        delete plan.slogan;
      }
    }
    if (input.targetAudience !== undefined) {
      if (input.targetAudience.trim()) {
        plan.targetAudience = input.targetAudience.trim();
      } else {
        delete plan.targetAudience;
      }
    }
    if (input.marketingFeatures !== undefined) {
      const features = input.marketingFeatures.map((f) => f.trim()).filter((f) => f.length > 0);
      if (features.length > 0) {
        plan.marketingFeatures = features;
      } else {
        delete plan.marketingFeatures;
      }
    }
    store.plans[input.planId] = plan;
    store.planVersions = appendLedgerRecord(store.planVersions, version);
    await saveStore(store, storePath);
    return { plan, version };
  });
}

/**
 * 激活某 draft 版本（R25）：Plan 级串行锁内原子地把原 active 降级 deprecated、目标置 active。
 * `requestId` 幂等：若已存在同 requestId 的状态变更事件，短路返回当前版本。
 */
export async function activatePlanVersion(
  params: { planId: string; versionId: string; requestId: string; changedByUserId: string },
  storePath?: string,
): Promise<{ planVersion: PlanVersion } | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const plan = store.plans[params.planId];
    if (!plan) {
      return null;
    }
    const target = store.planVersions.find(
      (v) => v.id === params.versionId && v.planId === params.planId,
    );
    if (!target) {
      return null;
    }
    // 幂等短路：同 requestId 已处理 → 返回当前目标版本状态。
    const dup = store.statusChangeEvents.find((e) => e.requestId === params.requestId);
    if (dup) {
      return { planVersion: target };
    }
    const now = new Date().toISOString();
    const { versions, transitions } = reduceVersionStatuses(
      store.planVersions,
      { kind: "activate", versionId: params.versionId },
      now,
    );
    store.planVersions = versions;
    // append-only 审计：每个流转一条事件。
    for (const tr of transitions) {
      store.statusChangeEvents = appendLedgerRecord(store.statusChangeEvents, {
        id: `pvsc-${randomUUID()}`,
        planId: params.planId,
        versionId: tr.versionId,
        fromStatus: tr.from,
        toStatus: tr.to,
        requestId: params.requestId,
        changedByUserId: params.changedByUserId,
        occurredAt: now,
      });
    }
    store.plans[params.planId] = { ...plan, currentVersionId: params.versionId, updatedAt: now };
    await saveStore(store, storePath);
    const activated = store.planVersions.find((v) => v.id === params.versionId)!;
    return { planVersion: activated };
  });
}

/** 废弃某 active 版本（终态化）。 */
export async function deprecatePlanVersion(
  params: { planId: string; versionId: string; changedByUserId: string },
  storePath?: string,
): Promise<{ planVersion: PlanVersion } | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const plan = store.plans[params.planId];
    const target = store.planVersions.find(
      (v) => v.id === params.versionId && v.planId === params.planId,
    );
    if (!plan || !target) {
      return null;
    }
    const now = new Date().toISOString();
    const { versions, transitions } = reduceVersionStatuses(
      store.planVersions,
      { kind: "deprecate", versionId: params.versionId },
      now,
    );
    store.planVersions = versions;
    for (const tr of transitions) {
      store.statusChangeEvents = appendLedgerRecord(store.statusChangeEvents, {
        id: `pvsc-${randomUUID()}`,
        planId: params.planId,
        versionId: tr.versionId,
        fromStatus: tr.from,
        toStatus: tr.to,
        requestId: `deprecate-${randomUUID()}`,
        changedByUserId: params.changedByUserId,
        occurredAt: now,
      });
    }
    await saveStore(store, storePath);
    const deprecated = store.planVersions.find((v) => v.id === params.versionId)!;
    return { planVersion: deprecated };
  });
}

export async function listPlans(storePath?: string): Promise<Plan[]> {
  const store = await loadStore(storePath);
  return Object.values(store.plans).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type DeletePlanVersionResult =
  | { ok: true; deletedVersionId: string }
  | {
      ok: false;
      reason: "plan-not-found" | "version-not-found" | "active-forbidden" | "current-forbidden";
    };

/**
 * 删除某 draft / deprecated 版本（清理冗余历史）。
 *
 * 守卫：active 版本不可删；plan.currentVersionId 指向的版本不可删（即便已 deprecated）。
 * 订阅引用守卫由 handler 层负责。仅删除"未生效且未被引用"的版本，不影响订阅锁定的
 * 历史快照与账单复算；statusChangeEvents 审计事件保留不动。
 */
export async function deletePlanVersion(
  params: { planId: string; versionId: string },
  storePath?: string,
): Promise<DeletePlanVersionResult> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const plan = store.plans[params.planId];
    if (!plan) {
      return { ok: false, reason: "plan-not-found" };
    }
    const target = store.planVersions.find(
      (v) => v.id === params.versionId && v.planId === params.planId,
    );
    if (!target) {
      return { ok: false, reason: "version-not-found" };
    }
    if (target.status === "active") {
      return { ok: false, reason: "active-forbidden" };
    }
    if (plan.currentVersionId === params.versionId) {
      return { ok: false, reason: "current-forbidden" };
    }
    store.planVersions = store.planVersions.filter((v) => v.id !== params.versionId);
    await saveStore(store, storePath);
    return { ok: true, deletedVersionId: params.versionId };
  });
}

export async function getPlan(planId: string, storePath?: string): Promise<Plan | null> {
  const store = await loadStore(storePath);
  return store.plans[planId] ?? null;
}

/** 列出某 Plan 的全部版本（按版本号升序）。 */
export async function listPlanVersions(planId: string, storePath?: string): Promise<PlanVersion[]> {
  const store = await loadStore(storePath);
  return store.planVersions
    .filter((v) => v.planId === planId)
    .toSorted((a, b) => a.version - b.version);
}

/** 列出某 Plan 的版本状态变更审计事件（按时间升序）。 */
export async function listPlanVersionStatusEvents(
  planId: string,
  storePath?: string,
): Promise<PlanVersionStatusChangeEvent[]> {
  const store = await loadStore(storePath);
  return store.statusChangeEvents
    .filter((e) => e.planId === planId)
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** 平台活动流：最近版本状态变更（全 Plan，按时间降序）。 */
export async function listRecentPlanVersionStatusEvents(
  limit = 20,
  storePath?: string,
): Promise<PlanVersionStatusChangeEvent[]> {
  const store = await loadStore(storePath);
  return store.statusChangeEvents
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, Math.max(1, limit));
}

export async function getPlanVersion(
  planVersionId: string,
  storePath?: string,
): Promise<PlanVersion | null> {
  const store = await loadStore(storePath);
  return store.planVersions.find((v) => v.id === planVersionId) ?? null;
}

/** 取 Plan 当前生效（status=active）版本；回退到 currentVersionId。 */
export async function getCurrentPlanVersion(
  planId: string,
  storePath?: string,
): Promise<PlanVersion | null> {
  const store = await loadStore(storePath);
  const plan = store.plans[planId];
  if (!plan) {
    return null;
  }
  const active = store.planVersions.find((v) => v.planId === planId && v.status === "active");
  if (active) {
    return active;
  }
  return store.planVersions.find((v) => v.id === plan.currentVersionId) ?? null;
}

const VALID_MARKETING_TAGS: Set<PlanMarketingTag> = new Set(["default", "recommended"]);

/**
 * 设置套餐营销标签。`default` 全局唯一：设置时会从其他套餐清除。
 */
const MAX_PERSONA_TAG_LEN = 64;
const MAX_MATCHING_NOTES_LEN = 2000;
const MAX_TARGET_PERSONAS = 20;

function sanitizeMatchingProfile(profile: PlanMatchingProfile): PlanMatchingProfile | null {
  const targetPersonas = (profile.targetPersonas ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= MAX_PERSONA_TAG_LEN)
    .slice(0, MAX_TARGET_PERSONAS);
  const matchingPriority =
    typeof profile.matchingPriority === "number" && Number.isFinite(profile.matchingPriority)
      ? Math.min(100, Math.max(0, Math.round(profile.matchingPriority)))
      : undefined;
  const inPlanFlexibilityNotes = profile.inPlanFlexibilityNotes
    ?.trim()
    .slice(0, MAX_MATCHING_NOTES_LEN);
  const beyondPlanNotes = profile.beyondPlanNotes?.trim().slice(0, MAX_MATCHING_NOTES_LEN);
  const next: PlanMatchingProfile = {};
  if (targetPersonas.length > 0) {
    next.targetPersonas = [...new Set(targetPersonas)];
  }
  if (matchingPriority != null) {
    next.matchingPriority = matchingPriority;
  }
  if (inPlanFlexibilityNotes) {
    next.inPlanFlexibilityNotes = inPlanFlexibilityNotes;
  }
  if (beyondPlanNotes) {
    next.beyondPlanNotes = beyondPlanNotes;
  }
  return Object.keys(next).length > 0 ? next : null;
}

export async function setPlanMarginThresholds(
  planId: string,
  thresholds: { targetMarginRate?: number; guardMarginRate?: number },
  storePath?: string,
): Promise<Plan | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.plans[planId];
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const plan: Plan = { ...existing, updatedAt: now };
    if (thresholds.targetMarginRate != null && Number.isFinite(thresholds.targetMarginRate)) {
      plan.targetMarginRate = Math.min(1, Math.max(0, thresholds.targetMarginRate));
    } else {
      delete plan.targetMarginRate;
    }
    if (thresholds.guardMarginRate != null && Number.isFinite(thresholds.guardMarginRate)) {
      plan.guardMarginRate = Math.min(1, Math.max(0, thresholds.guardMarginRate));
    } else {
      delete plan.guardMarginRate;
    }
    store.plans[planId] = plan;
    await saveStore(store, storePath);
    return plan;
  });
}

export async function setPlanMatchingProfile(
  planId: string,
  matchingProfile: PlanMatchingProfile,
  storePath?: string,
): Promise<Plan | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.plans[planId];
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const sanitized = sanitizeMatchingProfile(matchingProfile);
    const plan: Plan = { ...existing, updatedAt: now };
    if (sanitized) {
      plan.matchingProfile = sanitized;
    } else {
      delete plan.matchingProfile;
    }
    store.plans[planId] = plan;
    await saveStore(store, storePath);
    return plan;
  });
}

export async function setPlanMarketingTags(
  planId: string,
  marketingTags: PlanMarketingTag[],
  storePath?: string,
): Promise<Plan | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.plans[planId];
    if (!existing) {
      return null;
    }
    const unique = [...new Set(marketingTags.filter((tag) => VALID_MARKETING_TAGS.has(tag)))];
    const now = new Date().toISOString();
    if (unique.includes("default")) {
      for (const plan of Object.values(store.plans)) {
        if (plan.id === planId || !plan.marketingTags?.includes("default")) {
          continue;
        }
        const nextTags = plan.marketingTags.filter((tag) => tag !== "default");
        if (nextTags.length > 0) {
          plan.marketingTags = nextTags;
        } else {
          delete plan.marketingTags;
        }
        plan.updatedAt = now;
      }
    }
    const plan: Plan = { ...existing, updatedAt: now };
    if (unique.length > 0) {
      plan.marketingTags = unique;
    } else {
      delete plan.marketingTags;
    }
    store.plans[planId] = plan;
    await saveStore(store, storePath);
    return plan;
  });
}

export async function __resetPlansForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
