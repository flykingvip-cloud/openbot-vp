/**
 * 员工端「我的可用模型 + 用量」自包含区块（挂载于用户端系统设置「AI 模型」tab）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2，R5.2）。
 *
 * 自包含 LitElement：持有 `client`，自行加载：
 * - `employee-model-access.summary`：当前 seat 可用模型（entitlement）只读摘要；
 * - `sessions.usage`（近 30 天）：各模型实际消费量（tokens/成本/次数），用于可视化。
 * 两者合并为「可用模型 + 各模型消费量」视图。员工端不暴露平台模型管理复杂度。
 */

import { LitElement } from "lit";
import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import {
  buildEmployeeModelUsageView,
  buildEmployeeModelView,
  createModelAuthorizationGateway,
  getModelAuthorizationClient,
  type EmployeeModelEntitlementSummary,
  type EmployeeModelUsageView,
  type ModelUsageInputRow,
} from "../capability/model-authorization/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { renderEmployeeModelAccess } from "./employee-model-access.ts";

/** 用量展示区间（天）。 */
const USAGE_WINDOW_DAYS = 30;

function usageWindow(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - (USAGE_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
  const fmt = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const USAGE_UNAVAILABLE_REASON = "无法确认当前员工范围内的完整用量，请稍后重试。";

type UsageLoadResult =
  | { status: "ready"; byModel: ModelUsageInputRow[]; partial?: boolean }
  | { status: "unavailable"; reason: string };

function toNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function toNonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Canonical usage rows must carry both provider and model to be attributable. */
function normalizeRequiredLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function costsMatch(left: number, right: number): boolean {
  const tolerance = Math.max(1e-8, Math.abs(right) * 1e-9);
  return Math.abs(left - right) <= tolerance;
}

/** 把 `sessions.usage` 的 `aggregates.byModel` 原始项收敛为受控输入行。 */
function normalizeUsageRow(raw: unknown): ModelUsageInputRow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const provider = normalizeRequiredLabel(row.provider);
  const model = normalizeRequiredLabel(row.model);
  if (!provider || !model || !row.totals || typeof row.totals !== "object") {
    return null;
  }
  const totals = row.totals as Record<string, unknown>;
  const count = toNonNegativeInteger(row.count);
  const input = toNonNegativeInteger(totals.input);
  const output = toNonNegativeInteger(totals.output);
  const totalTokens = toNonNegativeInteger(totals.totalTokens);
  const totalCost = toNonNegativeFiniteNumber(totals.totalCost);
  if (
    count === null ||
    input === null ||
    output === null ||
    totalTokens === null ||
    totalCost === null
  ) {
    return null;
  }
  return { provider, model, count, totals: { input, output, totalTokens, totalCost } };
}

export class EmployeeModelAccessSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @property({ type: Boolean }) embedded = false;

  @state() private summary: EmployeeModelEntitlementSummary | null = null;
  @state() private usageView: EmployeeModelUsageView | null = null;
  @state() private loading = false;
  @state() private loaded = false;

  /** 首帧无 client / 未连接时的有限次重试，避免永久停在空态。 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private lastResolvedClient: GatewayBrowserClient | null = null;
  private loadGeneration = 0;
  private static readonly MAX_RETRY_ATTEMPTS = 40;
  private static readonly RETRY_INTERVAL_MS = 500;

  connectedCallback() {
    super.connectedCallback();
    this.lastResolvedClient = this.resolveClient();
    void this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.loadGeneration += 1;
    this.loading = false;
    this.clearRetry();
  }

  private resolveClient(): GatewayBrowserClient | null {
    return this.client ?? getModelAuthorizationClient();
  }

  private resetSummary() {
    this.loadGeneration += 1;
    this.summary = null;
    this.usageView = null;
    this.loaded = false;
    this.loading = false;
    this.retryAttempts = 0;
    this.clearRetry();
  }

  protected updated(_changed: PropertyValues) {
    const client = this.resolveClient();
    if (client !== this.lastResolvedClient) {
      this.lastResolvedClient = client;
      this.resetSummary();
      void this.load();
    }
  }

  private clearRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry() {
    if (
      this.retryTimer ||
      this.loaded ||
      this.retryAttempts >= EmployeeModelAccessSection.MAX_RETRY_ATTEMPTS
    ) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.load();
    }, EmployeeModelAccessSection.RETRY_INTERVAL_MS);
  }

  private usageViewFor(
    summary: EmployeeModelEntitlementSummary,
    usageResult: UsageLoadResult,
  ): EmployeeModelUsageView {
    const displayLabels: Record<string, string> = {};
    for (const model of buildEmployeeModelView(summary).models) {
      if (model.modelId.startsWith("ent/") && model.title.trim()) {
        displayLabels[model.modelId] = model.title.trim();
      }
    }
    return buildEmployeeModelUsageView({
      entitlementModelIds: summary.modelIds ?? [],
      displayLabels,
      byModel: usageResult.status === "ready" ? usageResult.byModel : [],
      windowDays: USAGE_WINDOW_DAYS,
      status: usageResult.status,
      ...(usageResult.status === "unavailable" ? { unavailableReason: usageResult.reason } : {}),
      ...(usageResult.status === "ready" && usageResult.partial ? { partial: true } : {}),
    });
  }

  /** 拉取近 30 天的员工可见完整聚合；任何不可验证响应都显式标记不可用。 */
  private async loadUsage(client: GatewayBrowserClient): Promise<UsageLoadResult> {
    try {
      const { startDate, endDate } = usageWindow();
      const res = await client.request("sessions.usage", {
        startDate,
        endDate,
        limit: 1,
        aggregateAll: true,
        scope: "self",
      });
      const usage = res as {
        scope?: unknown;
        aggregatesComplete?: unknown;
        totalSessions?: unknown;
        totals?: unknown;
        aggregates?: { byModel?: unknown };
      } | null;
      const byModel = usage?.aggregates?.byModel;
      const totals = usage?.totals;
      const totalSessions = toNonNegativeInteger(usage?.totalSessions);
      // 员工可见范围已确认时：即使部分会话 transcript 缺失导致 aggregatesComplete=false，
      // 只要 totals ↔ byModel 自洽，也展示可确认用量（脚注标记 partial），避免整页「暂不可用」。
      if (
        usage?.scope !== "employee-visible" ||
        totalSessions === null ||
        !totals ||
        typeof totals !== "object" ||
        !Array.isArray(byModel)
      ) {
        return { status: "unavailable", reason: USAGE_UNAVAILABLE_REASON };
      }
      const totalRecord = totals as Record<string, unknown>;
      const totalTokens = toNonNegativeInteger(totalRecord.totalTokens);
      const totalCost = toNonNegativeFiniteNumber(totalRecord.totalCost);
      const normalized = byModel.map((entry) => normalizeUsageRow(entry));
      if (totalTokens === null || totalCost === null || normalized.some((row) => row === null)) {
        return { status: "unavailable", reason: USAGE_UNAVAILABLE_REASON };
      }
      const rows = normalized.filter((row): row is ModelUsageInputRow => row !== null);
      const attributedTokens = rows.reduce((sum, row) => sum + row.totals.totalTokens, 0);
      const attributedCost = rows.reduce((sum, row) => sum + row.totals.totalCost, 0);
      if (attributedTokens !== totalTokens || !costsMatch(attributedCost, totalCost)) {
        return { status: "unavailable", reason: USAGE_UNAVAILABLE_REASON };
      }
      // Zero scoped sessions cannot carry usage: such an envelope is inconsistent.
      if (totalSessions === 0 && (rows.length > 0 || totalTokens > 0 || totalCost > 0)) {
        return { status: "unavailable", reason: USAGE_UNAVAILABLE_REASON };
      }
      return {
        status: "ready",
        byModel: rows,
        ...(usage.aggregatesComplete !== true ? { partial: true } : {}),
      };
    } catch {
      return { status: "unavailable", reason: USAGE_UNAVAILABLE_REASON };
    }
  }

  private async load() {
    if (this.loading) {
      return;
    }
    const client = this.resolveClient();
    if (!client) {
      this.retryAttempts += 1;
      this.scheduleRetry();
      return;
    }
    if (!client.connected) {
      this.retryAttempts += 1;
      this.scheduleRetry();
      return;
    }
    this.clearRetry();
    this.retryAttempts = 0;
    const generation = ++this.loadGeneration;
    const isCurrentLoad = () =>
      generation === this.loadGeneration && this.resolveClient() === client && this.isConnected;
    this.loading = true;
    try {
      const gw = createModelAuthorizationGateway(client);
      // 授权与用量相互独立：一侧失败不得拖垮另一侧（此前 Promise.all 在
      // domain_mismatch 时会把已成功的 sessions.usage 结果一并丢弃）。
      const [summarySettled, usageSettled] = await Promise.allSettled([
        gw.getEmployeeSummary(),
        this.loadUsage(client),
      ]);
      if (!isCurrentLoad()) {
        return;
      }
      if (summarySettled.status === "fulfilled") {
        this.summary = summarySettled.value.summary;
      } else {
        this.summary = {
          modelIds: [],
          state: "missing",
          reason: "暂时无法获取模型授权信息。",
        };
      }
      const usageResult =
        usageSettled.status === "fulfilled"
          ? usageSettled.value
          : ({ status: "unavailable", reason: USAGE_UNAVAILABLE_REASON } as const);
      this.usageView = this.usageViewFor(this.summary, usageResult);
      this.loaded = true;
    } catch {
      if (!isCurrentLoad()) {
        return;
      }
      // 只读区块：意外失败时保留工作台，并明确区分 usage 不可用与零使用。
      this.summary = {
        modelIds: [],
        state: "missing",
        reason: "暂时无法获取模型授权信息。",
      };
      this.usageView = buildEmployeeModelUsageView({
        entitlementModelIds: [],
        byModel: [],
        windowDays: USAGE_WINDOW_DAYS,
        status: "unavailable",
        unavailableReason: USAGE_UNAVAILABLE_REASON,
      });
      this.loaded = true;
    } finally {
      if (isCurrentLoad()) {
        this.loading = false;
      }
    }
  }

  render() {
    const summary: EmployeeModelEntitlementSummary = this.summary ?? {
      modelIds: [],
      state: "missing",
      reason: "加载中…",
    };
    return renderEmployeeModelAccess({
      view: buildEmployeeModelView(summary),
      usage: this.usageView,
      loading: (this.loading || !this.loaded) && this.summary === null,
      embedded: this.embedded,
    });
  }
}

if (!customElements.get("employee-model-access-section")) {
  customElements.define("employee-model-access-section", EmployeeModelAccessSection);
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-model-access-section": EmployeeModelAccessSection;
  }
}
