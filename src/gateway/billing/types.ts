/**
 * Cost & Budget Billing — 双端 SaaS 计费系统的权威类型定义（gateway 端）。
 *
 * 设计参见 `.kiro/specs/cost-budget-billing/design.md`。
 *
 * 约定：
 * - 金额一律用「整数分（cents / minor units）」存储与计算，字段以 `*Cents` 命名，
 *   展示层再除以 100，规避浮点误差（保证「分项和 = 总额」「区间占比和 = 1」）。
 * - 真相来源（Source of Truth）= append-only 事件日志；可变「头记录」是投影缓存；
 *   账单/快照是对事件日志的确定性投影输出。
 * - 所有企业端数据按 `enterpriseId`（= tenantId）隔离。
 * - UI 端在 `ui/src/ui/capability/cost-budget-billing/endpoints.ts` 维持镜像类型。
 */

import type { SeatRole } from "../../shared/seat-role.js";

// ─────────────────────────────────────────────────────────────────────────
// 枚举 / 字面量
// ─────────────────────────────────────────────────────────────────────────

/**
 * 计费周期。月度为基准；季度 / 年度通过周期折扣降低单价（见 `billing-cycle-pricing.ts`）。
 * 账期窗口由 `billing-period.ts` 从订阅合同锚点确定性推导（禁止用「now 自然月」代替合同账期）。
 * 说明：产品语义以 `quarterly` 为准；legacy `semiannual` 输入在运行时归一化到 `quarterly`。
 */
export type BillingCycle = "monthly" | "quarterly" | "annual";

/** 正式结算生命周期。final 账单只允许 finalized；调整走 Adjustment。 */
export type SettlementStatus = "pending" | "running" | "finalized" | "failed" | "estimated";

/** 席位角色。与企业端角色保持一致。定义在 shared，避免套餐矩阵反向依赖 gateway。 */
export type { SeatRole };

/** 定价类型：席位 / 用量 / 超额。 */
export type PricingType = "seat" | "usage" | "extra";

/** 订阅状态。`pending_payment` = 已下单待收款（subscription-commerce）。 */
export type SubscriptionStatus =
  | "pending_payment"
  | "active"
  | "suspended"
  | "expired"
  | "canceled";

/** 成本快照类型：实时估算 / 周期结算最终值。 */
export type SnapshotType = "estimated" | "final";

/** Plan 当前生命周期状态。 */
export type PlanStatus = "active" | "archived";

/** 平台营销标签（展示层，不影响计费）。`default` 全局唯一。 */
export type PlanMarketingTag = "default" | "recommended";

/** 套餐选购匹配画像（运营可配，不参与计费）。 */
export type PlanMatchingProfile = {
  /** 如 team-6-20、creator-heavy；与向导 Persona 标签对齐。 */
  targetPersonas?: string[];
  /** 同分 tie-break，越大越优先。 */
  matchingPriority?: number;
  /** 运营自定义「套餐内扩展」说明（购前/购后详情 Tab）。 */
  inPlanFlexibilityNotes?: string;
  /** 运营自定义「超出边界」说明。 */
  beyondPlanNotes?: string;
};

/** 标准套餐档位（商业展示 / 策略，非计费依据）。 */
export type PlanCommercialSlot =
  | "trial"
  | "starter"
  | "professional"
  | "business"
  | "enterprise"
  | "custom";

/**
 * 企业购买方式（subscription-commerce 元数据，冻结在 PlanVersion.snapshot.commercial）。
 * - self_serve：自助下单
 * - contact_sales：仅销售/平台转单
 * - trial_auto：零元自动开通（不等同于 basePrice=0）
 */
export type PlanPurchaseMode = "self_serve" | "contact_sales" | "trial_auto";

export type PlanCommercialPolicy = {
  slot?: PlanCommercialSlot;
  purchaseMode: PlanPurchaseMode;
};

/**
 * PlanVersion 状态机（R24）。单向不可逆：`draft → active → deprecated`。
 * - draft：草稿，可编辑定价、不可被订阅。
 * - active：生效，唯一可被订阅、定价冻结。
 * - deprecated：终态，不可被新订阅；既有订阅继续按其锁定快照计费。
 */
export type PlanVersionStatus = "draft" | "active" | "deprecated";

// ─────────────────────────────────────────────────────────────────────────
// 平台端实体（价格唯一真相，企业不可写）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 套餐（Plan）= 平台定义的定价模板，企业不可修改。
 * Plan 更新以追加新 PlanVersion 的方式记录，保留历史版本（R1.2 / R11.3）。
 */
export type Plan = {
  id: string;
  name: string;
  billingCycle: BillingCycle;
  basePriceCents: number;
  /** 指向最新 PlanVersion（订阅锁定某一版本以复算历史账单）。 */
  currentVersionId: string;
  /** 各角色席位配额。 */
  seatQuota: Partial<Record<SeatRole, number>>;
  /** Bot 配额。 */
  botQuota: number;
  status: PlanStatus;
  /** 营销展示标签（default 全局唯一，由 setPlanMarketingTags 维护）。 */
  marketingTags?: PlanMarketingTag[];
  /**
   * 套餐毛利目标率（0..1）。供经营仪表盘对比「实际毛利」着色：实际 ≥ 目标 → 健康。
   * 仅运营内部使用，不影响计费；缺省表示未设目标。
   */
  targetMarginRate?: number;
  /**
   * 套餐毛利警戒率（0..1，应 ≤ targetMarginRate）。实际毛利 < 警戒 → 仪表盘红色告警。
   */
  guardMarginRate?: number;
  /**
   * 商业策略（展示/购买路径）。新 PlanVersion 创建时会复制进 snapshot.commercial 冻结。
   * 缺省时 commerce 层可做一次 name 别名推断（仅兼容旧数据）。
   */
  commercial?: PlanCommercialPolicy;
  /** 选购向导匹配画像与扩展说明（Plan 级，随 availablePlans 下发企业端）。 */
  matchingProfile?: PlanMatchingProfile;
  /** 购前 Pricing 展示文案（v3，不参与计费）。 */
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * 套餐版本。`snapshot.pricing` 不可变（一经创建冻结）；`status` 可经合法流转变更，
 * 每次变更记录 PlanVersionStatusChangeEvent（R24 / Property 16/17）。
 * 订阅锁定某一 PlanVersion，保证历史账单可复算（R3.2 / R3.3 / R11.3）。
 */
export type PlanVersion = {
  id: string;
  planId: string;
  /** 单调递增的版本号（= versionNumber，供 UI 展示 v1/v2/v3 与排序）。 */
  version: number;
  /** 状态机：draft → active → deprecated，单向不可逆（R24）。 */
  status: PlanVersionStatus;
  snapshot: {
    basePriceCents: number;
    seatQuota: Partial<Record<SeatRole, number>>;
    botQuota: number;
    pricing: PlanPricing[];
    /**
     * 计量合同（与定价一并冻结）。决定 included 是否收费、单位、配额语义。
     * 缺省时由 `buildMeterDefinitions` 按显式默认策略合成（ai_credits 套餐内免费）。
     */
    meters?: Array<{
      key: string;
      unit: "credit" | "token" | "cent" | "count";
      /** 固定包含量；credits 类可省略，运行时用 entitlement.monthlyCredits 覆盖。 */
      includedQuota?: number;
      /** true=套餐内用量按 usage 单价计费；false=套餐内免费。 */
      chargeIncludedAtUsagePrice: boolean;
      /** 是否允许超额（走 extra 价）。 */
      allowOverage: boolean;
      aggregate?: "sum";
      rounding?: "integer";
    }>;
    /** 商业策略快照（与 basePriceCents 一同锁定，订单报价真源）。 */
    commercial?: PlanCommercialPolicy;
  };
  createdAt: string;
  createdByUserId: string;
  /** 激活时间（时间线/审计，R25.8）。 */
  activatedAt?: string;
  /** 废弃时间（时间线/审计，R25.8）。 */
  deprecatedAt?: string;
};

/**
 * 版本状态变更审计事件（append-only）。记录「状态变化」而非仅「结果」，
 * 支撑审计、重放与并发问题排查（R24.4 / Property 17）。`requestId` 兼作激活幂等键。
 */
export type PlanVersionStatusChangeEvent = {
  id: string;
  planId: string;
  versionId: string;
  fromStatus: PlanVersionStatus | null;
  toStatus: PlanVersionStatus;
  /** 幂等键：同 requestId 重复激活只生效一次（R25.4）。 */
  requestId: string;
  changedByUserId: string;
  occurredAt: string;
};

/**
 * 定价规则（Plan_Pricing）。归属某个 PlanVersion。
 * 示例：`seat/viewer=1000`、`seat/creator=3000`、`usage/ai_token=2`（单位：分）。
 */
export type PlanPricing = {
  id: string;
  planId: string;
  planVersionId: string;
  type: PricingType;
  /** 计量/角色 key：viewer | creator | admin | ai_token | task | ... */
  key: string;
  priceCents: number;
};

/**
 * 两个版本定价差异（后端 `comparePlanVersions` 产出，供平台 UI 展示「改了什么」）。
 * 每项标识一个 `(type,key)` 的新增/删除/调价。
 */
export type PricingDiffEntry = {
  type: PricingType;
  key: string;
  oldPriceCents: number | null; // null = 新增
  newPriceCents: number | null; // null = 删除
  change: "added" | "removed" | "changed" | "unchanged";
};
export type PricingDiff = {
  fromVersionId: string;
  toVersionId: string;
  entries: PricingDiffEntry[];
};

// ─────────────────────────────────────────────────────────────────────────
// 企业端实体（按 enterpriseId 隔离）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 订阅（Subscription）。企业 + 套餐 = 订阅。
 * 仅承载订阅生命周期，不负责 Seat（Seat 由 Seat_Service 独立管理）。
 */
export type Subscription = {
  id: string;
  enterpriseId: string;
  planId: string;
  /** 锁定的定价版本，账单复算依据（R4.1 / R3.3）。 */
  planVersionId: string;
  startTime: string;
  endTime: string | null;
  status: SubscriptionStatus;
  /** UI 便捷路径仅给 planId 时解析为 active 版本，标记供审计（R26.3）。 */
  resolvedFromPlanId?: boolean;
  /** 一次性迁移补绑标记（R27.2）。 */
  migratedBinding?: boolean;
  /** 下一计费周期生效的套餐变更（R17.4）。 */
  pendingChange?: {
    targetPlanId: string;
    targetPlanVersionId: string;
    effectiveAt: string;
  };
  /**
   * 预付合同周期（subscription-commerce）。
   * quarterly/annual 必须有；monthly 可缺省（退化为自然月 proration 窗口）。
   */
  commercialContract?: {
    billingCycle: BillingCycle;
    contractStart: string;
    contractEnd: string;
  };
  createdAt: string;
};

/** 订阅状态变更事件（append-only 历史，R4.7 / R11.2）。 */
export type SubscriptionEvent = {
  id: string;
  enterpriseId: string;
  subscriptionId: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  planVersionId: string;
  occurredAt: string;
};

/**
 * 席位生命周期状态（Phase 3）。
 * - active：计费/授权生效，有开放 seat_history 区间
 * - inactive：暂停，区间已关闭，可 reactivate
 * - removed：软删除，区间已关闭，不可再激活（须重新 assign）
 * 缺省（历史数据）按 active 处理。
 */
export type SeatStatus = "active" | "inactive" | "removed";

/** 席位（Seat）头记录（投影缓存）。 */
export type Seat = {
  id: string;
  enterpriseId: string;
  userId: string;
  currentRole: SeatRole;
  /** 该席位可分配的 Bot 配额（R5.3）。 */
  botQuota: number;
  createdAt: string;
  /** 生命周期；缺省 = active（兼容旧数据）。 */
  status?: SeatStatus;
  updatedAt?: string;
  /**
   * 分配时锁定的订阅 planVersionId（配额/定价真源）。
   * 禁止用 Plan 当前版本漂移校验席位配额。
   */
  planVersionId?: string;
};

/**
 * 席位历史区间（seat_history）。时间区间模型，支持按比例计费 Proration
 * （R5.1 / R5.2 / R10.2 / Property 10）。append-only。
 */
export type SeatHistoryInterval = {
  id: string;
  seatId: string;
  enterpriseId: string;
  role: SeatRole;
  startTime: string;
  /** null = 当前生效区间（结算时按周期末或下一区间起点裁剪）。 */
  endTime: string | null;
};

/** 成本控制开关（R8 / R23）。 */
export type BudgetControls = {
  limitAiCalls: boolean;
  limitBotCreation: boolean;
  autoDowngrade: boolean;
};

/** 预算（Budget）头记录。变更走 append-only 历史（R6.7 / R11）。 */
export type Budget = {
  id: string;
  enterpriseId: string;
  monthlyLimitCents: number;
  /** 提醒阈值 0..1，默认 0.8（R6.2）。 */
  alertThreshold: number;
  controls: BudgetControls;
  updatedAt: string;
};

/** 预算变更事件（append-only 历史，R6.7）。 */
export type BudgetEvent = {
  id: string;
  enterpriseId: string;
  monthlyLimitCents: number;
  alertThreshold: number;
  controls: BudgetControls;
  occurredAt: string;
};

/**
 * 用量记录（Usage_Record）。append-only，按 `(enterpriseId, eventId)` 幂等去重
 * （R9.2 / R9.3 / Property 9）。
 */
export type UsageRecord = {
  id: string;
  enterpriseId: string;
  userId: string;
  /** 幂等键，在 enterpriseId 维度唯一。 */
  eventId: string;
  /** 计量类型：ai_token | task | ... */
  key: string;
  quantity: number;
  occurredAt: string;
  ingestedAt: string;
  /** 执行用量的 Agent / 机器人（可选，用于岗位 × 机器人归因）。 */
  agentId?: string | null;
  /** 组织岗位 seatId（可选，用于岗位级归因）。 */
  orgSeatId?: string | null;
};

/** Bot 可见性（P1：共享 / 模板化前置字段）。 */
export type BotVisibility = "private" | "team" | "enterprise" | "public_template";

/** 商业席位能力档位（P1：与 SeatRole 治理角色分离）。 */
export type SeatEntitlementProfileId = "basic_ai" | "pro_ai" | "elite_ai" | "premier_ai";

/** 超配治理拦截动作。 */
export type OverAllocationBlockedAction =
  | "assign_seat"
  | "create_bot"
  | "duplicate_bot"
  | "upgrade_seat_profile"
  | "run_high_tier";

/** 商业运行时治理状态（与 platform-auth enterprise.status 分离）。 */
export type CommercialGovernanceStatus = "normal" | "over_allocated";

export type OverAllocationState = {
  enterpriseId: string;
  subscriptionSnapshotId: string;
  status: CommercialGovernanceStatus;
  seatsOver: number;
  botsOver: number;
  seatProfilesOver: number;
  privateModelsOver: number;
  workflowsOver: number;
  blockedActions: OverAllocationBlockedAction[];
  detectedAt: string;
  updatedAt: string;
};

export type CreditBucketType = "plan_cycle" | "recharge" | "proration_bonus" | "manual_adjustment";

export type CreditBucket = {
  id: string;
  enterpriseId: string;
  subscriptionSnapshotId?: string;
  cycleStart: string;
  bucketType: CreditBucketType;
  creditsGranted: number;
  creditsConsumed: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Bot 资源（受 Plan 的 Bot 配额约束，R20）。软删保留历史。 */
export type BotResource = {
  id: string;
  enterpriseId: string;
  /** P1 长期真源；历史记录可能缺失。 */
  ownerSeatId?: string;
  ownerUserId: string;
  visibility?: BotVisibility;
  /**
   * 产品侧来源 agentId（数字人 / agents.create）。用于幂等登记与删除同步：
   * 同一企业内同一 agentId 至多一条活跃计费 Bot。直接经 resources.create-bot 创建的记录为空。
   */
  sourceAgentId?: string;
  createdAt: string;
  deletedAt: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// 账单与快照（append-only 账本）
// ─────────────────────────────────────────────────────────────────────────

export type BillItemType = PricingType;

/** 账单明细项。可下钻到用户/区间/数量（R19.2 / R21）。 */
export type BillItem = {
  type: BillItemType;
  /** 角色 / 计量类型。 */
  key: string;
  /** 可解释明细（用户、区间、数量等）。 */
  detail: string;
  amountCents: number;
};

/**
 * 账单（Bill）。某计费周期的结算结果。
 * `totalCostCents = seatCostCents + usageCostCents + extraCostCents`（R10.1 / Property 8）。
 * final 账单不可变；修正必须通过 Adjustment / CreditNote。
 */
export type Bill = {
  id: string;
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  planVersionId: string;
  items: BillItem[];
  seatCostCents: number;
  usageCostCents: number;
  extraCostCents: number;
  totalCostCents: number;
  generatedAt: string;
  /** 订阅 id（结算键组成部分；旧数据可缺省）。 */
  subscriptionId?: string;
  /**
   * 唯一结算键：enterpriseId|subscriptionId|planVersionId|cycleStart|cycleEnd。
   * 同一 key 只允许一张 final Bill。
   */
  settlementKey?: string;
  /** 缺省按 generated 语义：无 status 的历史账单视为已落账 final 快照。 */
  status?: SettlementStatus;
};

/**
 * 成本快照（Cost_Snapshot）。供看板与历史展示。
 * `snapshotType=estimated` 为实时增量估算，`final` 为周期结算后的最终值（R22）。
 */
export type CostSnapshot = {
  id: string;
  enterpriseId: string;
  /** YYYY-MM-DD */
  date: string;
  snapshotType: SnapshotType;
  seatCostCents: number;
  usageCostCents: number;
  totalCostCents: number;
  /** 缺失价格的计量 key（可见，非静默计 0，R9.8 / Property 2）。 */
  missingPriceKeys: string[];
  createdAt: string;
  /** 与 final Bill 对齐的结算键（原子落账后可回读）。 */
  settlementKey?: string;
  /** 关联 Bill.id。 */
  billId?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// 域事件（异步协同契约，R16.3）
// ─────────────────────────────────────────────────────────────────────────

export type UsageReportedEvent = {
  type: "usage.reported";
  enterpriseId: string;
  /** 用量归属用户（镜像 UsageRecord.userId），保证事件日志可按用户归因（R9.1 / R18 / R21）。 */
  userId: string;
  eventId: string;
  key: string;
  quantity: number;
  occurredAt: string;
  /** 执行用量的 Agent / 机器人（可选，用于岗位 × 机器人归因）。 */
  agentId?: string | null;
  /** 组织岗位 seatId（可选，用于岗位级归因）。 */
  orgSeatId?: string | null;
};

export type SeatChangedEvent = {
  type: "seat.changed";
  enterpriseId: string;
  seatId: string;
  fromRole: SeatRole | null;
  toRole: SeatRole;
  effectiveAt: string;
  /** Phase 3：生命周期动作（缺省 = 角色/分配变更）。 */
  action?: "assigned" | "role_changed" | "deactivated" | "removed" | "reactivated";
  fromStatus?: SeatStatus;
  toStatus?: SeatStatus;
};

export type BotChangedEvent = {
  type: "bot.changed";
  enterpriseId: string;
  botId: string;
  ownerUserId: string;
  action: "created" | "deleted";
};

export type SubscriptionChangedEvent = {
  type: "subscription.changed";
  enterpriseId: string;
  subscriptionId: string;
  toStatus: SubscriptionStatus;
  planVersionId: string;
  occurredAt: string;
};

export type BillingDomainEvent =
  | UsageReportedEvent
  | SeatChangedEvent
  | BotChangedEvent
  | SubscriptionChangedEvent;

/** 持久事件日志记录：域事件 + 单调序号 + 投递状态（事件可靠性）。 */
export type DurableEventStatus = "pending" | "done" | "failed";
export type DurableEvent = {
  seq: number;
  status: DurableEventStatus;
  enterpriseId: string;
  event: BillingDomainEvent;
  recordedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────
// 引擎输入/输出辅助类型（纯函数契约，详见 engine.ts）
// ─────────────────────────────────────────────────────────────────────────

/** 预算检查结果级别（R6.5 / R6.6 / Property 3）。 */
export type BudgetCheckLevel = "ok" | "alert" | "exceeded";

/** 价格查询结果：命中价或缺失标记（R2.3 / R2.4 / Property 2）。 */
export type PriceLookup = { priceCents: number } | { missing: true };
