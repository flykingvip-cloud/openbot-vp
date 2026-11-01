/**
 * 三端用量与费用的唯一汇总。
 * 读现有请求行 / 任务汇总，不写账本，不改计费规则。
 * 采购成本与商业差额只留在 platform 视图里。
 */

import {
  type UsageChargeLine,
  type UsageCostBucket,
  type UsageCostExcludedRank,
  type UsageCostLayerView,
  type UsageCostLifecycle,
  type UsageCostModelRow,
  type UsageCostRankRow,
  type UsageCostSurface,
  type UsageCostTaskNode,
  type UsageTokenTally,
  EMPTY_TOKEN_TALLY,
  formatChargeLine,
  formatTokenTally,
} from "../../shared/usage-cost-layer.js";
import { computeMarginCents } from "../cost-version/provider-cost.js";

export type UsageRequestRole = "request" | "task_rollup";

export type UsageRequestStatus = "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export type UsageRequestAttempt = "primary" | "retry" | "fallback";

export type UsageSettlementFact =
  | { kind: "credits"; credits: number; final: boolean }
  | { kind: "quota"; credits: number; final: boolean }
  | { kind: "invoice"; currency: string; amountCents: number; final: boolean }
  | { kind: "byok_estimate"; currency: string; amountCents: number; basis: string }
  | { kind: "pending"; credits: number | null }
  | { kind: "unknown" };

export type UsageRequestFact = {
  requestId: string;
  taskId: string;
  parentTaskId: string | null;
  role: UsageRequestRole;
  revision: number;
  occurredAt: string;
  enterpriseId: string;
  userId: string | null;
  assistantId: string | null;
  provider: string | null;
  model: string | null;
  /** 平台分析用。用户 / 企业视图不返回。 */
  purpose: string | null;
  taskType: string | null;
  status: UsageRequestStatus;
  attempt: UsageRequestAttempt;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number | null;
  acceptance: "passed" | "failed" | "pending" | null;
  anomaly: boolean;
  settlement: UsageSettlementFact;
  /** 与结算金额同时存在的 Credits。结算本身已是 Credits 时留空，避免加两次。 */
  recordedCredits?: number | null;
  /** null 表示价格缺失，不是 0 成本。 */
  procurementCents: number | null;
  /** 缺省时：金额为 null 视为缺失，0 视为已确认的零成本，不视为免费模型。 */
  procurementPrice?: "known" | "free" | "missing";
  procurementCurrency: string | null;
  /** 客户侧结算收入（分）。未知为 null。只在平台侧参与差额。 */
  revenueCents: number | null;
};

export type UsageCostActor = {
  surface: UsageCostSurface;
  userId: string | null;
  enterpriseId: string | null;
  /** 企业管理员看本企业；成员只看自己。 */
  enterpriseWide: boolean;
};

export type UsageCostPresentOptions = {
  taskId?: string | null;
  budgetLevel?: "ok" | "alert" | "exceeded" | null;
  truncated?: boolean;
};

const EMPTY_TALLY = (): UsageTokenTally => ({ ...EMPTY_TOKEN_TALLY });

function measuredToken(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return value === null ? null : null;
  }
  return Math.floor(value);
}

function addToken(tally: UsageTokenTally, value: number | null): UsageTokenTally {
  const measured = measuredToken(value);
  if (measured === null) {
    return {
      known: tally.known,
      unknownCount: tally.unknownCount + 1,
      complete: false,
    };
  }
  return {
    known: tally.known + measured,
    unknownCount: tally.unknownCount,
    complete: tally.complete,
  };
}

type ChargeAcc = {
  creditsFinal: number;
  sawCreditsFinal: boolean;
  creditsPending: number;
  creditsPendingKnown: boolean;
  quota: number;
  invoice: Map<string, { final: number; pending: number }>;
  estimate: Map<string, { amount: number; basis: string }>;
  unknown: boolean;
};

function emptyCharges(): ChargeAcc {
  return {
    creditsFinal: 0,
    sawCreditsFinal: false,
    creditsPending: 0,
    creditsPendingKnown: false,
    quota: 0,
    invoice: new Map(),
    estimate: new Map(),
    unknown: false,
  };
}

function addSettlement(acc: ChargeAcc, settlement: UsageSettlementFact): void {
  if (settlement.kind === "credits") {
    if (settlement.final) {
      acc.creditsFinal += settlement.credits;
      acc.sawCreditsFinal = true;
    } else {
      acc.creditsPending += settlement.credits;
      acc.creditsPendingKnown = true;
    }
    return;
  }
  if (settlement.kind === "quota") {
    acc.quota += settlement.credits;
    return;
  }
  if (settlement.kind === "invoice") {
    const bucket = acc.invoice.get(settlement.currency) ?? { final: 0, pending: 0 };
    if (settlement.final) {
      bucket.final += settlement.amountCents;
    } else {
      bucket.pending += settlement.amountCents;
    }
    acc.invoice.set(settlement.currency, bucket);
    return;
  }
  if (settlement.kind === "byok_estimate") {
    const bucket = acc.estimate.get(settlement.currency) ?? {
      amount: 0,
      basis: settlement.basis,
    };
    bucket.amount += settlement.amountCents;
    acc.estimate.set(settlement.currency, bucket);
    return;
  }
  if (settlement.kind === "pending") {
    if (settlement.credits !== null) {
      acc.creditsPending += settlement.credits;
      acc.creditsPendingKnown = true;
    }
    return;
  }
  acc.unknown = true;
}

function linesFromCharges(acc: ChargeAcc): UsageChargeLine[] {
  const lines: UsageChargeLine[] = [];
  if (acc.sawCreditsFinal) {
    lines.push(charge("credits", null, null, acc.creditsFinal, true, null));
  }
  if (acc.quota > 0) {
    lines.push(charge("quota", null, null, acc.quota, true, "套餐包含额度"));
  }
  if (acc.creditsPendingKnown) {
    lines.push(charge("pending", null, null, acc.creditsPending, false, null));
  }
  for (const [currency, bucket] of [...acc.invoice.entries()].toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (bucket.final > 0) {
      lines.push(charge("invoice", currency, bucket.final, null, true, "现有结算规则"));
    }
    if (bucket.pending > 0) {
      lines.push(charge("invoice", currency, bucket.pending, null, false, "现有结算规则"));
    }
  }
  for (const [currency, bucket] of [...acc.estimate.entries()].toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(charge("estimate", currency, bucket.amount, null, false, bucket.basis));
  }
  if (acc.unknown && lines.length === 0) {
    lines.push(charge("pending", null, null, null, false, null));
  }
  return lines;
}

function charge(
  kind: UsageChargeLine["kind"],
  currency: string | null,
  amountCents: number | null,
  credits: number | null,
  final: boolean,
  basis: string | null,
): UsageChargeLine {
  const line: UsageChargeLine = { kind, currency, amountCents, credits, final, basis, label: "" };
  line.label = formatChargeLine(line);
  return line;
}

function dedupeFacts(facts: readonly UsageRequestFact[]): {
  facts: UsageRequestFact[];
  droppedRevisions: number;
} {
  const best = new Map<string, UsageRequestFact>();
  let droppedRevisions = 0;
  for (const fact of facts) {
    const key = fact.requestId.trim();
    const current = best.get(key);
    if (!current) {
      best.set(key, fact);
      continue;
    }
    droppedRevisions += 1;
    const newer =
      fact.revision > current.revision ||
      (fact.revision === current.revision && fact.occurredAt >= current.occurredAt);
    if (newer) {
      best.set(key, fact);
    }
  }
  return {
    facts: [...best.values()].toSorted((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    ),
    droppedRevisions,
  };
}

/** 子任务请求与父级汇总行同时存在时，只计请求行。 */
export function selectCountedFacts(facts: readonly UsageRequestFact[]): UsageRequestFact[] {
  const requests = facts.filter((fact) => fact.role === "request");
  const rollups = facts.filter((fact) => fact.role === "task_rollup");
  const coveredParents = new Set<string>();
  for (const fact of requests) {
    coveredParents.add(fact.taskId);
    if (fact.parentTaskId) {
      coveredParents.add(fact.parentTaskId);
    }
  }
  const counted = [...requests];
  for (const rollup of rollups) {
    if (!coveredParents.has(rollup.taskId)) {
      counted.push(rollup);
    }
  }
  return counted;
}

function lifecycleOf(
  facts: readonly UsageRequestFact[],
  charges: UsageChargeLine[],
): UsageCostLifecycle {
  if (facts.some((fact) => fact.status === "running")) {
    return "running";
  }
  const pending = charges.some(
    (line) => line.kind === "pending" || line.kind === "estimate" || !line.final,
  );
  const unknownTokens = facts.some(
    (fact) => fact.inputTokens === null || fact.outputTokens === null,
  );
  if (
    pending ||
    unknownTokens ||
    facts.some((fact) => fact.status === "unknown" || fact.settlement.kind === "unknown")
  ) {
    return "needs_review";
  }
  return "finished";
}

function headlineFor(
  lifecycle: UsageCostLifecycle,
  charges: UsageChargeLine[],
  input: UsageTokenTally,
): string {
  const status =
    lifecycle === "running" ? "执行中" : lifecycle === "finished" ? "已结束" : "待核对";
  if (charges.length === 0) {
    return `${status} · 费用待确认`;
  }
  const primary = charges[0]?.label ?? "费用待确认";
  if (lifecycle === "running") {
    return `${status} · ${formatTokenTally(input)} 输入 token · ${primary}`;
  }
  return `${status} · ${primary}`;
}

function attentionMessage(
  facts: readonly UsageRequestFact[],
  budgetLevel: UsageCostPresentOptions["budgetLevel"],
): string | null {
  if (budgetLevel === "exceeded") {
    return "已超出月度预算上限";
  }
  if (budgetLevel === "alert") {
    return "已达到预算提醒阈值";
  }
  if (facts.some((fact) => fact.anomaly)) {
    return "这笔用量被标记为异常消耗";
  }
  return null;
}

function tallyFacts(facts: readonly UsageRequestFact[]): {
  input: UsageTokenTally;
  output: UsageTokenTally;
  cacheRead: UsageTokenTally;
  cacheWrite: UsageTokenTally;
  charges: UsageChargeLine[];
} {
  let input = EMPTY_TALLY();
  let output = EMPTY_TALLY();
  let cacheRead = EMPTY_TALLY();
  let cacheWrite = EMPTY_TALLY();
  const acc = emptyCharges();
  for (const fact of facts) {
    input = addToken(input, fact.inputTokens);
    output = addToken(output, fact.outputTokens);
    cacheRead = addToken(cacheRead, fact.cacheReadTokens);
    cacheWrite = addToken(cacheWrite, fact.cacheWriteTokens);
    addSettlement(acc, fact.settlement);
    if (
      fact.recordedCredits !== null &&
      fact.recordedCredits !== undefined &&
      fact.settlement.kind !== "credits" &&
      fact.settlement.kind !== "pending" &&
      fact.settlement.kind !== "quota"
    ) {
      acc.creditsFinal += fact.recordedCredits;
      acc.sawCreditsFinal = true;
    }
  }
  return { input, output, cacheRead, cacheWrite, charges: linesFromCharges(acc) };
}

function modelKey(fact: UsageRequestFact): string {
  return `${fact.provider ?? ""}||${fact.model ?? ""}`;
}

function buildModels(
  facts: readonly UsageRequestFact[],
  surface: UsageCostSurface,
): UsageCostModelRow[] {
  const groups = new Map<string, UsageRequestFact[]>();
  for (const fact of facts) {
    const bucket = groups.get(modelKey(fact)) ?? [];
    bucket.push(fact);
    groups.set(modelKey(fact), bucket);
  }
  return [...groups.entries()]
    .toSorted((left, right) => left[0].localeCompare(right[0]))
    .map(([, rows]) => {
      const tallies = tallyFacts(rows);
      const priceKnown = rows.every(
        (row) => row.procurementCents !== null && row.procurementCurrency === "CNY",
      );
      const row: UsageCostModelRow = {
        provider: rows[0]?.provider ?? null,
        model: rows[0]?.model ?? null,
        callCount: rows.length,
        retryCount: rows.filter((entry) => entry.attempt === "retry").length,
        fallbackCount: rows.filter((entry) => entry.attempt === "fallback").length,
        input: tallies.input,
        output: tallies.output,
        cacheRead: tallies.cacheRead,
        cacheWrite: tallies.cacheWrite,
        charges: tallies.charges,
      };
      if (surface === "platform") {
        row.procurementKnown = priceKnown;
        if (priceKnown) {
          row.procurementCents = rows.reduce(
            (sum, entry) => sum + (entry.procurementCents ?? 0),
            0,
          );
        }
      }
      return row;
    });
}

function buildBuckets(
  facts: readonly UsageRequestFact[],
  pick: (fact: UsageRequestFact) => string | null,
  unlabeled: string,
): UsageCostBucket[] {
  const groups = new Map<string, UsageRequestFact[]>();
  for (const fact of facts) {
    const id = pick(fact)?.trim() || unlabeled;
    const bucket = groups.get(id) ?? [];
    bucket.push(fact);
    groups.set(id, bucket);
  }
  return [...groups.entries()]
    .toSorted((left, right) => left[0].localeCompare(right[0]))
    .map(([id, rows]) => {
      const tallies = tallyFacts(rows);
      return {
        id,
        callCount: rows.length,
        failedCount: rows.filter((row) => row.status === "failed" || row.status === "cancelled")
          .length,
        retryCount: rows.filter((row) => row.attempt === "retry").length,
        fallbackCount: rows.filter((row) => row.attempt === "fallback").length,
        input: tallies.input,
        output: tallies.output,
        charges: tallies.charges,
      };
    });
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return sorted[mid] ?? null;
}

function priceKindOf(fact: UsageRequestFact): "known" | "free" | "missing" {
  if (fact.procurementPrice) {
    return fact.procurementPrice;
  }
  return fact.procurementCents === null ? "missing" : "known";
}

function buildRanking(facts: readonly UsageRequestFact[]): {
  ranking: UsageCostRankRow[];
  excludedFromRanking: UsageCostExcludedRank[];
} {
  const groups = new Map<string, UsageRequestFact[]>();
  for (const fact of facts) {
    const bucket = groups.get(modelKey(fact)) ?? [];
    bucket.push(fact);
    groups.set(modelKey(fact), bucket);
  }
  const ranking: UsageCostRankRow[] = [];
  const excludedFromRanking: UsageCostExcludedRank[] = [];
  for (const rows of groups.values()) {
    const provider = rows[0]?.provider ?? null;
    const model = rows[0]?.model ?? null;
    const unknownUsage = rows.some(
      (row) => row.inputTokens === null || row.outputTokens === null || row.status === "unknown",
    );
    const missingPrice = rows.some(
      (row) => priceKindOf(row) === "missing" || row.procurementCents === null,
    );
    if (unknownUsage || missingPrice) {
      excludedFromRanking.push({
        provider,
        model,
        reason: missingPrice ? "missing_price" : "unknown_usage",
      });
      continue;
    }
    const terminal = rows.filter((row) => row.status !== "running");
    const succeeded = terminal.filter((row) => row.status === "succeeded").length;
    const accepted = rows.filter(
      (row) => row.acceptance === "passed" || row.acceptance === "failed",
    );
    const passed = accepted.filter((row) => row.acceptance === "passed").length;
    ranking.push({
      provider,
      model,
      procurementCents: rows.reduce((sum, row) => sum + (row.procurementCents ?? 0), 0),
      priceKind: rows.every((row) => priceKindOf(row) === "free") ? "free" : "known",
      successRate: terminal.length > 0 ? succeeded / terminal.length : null,
      acceptanceRate: accepted.length > 0 ? passed / accepted.length : null,
      latencyMsMedian: median(
        rows.flatMap((row) => (row.latencyMs === null ? [] : [row.latencyMs])),
      ),
      callCount: rows.length,
    });
  }
  ranking.sort(
    (left, right) =>
      left.procurementCents - right.procurementCents || right.callCount - left.callCount,
  );
  return { ranking, excludedFromRanking };
}

function taskStatus(facts: readonly UsageRequestFact[]): UsageCostTaskNode["status"] {
  if (facts.some((fact) => fact.status === "running")) {
    return "running";
  }
  if (facts.some((fact) => fact.status === "failed")) {
    return "failed";
  }
  if (facts.some((fact) => fact.status === "cancelled")) {
    return "cancelled";
  }
  if (facts.some((fact) => fact.status === "unknown")) {
    return "unknown";
  }
  if (facts.some((fact) => fact.status === "succeeded")) {
    return "succeeded";
  }
  return "unknown";
}

function buildTaskTree(counted: readonly UsageRequestFact[]): UsageCostTaskNode[] {
  const ids = new Set(counted.map((fact) => fact.taskId));
  for (const fact of counted) {
    if (fact.parentTaskId) {
      ids.add(fact.parentTaskId);
    }
  }
  const byParent = new Map<string | null, string[]>();
  const parentOf = new Map<string, string | null>();
  for (const id of ids) {
    const explicit =
      counted.find((fact) => fact.taskId === id && fact.parentTaskId)?.parentTaskId ?? null;
    parentOf.set(id, explicit && ids.has(explicit) ? explicit : null);
  }
  for (const [id, parent] of parentOf) {
    const list = byParent.get(parent) ?? [];
    list.push(id);
    byParent.set(parent, list);
  }

  const build = (taskId: string): UsageCostTaskNode => {
    const ownFacts = counted.filter((fact) => fact.taskId === taskId);
    const childIds = (byParent.get(taskId) ?? []).filter((id) => id !== taskId);
    const children = childIds.toSorted().map((id) => build(id));
    const descendantFacts = collectDescendants(taskId, counted, parentOf);
    const rolled = tallyFacts(descendantFacts);
    const own = tallyFacts(ownFacts);
    return {
      taskId,
      parentTaskId: parentOf.get(taskId) ?? null,
      status: taskStatus(descendantFacts.length > 0 ? descendantFacts : ownFacts),
      callCount: descendantFacts.length,
      retryCount: descendantFacts.filter((fact) => fact.attempt === "retry").length,
      fallbackCount: descendantFacts.filter((fact) => fact.attempt === "fallback").length,
      input: children.length > 0 ? rolled.input : own.input,
      output: children.length > 0 ? rolled.output : own.output,
      cacheRead: children.length > 0 ? rolled.cacheRead : own.cacheRead,
      cacheWrite: children.length > 0 ? rolled.cacheWrite : own.cacheWrite,
      charges: children.length > 0 ? rolled.charges : own.charges,
      rolledUpFromChildren: children.length > 0,
      children,
    };
  };

  const roots = (byParent.get(null) ?? []).toSorted();
  return roots.map((id) => build(id));
}

function collectDescendants(
  taskId: string,
  counted: readonly UsageRequestFact[],
  parentOf: Map<string, string | null>,
): UsageRequestFact[] {
  const childIds = new Set<string>([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, parent] of parentOf) {
      if (parent && childIds.has(parent) && !childIds.has(id)) {
        childIds.add(id);
        grew = true;
      }
    }
  }
  return counted.filter((fact) => childIds.has(fact.taskId));
}

function sumTaskInput(nodes: readonly UsageCostTaskNode[]): number {
  return nodes.reduce((sum, node) => sum + node.input.known, 0);
}

function currenciesOf(lines: readonly UsageChargeLine[]): Set<string> {
  return new Set(
    lines.flatMap((line) => (line.currency && line.amountCents !== null ? [line.currency] : [])),
  );
}

export function presentUsageCostLayer(
  actor: UsageCostActor,
  facts: readonly UsageRequestFact[],
  options: UsageCostPresentOptions = {},
): { ok: true; view: UsageCostLayerView } | { ok: false; message: string } {
  const taskId = options.taskId?.trim() || "";
  const scoped = facts.filter((fact) => inActorScope(actor, fact));
  if (taskId) {
    const matched = scoped.filter((fact) => fact.taskId === taskId || fact.parentTaskId === taskId);
    const hidden = facts.filter(
      (fact) =>
        (fact.taskId === taskId || fact.parentTaskId === taskId) && !inActorScope(actor, fact),
    );
    if (matched.length === 0 && hidden.length > 0) {
      return { ok: false, message: "无权查看该任务" };
    }
    return { ok: true, view: projectSurface(actor.surface, matched, options) };
  }
  return { ok: true, view: projectSurface(actor.surface, scoped, options) };
}

function inActorScope(actor: UsageCostActor, fact: UsageRequestFact): boolean {
  if (actor.surface === "platform") {
    if (actor.enterpriseId && fact.enterpriseId !== actor.enterpriseId) {
      return false;
    }
    return true;
  }
  if (!actor.enterpriseId || fact.enterpriseId !== actor.enterpriseId) {
    return false;
  }
  if (actor.surface === "user" || !actor.enterpriseWide) {
    return Boolean(actor.userId) && fact.userId === actor.userId;
  }
  return true;
}

function projectSurface(
  surface: UsageCostSurface,
  facts: readonly UsageRequestFact[],
  options: UsageCostPresentOptions,
): UsageCostLayerView {
  const { facts: deduped } = dedupeFacts(facts);
  const counted = selectCountedFacts(deduped);
  const tallies = tallyFacts(counted);
  const models = buildModels(counted, surface);
  const tasks = buildTaskTree(counted);
  const lifecycle = counted.length === 0 ? "finished" : lifecycleOf(counted, tallies.charges);
  const attention = attentionMessage(counted, options.budgetLevel);
  const modelInputKnown = models.reduce((sum, row) => sum + row.input.known, 0);
  const taskInputKnown = sumTaskInput(tasks);
  const ranking = surface === "platform" ? buildRanking(counted) : null;
  const procurementKnown = counted.every((fact) => fact.procurementCents !== null);
  const revenueKnown = counted.every((fact) => fact.revenueCents !== null);
  const procurementCents =
    surface === "platform" && counted.length > 0 && procurementKnown
      ? counted.reduce((sum, fact) => sum + (fact.procurementCents ?? 0), 0)
      : surface === "platform"
        ? null
        : undefined;
  const commercialMarginCents =
    surface === "platform" && procurementKnown && revenueKnown && counted.length > 0
      ? computeMarginCents({
          tenantRevenueCents: counted.reduce((sum, fact) => sum + (fact.revenueCents ?? 0), 0),
          providerCostCents: counted.reduce((sum, fact) => sum + (fact.procurementCents ?? 0), 0),
        })
      : surface === "platform"
        ? null
        : undefined;
  const currencies = currenciesOf(tallies.charges);
  const cacheUnknown = counted.some(
    (fact) => fact.cacheReadTokens === null || fact.cacheWriteTokens === null,
  );
  const cacheNote =
    counted.length === 0
      ? null
      : cacheUnknown
        ? "缓存按任务记一行。账本里有的缓存读/写会显示；没有写入的记为未知，不会显示成 0。一次任务里的多次调用不会逐条分列。"
        : "缓存按任务合计，不是逐次调用。";
  const priceKinds = new Set(counted.map((fact) => priceKindOf(fact)));
  const procurementStatus =
    surface !== "platform" || counted.length === 0
      ? undefined
      : priceKinds.size > 1
        ? "mixed"
        : priceKinds.has("free")
          ? "free"
          : priceKinds.has("missing")
            ? "missing"
            : "known";
  const view: UsageCostLayerView = {
    schemaVersion: 1,
    surface,
    lifecycle: counted.length === 0 ? "finished" : lifecycle,
    headline:
      counted.length === 0 ? "暂无用量" : headlineFor(lifecycle, tallies.charges, tallies.input),
    empty: counted.length === 0,
    coverage: options.truncated ? "truncated" : "complete",
    freshness: lifecycle === "running" ? "delayed" : "current",
    recoveredFromStore: true,
    cacheNote,
    mixedCurrency: currencies.size > 1,
    callCount: counted.length,
    input: tallies.input,
    output: tallies.output,
    cacheRead: tallies.cacheRead,
    cacheWrite: tallies.cacheWrite,
    charges: tallies.charges,
    models,
    tasks,
    byMember: surface === "user" ? [] : buildBuckets(counted, (fact) => fact.userId, "未归属"),
    byAssistant:
      surface === "user" ? [] : buildBuckets(counted, (fact) => fact.assistantId, "未归属"),
    byModel: buildBuckets(counted, (fact) => fact.model, "未知模型"),
    reconciliation: {
      detailInputKnown: tallies.input.known,
      modelInputKnown,
      taskInputKnown,
      aligned: tallies.input.known === modelInputKnown && tallies.input.known === taskInputKnown,
    },
    attention: { active: Boolean(attention), message: attention },
  };
  if (surface === "platform" && ranking) {
    view.ranking = ranking.ranking;
    view.excludedFromRanking = ranking.excludedFromRanking;
    view.procurementCents = procurementCents ?? null;
    view.procurementStatus = procurementStatus;
    view.commercialMarginCents = commercialMarginCents ?? null;
    const taskTypes = [...new Set(counted.map((fact) => fact.taskType).filter(Boolean))];
    view.taskType =
      taskTypes.length === 1
        ? (taskTypes[0] ?? null)
        : taskTypes.length > 1
          ? "多个任务类型"
          : null;
    const acceptances = counted.map((fact) => fact.acceptance).filter(Boolean);
    view.acceptance = acceptances.every((item) => item === "passed")
      ? "passed"
      : acceptances.some((item) => item === "failed")
        ? "failed"
        : acceptances.some((item) => item === "pending")
          ? "pending"
          : null;
  }
  return view;
}

export function responseHasCommercialCost(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => responseHasCommercialCost(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "procurementCents" ||
      key === "commercialMarginCents" ||
      key === "providerCostCents" ||
      key === "marginCents" ||
      key === "providerCost" ||
      key === "margin" ||
      key === "ranking"
    ) {
      return true;
    }
    if (responseHasCommercialCost(entry)) {
      return true;
    }
  }
  return false;
}
