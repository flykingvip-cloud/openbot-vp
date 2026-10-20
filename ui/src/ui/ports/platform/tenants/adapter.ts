import type {
  ControlUiPlatformPendingAdminActivationSummary,
  ControlUiPlatformTrialApplicationSummary,
} from "../../../../../../src/gateway/control-ui-contract.js";
import { pathForTab } from "../../../navigation.ts";
import { platformEnterpriseSourceLabel, platformEnterpriseStatusLabel } from "../shared/surface.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { platformCreateTenantHref } from "../system-settings/route.ts";
import {
  formatTrialApplicationDateTime,
  TRIAL_APPLICATION_STATUS_LABEL,
} from "./sections/TenantTrialApplicationsSection.ts";
import type {
  PlatformTenantAttentionVM,
  PlatformTenantDetailVM,
  PlatformTenantDirectoryItemVM,
  PlatformTenantManagedObjectType,
  PlatformTenantMetricVM,
  PlatformTenantOperationItemVM,
  PlatformTenantPendingItemVM,
  PlatformTenantTone,
  PlatformTenantsVM,
} from "./view-model.ts";

const ADMIN_ACTIVATION_TODO_LABELS = new Set([
  "管理员尚未激活",
  "激活链接已过期",
  "激活链接已撤销",
  "需要发送激活邮件",
]);

function isAdminActivationTodoLabel(label: string): boolean {
  return ADMIN_ACTIVATION_TODO_LABELS.has(label);
}

/** Admin-activation todos come from real pending provision / contact status — never seatUsed alone. */
function resolveAdminActivationTodo(params: {
  contactStatus?: "pending_activation" | "activated";
  pendingAdmin?: ControlUiPlatformPendingAdminActivationSummary | null;
}): string | null {
  const pending = params.pendingAdmin;
  if (pending) {
    if (pending.latestCodeStatus === "expired") {
      return "激活链接已过期";
    }
    if (pending.latestCodeStatus === "revoked") {
      return "激活链接已撤销";
    }
    if (pending.needsResend && pending.latestCodeStatus !== "active") {
      return "需要发送激活邮件";
    }
    return "管理员尚未激活";
  }
  if (params.contactStatus === "pending_activation") {
    return "管理员尚未激活";
  }
  return null;
}

function resolveDirectoryUpdatedAtMs(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
): number {
  if (entry.contact?.updatedAt) {
    const ms = Date.parse(entry.contact.updatedAt);
    if (Number.isFinite(ms) && ms > 0) {
      return ms;
    }
  }
  for (const candidate of [
    entry.usageSummary?.updatedAt,
    entry.adoptionSummary?.updatedAt,
    entry.contributionSummary?.updatedAt,
    entry.healthSummary?.updatedAt,
  ]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  // Do not use trialEndsAt: that is a trial deadline, not an update timestamp.
  return 0;
}

export type PlatformTenantDetailSectionId =
  | "overview"
  | "usage"
  | "agents"
  | "runtime"
  | "billing"
  | "risks"
  | "controls"
  | "logs";

export const PLATFORM_TENANT_DETAIL_SECTIONS: readonly PlatformTenantDetailSectionId[] = [
  "overview",
  "usage",
  "agents",
  "runtime",
  "billing",
  "risks",
  "controls",
  "logs",
];

export const PLATFORM_TENANT_PRIMARY_SECTIONS: ReadonlyArray<
  readonly [PlatformTenantDetailSectionId, string]
> = [
  ["overview", "概览"],
  ["usage", "使用与资源"],
  ["billing", "计费与配额"],
  ["risks", "风险与策略"],
  ["logs", "操作记录"],
] as const;

export const PLATFORM_TENANTS_HASH_PREFIX = "#platform-tenants:";

export function platformTenantObjectKey(params: {
  tenantId?: string | null;
  applicationId?: string | null;
}): string {
  if (params.applicationId) {
    return `app:${params.applicationId}`;
  }
  if (params.tenantId) {
    return `tenant:${params.tenantId}`;
  }
  throw new Error("platformTenantObjectKey requires tenantId or applicationId");
}

export function parsePlatformTenantObjectKey(
  key: string,
): { kind: "tenant"; tenantId: string } | { kind: "application"; applicationId: string } | null {
  const raw = key.trim();
  if (raw.startsWith("app:")) {
    const applicationId = raw.slice(4);
    return applicationId ? { kind: "application", applicationId } : null;
  }
  if (raw.startsWith("tenant:")) {
    const tenantId = raw.slice(7);
    return tenantId ? { kind: "tenant", tenantId } : null;
  }
  // Legacy bare tenant id
  return raw ? { kind: "tenant", tenantId: raw } : null;
}

export function isTenantDetailSection(value: string): value is PlatformTenantDetailSectionId {
  return (PLATFORM_TENANT_DETAIL_SECTIONS as readonly string[]).includes(value);
}

export function normalizeTenantDetailSection(
  section: PlatformTenantDetailSectionId,
): PlatformTenantDetailSectionId {
  if (section === "agents" || section === "runtime") {
    return "usage";
  }
  return section;
}

export function parseTenantSelectionHash(
  hash: string,
): { objectKey: string; section: PlatformTenantDetailSectionId } | null {
  const raw = hash.trim();
  if (!raw.startsWith(PLATFORM_TENANTS_HASH_PREFIX)) {
    return null;
  }
  const payload = raw.slice(PLATFORM_TENANTS_HASH_PREFIX.length);
  if (!payload) {
    return null;
  }
  const parts = payload.split(":");
  // New: objectKey may itself contain ":" (tenant:acme / app:id) and is URI-encoded as one segment.
  // Encoded form: encodeURIComponent("tenant:acme") → "tenant%3Aacme"
  // Legacy: "acme:overview" or "acme"
  try {
    if (parts.length === 1) {
      const decoded = decodeURIComponent(parts[0] ?? "");
      const parsed = parsePlatformTenantObjectKey(decoded);
      if (!parsed) {
        return null;
      }
      return {
        objectKey: platformTenantObjectKey(
          parsed.kind === "tenant"
            ? { tenantId: parsed.tenantId }
            : { applicationId: parsed.applicationId },
        ),
        section: "overview",
      };
    }
    // Prefer last segment as section when it is a known section id.
    const maybeSection = parts[parts.length - 1] ?? "";
    if (isTenantDetailSection(maybeSection) && parts.length >= 2) {
      const encodedKey = parts.slice(0, -1).join(":");
      const decoded = decodeURIComponent(encodedKey);
      const parsed = parsePlatformTenantObjectKey(decoded);
      if (!parsed) {
        return null;
      }
      return {
        objectKey: platformTenantObjectKey(
          parsed.kind === "tenant"
            ? { tenantId: parsed.tenantId }
            : { applicationId: parsed.applicationId },
        ),
        section: normalizeTenantDetailSection(maybeSection),
      };
    }
    const decoded = decodeURIComponent(payload);
    const parsed = parsePlatformTenantObjectKey(decoded);
    if (!parsed) {
      return null;
    }
    return {
      objectKey: platformTenantObjectKey(
        parsed.kind === "tenant"
          ? { tenantId: parsed.tenantId }
          : { applicationId: parsed.applicationId },
      ),
      section: "overview",
    };
  } catch {
    return null;
  }
}

export function platformTenantSectionHref(
  basePath: string,
  objectKeyOrTenantId: string,
  section: PlatformTenantDetailSectionId = "overview",
) {
  const parsed = parsePlatformTenantObjectKey(objectKeyOrTenantId);
  const objectKey = parsed
    ? platformTenantObjectKey(
        parsed.kind === "tenant"
          ? { tenantId: parsed.tenantId }
          : { applicationId: parsed.applicationId },
      )
    : objectKeyOrTenantId;
  return `${pathForTab("platformTenants", basePath)}${PLATFORM_TENANTS_HASH_PREFIX}${encodeURIComponent(objectKey)}:${section}`;
}

function formatCost(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatRelativeHours(hours: number) {
  if (hours <= 0) {
    return "刚刚";
  }
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
}

function formatApproxCompact(value: number) {
  return `约 ${formatCompact(value)}`;
}

function formatApproxCost(value: number) {
  return `约 ${formatCost(value)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 0)}%`;
}

function formatWindowDelta(values: number[]) {
  if (values.length < 2) {
    return "暂无趋势数据";
  }
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  if (first <= 0 && last <= 0) {
    return "窗口稳定";
  }
  if (first <= 0) {
    return "本周起量";
  }
  const delta = ((last - first) / first) * 100;
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 1) {
    return "窗口稳定";
  }
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function currentUsageOverview(readModel: PlatformSurfaceProps["readModel"]) {
  return (
    readModel.currentUsageOverview ?? {
      sessionCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalMessages: 0,
      errorCount: 0,
      errorRate: 0,
      avgLatencyMs: null,
      peakErrorDayLabel: null,
      topModelLabel: null,
      topAgentId: null,
      activeAgentCount: 0,
      activeChannelCount: 0,
      dailyCalls: [],
      dailyCost: [],
      updatedAt: null,
    }
  );
}

function daysUntil(dateLike?: string) {
  if (!dateLike) {
    return null;
  }
  const timestamp = Date.parse(dateLike);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.ceil((timestamp - Date.now()) / 86_400_000);
}

function tenantUsageWeight(entry: {
  status: "trial" | "paid" | "suspended" | "expired";
  seatUsed: number;
  seatQuota: number;
}) {
  const base = Math.max(entry.seatUsed, 1);
  const statusFactor =
    entry.status === "paid"
      ? 1.4
      : entry.status === "trial"
        ? 0.9
        : entry.status === "suspended"
          ? 0.25
          : 0.15;
  const seatFactor = entry.seatQuota > 0 ? Math.max(0.6, entry.seatUsed / entry.seatQuota) : 0.6;
  return base * statusFactor * seatFactor;
}

function tenantAdoption(entry: {
  status: "trial" | "paid" | "suspended" | "expired";
  seatUsed: number;
  seatQuota: number;
}) {
  const utilization = entry.seatQuota > 0 ? entry.seatUsed / Math.max(entry.seatQuota, 1) : 0;
  if (entry.status === "suspended" || entry.status === "expired") {
    return { label: "高风险", tone: "danger" as const };
  }
  if (entry.seatUsed === 0) {
    return { label: "未激活", tone: "warn" as const };
  }
  if (entry.status === "paid" && utilization >= 0.6) {
    return { label: "深度使用", tone: "ok" as const };
  }
  if (entry.status === "trial" && utilization >= 0.35) {
    return { label: "试用活跃", tone: "ok" as const };
  }
  if (utilization >= 0.2) {
    return { label: "稳步采用", tone: "neutral" as const };
  }
  return { label: "待提升", tone: "warn" as const };
}

function tenantHealth(entry: {
  status: "trial" | "paid" | "suspended" | "expired";
  seatUsed: number;
  seatQuota: number;
  trialEndsAt?: string;
}) {
  const utilization = entry.seatQuota > 0 ? entry.seatUsed / Math.max(entry.seatQuota, 1) : 0;
  if (entry.status === "suspended") {
    return { label: "运行受限", tone: "danger" as const, incident: "租户已暂停" };
  }
  if (entry.status === "expired") {
    return { label: "待续期", tone: "danger" as const, incident: "试用已到期" };
  }
  const days = daysUntil(entry.trialEndsAt);
  if (days != null && days <= 3 && entry.status === "trial") {
    return { label: "临近转化", tone: "warn" as const, incident: `试用剩余 ${days} 天` };
  }
  if (utilization >= 0.9) {
    return { label: "容量紧张", tone: "warn" as const, incident: "席位接近满载" };
  }
  if (entry.seatUsed === 0) {
    return { label: "低活跃", tone: "warn" as const, incident: "AI 采用尚未启动" };
  }
  return { label: "稳定", tone: "ok" as const, incident: "暂无平台级异常" };
}

function isHealthSummaryAnomalous(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (!entry.healthSummary) {
    return false;
  }
  if (entry.healthSummary.tone === "danger") {
    return true;
  }
  if (typeof entry.healthSummary.errorRate === "number" && entry.healthSummary.errorRate >= 0.08) {
    return true;
  }
  if (
    typeof entry.healthSummary.fallbackRate === "number" &&
    entry.healthSummary.fallbackRate >= 0.2
  ) {
    return true;
  }
  if (
    typeof entry.healthSummary.avgLatencyMs === "number" &&
    entry.healthSummary.avgLatencyMs >= 3000
  ) {
    return true;
  }
  return false;
}

function isUsageSummaryAnomalous(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (!entry.usageSummary) {
    return false;
  }
  return typeof entry.usageSummary.cost7d === "number" && entry.usageSummary.cost7d >= 500;
}

function isAdoptionSummaryAnomalous(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (!entry.adoptionSummary) {
    return false;
  }
  if (entry.adoptionSummary.tone === "danger") {
    return true;
  }
  if (
    typeof entry.adoptionSummary.aiActiveUsers === "number" &&
    entry.adoptionSummary.aiActiveUsers <= 0
  ) {
    return true;
  }
  return false;
}

function isTenantAnomalous(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
  item?: Pick<PlatformTenantDirectoryItemVM, "healthTone" | "riskTone">,
) {
  if (entry.status === "suspended" || entry.status === "expired") {
    return true;
  }
  if (
    isHealthSummaryAnomalous(entry) ||
    isUsageSummaryAnomalous(entry) ||
    isAdoptionSummaryAnomalous(entry)
  ) {
    return true;
  }
  return item?.healthTone === "danger" || item?.riskTone === "danger";
}

function hasTenantUsageSummary(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  return Boolean(
    entry.usageSummary &&
    ((typeof entry.usageSummary.calls7d === "number" && entry.usageSummary.calls7d > 0) ||
      (typeof entry.usageSummary.cost7d === "number" && entry.usageSummary.cost7d > 0) ||
      (typeof entry.usageSummary.topModelLabel === "string" &&
        entry.usageSummary.topModelLabel.trim())),
  );
}

function hasTenantAdoptionSummary(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  return Boolean(
    entry.adoptionSummary &&
    ((typeof entry.adoptionSummary.label === "string" && entry.adoptionSummary.label.trim()) ||
      typeof entry.adoptionSummary.aiActiveUsers === "number" ||
      typeof entry.adoptionSummary.automationTaskCount === "number"),
  );
}

function hasTenantHealthSummary(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  return Boolean(
    entry.healthSummary &&
    ((typeof entry.healthSummary.label === "string" && entry.healthSummary.label.trim()) ||
      typeof entry.healthSummary.errorRate === "number" ||
      typeof entry.healthSummary.avgLatencyMs === "number" ||
      (typeof entry.healthSummary.incidentLabel === "string" &&
        entry.healthSummary.incidentLabel.trim())),
  );
}

function runtimeLabel(
  readModel: PlatformSurfaceProps["readModel"],
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (entry.tenantId === readModel.currentTenantId) {
    return `${readModel.runtimeHosts.length} 个`;
  }
  if (
    typeof entry.usageSummary?.activeRuntimeCount === "number" &&
    entry.usageSummary.activeRuntimeCount >= 0
  ) {
    return `${entry.usageSummary.activeRuntimeCount} 个`;
  }
  return "数据源未连接";
}

function agentLabel(
  readModel: PlatformSurfaceProps["readModel"],
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (entry.tenantId === readModel.currentTenantId) {
    return `${(readModel.agentDirectory ?? []).length} 个`;
  }
  if (
    typeof entry.usageSummary?.activeAgentCount === "number" &&
    entry.usageSummary.activeAgentCount >= 0
  ) {
    return `${entry.usageSummary.activeAgentCount} 个`;
  }
  return "数据源未连接";
}

function groupLabel(
  readModel: PlatformSurfaceProps["readModel"],
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (entry.tenantId === readModel.currentTenantId) {
    return `${readModel.channelIds.length} 个`;
  }
  if (
    typeof entry.usageSummary?.activeChannelCount === "number" &&
    entry.usageSummary.activeChannelCount >= 0
  ) {
    return `${entry.usageSummary.activeChannelCount} 个`;
  }
  return "数据源未连接";
}

function formatTenantPlanLabel(plan: string) {
  switch (plan.trim().toLowerCase()) {
    case "trial":
      return "试用套餐";
    case "standard":
      return "标准套餐";
    case "professional":
    case "pro":
      return "专业套餐";
    case "enterprise":
      return "企业套餐";
    case "legacy":
      return "历史套餐";
    case "free":
      return "免费套餐";
    default:
      return plan || "未配置套餐";
  }
}

function formatBillingStatusLabel(status: string) {
  switch (status.trim().toLowerCase()) {
    case "active":
    case "paid":
      return "生效中";
    case "pending":
      return "待处理";
    case "trial":
    case "trialing":
      return "试用中";
    case "past_due":
      return "待支付";
    case "none":
      return "未订阅";
    case "legacy":
      return "历史计费";
    case "overdue":
      return "待续费";
    case "suspended":
      return "已暂停";
    case "expired":
      return "已到期";
    case "cancelled":
    case "canceled":
      return "已取消";
    default:
      return status || "未配置计费";
  }
}

function estimateWeeklyRevenue(
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  if (entry.status !== "paid") {
    return 0;
  }
  const plan = (entry.plan ?? "standard").trim().toLowerCase();
  const seatMonthlyPrice =
    plan.includes("enterprise") || plan.includes("legacy")
      ? 69
      : plan.includes("pro") || plan.includes("professional")
        ? 39
        : 19;
  return (Math.max(entry.seatQuota ?? 0, entry.seatUsed ?? 0, 1) * seatMonthlyPrice) / 4;
}

function lifecycleForTenant(params: {
  status: "trial" | "paid" | "suspended" | "expired";
  days: number | null;
  adoptionTone: PlatformTenantDirectoryItemVM["adoptionTone"];
  healthTone: PlatformTenantDirectoryItemVM["healthTone"];
  utilization: number;
  anomalous: boolean;
}) {
  if (params.status === "suspended" || params.status === "expired") {
    return {
      status: "suspended" as const,
      label: params.status === "expired" ? "已到期" : "已冻结",
      tone: "danger" as const,
    };
  }
  if (params.anomalous || params.healthTone === "danger") {
    return { status: "risk" as const, label: "风险", tone: "danger" as const };
  }
  if (params.status === "trial") {
    if (params.days != null && params.days <= 7 && params.adoptionTone !== "warn") {
      return { status: "converting" as const, label: "转化中", tone: "warn" as const };
    }
    return { status: "trial" as const, label: "试用", tone: "warn" as const };
  }
  if (params.utilization >= 0.75 || params.adoptionTone === "ok") {
    return { status: "expanding" as const, label: "扩容中", tone: "ok" as const };
  }
  return { status: "active" as const, label: "活跃", tone: "ok" as const };
}

function aiActivityForTenant(
  adoption: { tone: PlatformTenantDirectoryItemVM["adoptionTone"] },
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
) {
  const utilization = entry.seatQuota > 0 ? entry.seatUsed / Math.max(entry.seatQuota, 1) : 0;
  if (adoption.tone === "danger") {
    return { label: "风险", meta: `${entry.seatUsed} 人活跃` };
  }
  if (adoption.tone === "ok" || utilization >= 0.5) {
    return { label: "高活跃", meta: `${entry.seatUsed} 人活跃` };
  }
  if (utilization >= 0.2) {
    return { label: "中活跃", meta: `${entry.seatUsed} 人活跃` };
  }
  return { label: "低活跃", meta: `${entry.seatUsed} 人活跃` };
}

function healthScoreForTenant(
  tone: PlatformTenantDirectoryItemVM["healthTone"],
  stats: PlatformTenantDirectoryItemVM["healthStats"],
) {
  if (typeof stats.successRate === "number") {
    return formatPercent(stats.successRate);
  }
  if (typeof stats.errorRate === "number") {
    return formatPercent(Math.max(0, 1 - stats.errorRate));
  }
  if (tone === "ok") {
    return "稳定";
  }
  if (tone === "warn") {
    return "需观察";
  }
  if (tone === "danger") {
    return "高风险";
  }
  return "暂无健康数据";
}

function recentEventForTenant(params: {
  itemStatus: "trial" | "paid" | "suspended" | "expired";
  lifecycleLabel: string;
  health: { label: string; tone: PlatformTenantDirectoryItemVM["healthTone"]; incident: string };
  cost7d: number | null;
  adoptionTone: PlatformTenantDirectoryItemVM["adoptionTone"];
}) {
  if (params.itemStatus === "suspended") {
    return { label: "租户已冻结", meta: "需要恢复决策" };
  }
  if (params.itemStatus === "expired") {
    return { label: "试用已到期", meta: "需要续期或关闭" };
  }
  if (params.health.tone === "danger" || params.health.tone === "warn") {
    return { label: params.health.incident, meta: "运行健康" };
  }
  if (typeof params.cost7d === "number" && params.cost7d >= 500) {
    return { label: "成本冲高", meta: "本周成本异常" };
  }
  if (params.lifecycleLabel.includes("剩余")) {
    return { label: "试用即将到期", meta: params.lifecycleLabel };
  }
  if (params.adoptionTone === "warn") {
    return { label: "长期未活跃", meta: "AI 采用偏低" };
  }
  return { label: "暂无异常", meta: "运行正常" };
}

function growthForTenant(params: {
  status: "trial" | "paid" | "suspended" | "expired";
  adoptionTone: PlatformTenantDirectoryItemVM["adoptionTone"];
  healthTone: PlatformTenantDirectoryItemVM["healthTone"];
  utilization: number;
}) {
  if (
    params.status === "suspended" ||
    params.status === "expired" ||
    params.healthTone === "danger"
  ) {
    return { label: "-18%", tone: "danger" as const };
  }
  if (params.adoptionTone === "ok") {
    return { label: `+${Math.round(12 + params.utilization * 28)}%`, tone: "ok" as const };
  }
  if (params.adoptionTone === "warn") {
    return { label: "-6%", tone: "warn" as const };
  }
  return { label: "+4%", tone: "neutral" as const };
}

function buildDirectoryItem(
  props: Pick<PlatformSurfaceProps, "readModel" | "basePath">,
  entry: PlatformSurfaceProps["readModel"]["enterpriseDirectory"][number],
  totalWeight: number,
  pendingAdmin?: ControlUiPlatformPendingAdminActivationSummary | null,
): PlatformTenantDirectoryItemVM {
  const { readModel, basePath } = props;
  const weight = tenantUsageWeight(entry);
  const costShare = totalWeight > 0 ? readModel.totalCost * (weight / totalWeight) : 0;
  const tokenShare = totalWeight > 0 ? readModel.totalTokens * (weight / totalWeight) : 0;
  const derivedAdoption = tenantAdoption(entry);
  const currentUsage = currentUsageOverview(readModel);
  const agentDirectory = readModel.agentDirectory ?? [];
  const isCurrent = entry.tenantId === readModel.currentTenantId;
  const adoption =
    !isCurrent && entry.adoptionSummary?.label
      ? {
          label: entry.adoptionSummary.label,
          tone: entry.adoptionSummary.tone ?? "neutral",
        }
      : derivedAdoption;
  const currentTopAgentLabel =
    isCurrent && currentUsage.topAgentId
      ? (agentDirectory.find((agent) => agent.agentId === currentUsage.topAgentId)?.label ??
        currentUsage.topAgentId)
      : null;
  const usageSource: PlatformTenantDirectoryItemVM["dataSources"]["usage"] = isCurrent
    ? "current_usage"
    : hasTenantUsageSummary(entry)
      ? "tenant_summary"
      : tokenShare > 0 || costShare > 0
        ? "derived"
        : "pending";
  const adoptionSource: PlatformTenantDirectoryItemVM["dataSources"]["adoption"] = isCurrent
    ? "current_usage"
    : hasTenantAdoptionSummary(entry)
      ? "tenant_summary"
      : entry.seatQuota > 0 || entry.seatUsed > 0
        ? "derived"
        : "pending";
  const healthSource: PlatformTenantDirectoryItemVM["dataSources"]["health"] = isCurrent
    ? "current_usage"
    : hasTenantHealthSummary(entry)
      ? "tenant_summary"
      : "derived";
  const health = (() => {
    if (!isCurrent && entry.healthSummary?.label) {
      return {
        label: entry.healthSummary.label,
        tone: entry.healthSummary.tone ?? "neutral",
        incident: entry.healthSummary.incidentLabel ?? "租户级健康摘要",
      };
    }
    if (!isCurrent || currentUsage.sessionCount === 0) {
      return tenantHealth(entry);
    }
    if (currentUsage.errorRate >= 0.08 || currentUsage.errorCount >= 5) {
      return {
        label: "失败偏高",
        tone: "danger" as const,
        incident: currentUsage.peakErrorDayLabel ?? `${currentUsage.errorCount} 条错误记录`,
      };
    }
    if (currentUsage.errorRate >= 0.03 || currentUsage.errorCount > 0) {
      return {
        label: "需观察",
        tone: "warn" as const,
        incident: currentUsage.peakErrorDayLabel ?? `${currentUsage.errorCount} 条错误记录`,
      };
    }
    return { label: "稳定", tone: "ok" as const, incident: "最近 7 天无明显错误" };
  })();
  const days = daysUntil(entry.trialEndsAt);
  const topModelLabel =
    (!isCurrent && entry.usageSummary?.topModelLabel ? entry.usageSummary.topModelLabel : null) ??
    (isCurrent ? currentUsage.topModelLabel : null) ??
    readModel.defaultModelPrimary ??
    (readModel.allowlistEntries ?? [])[0]?.modelRef ??
    "暂无模型数据";
  const planLabel = formatTenantPlanLabel(
    entry.plan || (entry.status === "paid" ? "standard" : "trial"),
  );
  const billingStatus = formatBillingStatusLabel(
    entry.billingStatus || (entry.status === "paid" ? "active" : "pending"),
  );
  const usageCallsLabel = isCurrent
    ? currentUsage.sessionCount > 0
      ? `${formatNumber(currentUsage.sessionCount)} 次`
      : "暂无调用数据"
    : typeof entry.usageSummary?.calls7d === "number" && entry.usageSummary.calls7d > 0
      ? `${formatNumber(entry.usageSummary.calls7d)} 次`
      : tokenShare > 0
        ? `${formatApproxCompact(Math.round(tokenShare / 120))} 次`
        : "暂无调用数据";
  const usageCostLabel = isCurrent
    ? currentUsage.totalCost > 0
      ? formatCost(currentUsage.totalCost)
      : "暂无成本数据"
    : typeof entry.usageSummary?.cost7d === "number" && entry.usageSummary.cost7d > 0
      ? formatCost(entry.usageSummary.cost7d)
      : costShare > 0
        ? formatApproxCost(costShare)
        : "暂无成本数据";
  const usageStats: PlatformTenantDirectoryItemVM["usageStats"] = isCurrent
    ? {
        calls7d: currentUsage.sessionCount,
        cost7d: currentUsage.totalCost,
        ...(currentUsage.topModelLabel ? { topModelLabel: currentUsage.topModelLabel } : {}),
        ...(currentTopAgentLabel ? { topAgentLabel: currentTopAgentLabel } : {}),
        activeAgentCount: currentUsage.activeAgentCount,
        activeChannelCount: currentUsage.activeChannelCount,
        activeRuntimeCount: readModel.runtimeHosts.length,
      }
    : {
        ...(typeof entry.usageSummary?.calls7d === "number"
          ? { calls7d: entry.usageSummary.calls7d }
          : {}),
        ...(typeof entry.usageSummary?.cost7d === "number"
          ? { cost7d: entry.usageSummary.cost7d }
          : {}),
        ...(entry.usageSummary?.topModelLabel
          ? { topModelLabel: entry.usageSummary.topModelLabel }
          : {}),
        ...(entry.usageSummary?.topAgentLabel
          ? { topAgentLabel: entry.usageSummary.topAgentLabel }
          : {}),
        ...(typeof entry.usageSummary?.activeAgentCount === "number"
          ? { activeAgentCount: entry.usageSummary.activeAgentCount }
          : {}),
        ...(typeof entry.usageSummary?.activeChannelCount === "number"
          ? { activeChannelCount: entry.usageSummary.activeChannelCount }
          : {}),
        ...(typeof entry.usageSummary?.activeRuntimeCount === "number"
          ? { activeRuntimeCount: entry.usageSummary.activeRuntimeCount }
          : {}),
      };
  const adoptionStats: PlatformTenantDirectoryItemVM["adoptionStats"] = {
    ...(typeof entry.adoptionSummary?.aiActiveUsers === "number"
      ? { aiActiveUsers: entry.adoptionSummary.aiActiveUsers }
      : {}),
    ...(typeof entry.adoptionSummary?.automationTaskCount === "number"
      ? { automationTaskCount: entry.adoptionSummary.automationTaskCount }
      : {}),
    ...(entry.adoptionSummary?.note ? { note: entry.adoptionSummary.note } : {}),
  };
  const healthStats: PlatformTenantDirectoryItemVM["healthStats"] = isCurrent
    ? {
        errorRate: currentUsage.errorRate,
        avgLatencyMs: currentUsage.avgLatencyMs ?? undefined,
        ...(currentUsage.peakErrorDayLabel
          ? { incidentLabel: currentUsage.peakErrorDayLabel }
          : {}),
      }
    : {
        ...(typeof entry.healthSummary?.errorRate === "number"
          ? { errorRate: entry.healthSummary.errorRate }
          : {}),
        ...(typeof entry.healthSummary?.successRate === "number"
          ? { successRate: entry.healthSummary.successRate }
          : {}),
        ...(typeof entry.healthSummary?.fallbackRate === "number"
          ? { fallbackRate: entry.healthSummary.fallbackRate }
          : {}),
        ...(typeof entry.healthSummary?.avgLatencyMs === "number"
          ? { avgLatencyMs: entry.healthSummary.avgLatencyMs }
          : {}),
        ...(entry.healthSummary?.incidentLabel
          ? { incidentLabel: entry.healthSummary.incidentLabel }
          : {}),
      };
  const anomalous =
    entry.status === "suspended" ||
    entry.status === "expired" ||
    health.tone === "danger" ||
    isHealthSummaryAnomalous(entry) ||
    isUsageSummaryAnomalous(entry) ||
    isAdoptionSummaryAnomalous(entry);
  const utilization = entry.seatQuota > 0 ? entry.seatUsed / Math.max(entry.seatQuota, 1) : 0;
  const lifecycleLabel =
    entry.status === "trial"
      ? days != null
        ? `试用剩余 ${days} 天`
        : "试用进行中"
      : entry.status === "paid"
        ? "正式租户"
        : entry.status === "suspended"
          ? "等待恢复"
          : "待续期";
  const lifecycle = lifecycleForTenant({
    status: entry.status,
    days,
    adoptionTone: adoption.tone,
    healthTone: health.tone,
    utilization,
    anomalous,
  });
  const riskTone: PlatformTenantDirectoryItemVM["riskTone"] =
    entry.status === "suspended" || entry.status === "expired"
      ? "danger"
      : days != null && days <= 3
        ? "warn"
        : anomalous
          ? "danger"
          : adoption.tone;
  const riskLabel =
    entry.status === "suspended" || entry.status === "expired"
      ? "需要平台介入"
      : days != null && days <= 3
        ? "高优先转化"
        : anomalous
          ? "风险需治理"
          : adoption.tone === "warn"
            ? "使用待提升"
            : "正常";
  const riskLevelLabel =
    riskTone === "danger" ? "高" : riskTone === "warn" ? "中" : riskTone === "ok" ? "低" : "低";
  const cost7dValue = isCurrent
    ? currentUsage.totalCost
    : typeof entry.usageSummary?.cost7d === "number"
      ? entry.usageSummary.cost7d
      : costShare > 0
        ? costShare
        : null;
  const revenue7dValue = estimateWeeklyRevenue(entry);
  const aiActivity = aiActivityForTenant(adoption, entry);
  const recentEvent = recentEventForTenant({
    itemStatus: entry.status,
    lifecycleLabel,
    health,
    cost7d: cost7dValue,
    adoptionTone: adoption.tone,
  });
  const growth = growthForTenant({
    status: entry.status,
    adoptionTone: adoption.tone,
    healthTone: health.tone,
    utilization,
  });
  const platformTenantOverviewHref = platformTenantSectionHref(
    basePath,
    platformTenantObjectKey({ tenantId: entry.tenantId }),
    "overview",
  );
  const platformTenantUsageHref = platformTenantSectionHref(
    basePath,
    platformTenantObjectKey({ tenantId: entry.tenantId }),
    "usage",
  );
  const platformTenantControlsHref = platformTenantSectionHref(
    basePath,
    platformTenantObjectKey({ tenantId: entry.tenantId }),
    "risks",
  );
  const objectType: PlatformTenantManagedObjectType =
    entry.status === "suspended"
      ? "suspended"
      : entry.status === "expired"
        ? "expired"
        : entry.status === "trial"
          ? "trial_tenant"
          : "formal_tenant";
  const objectTypeLabel =
    objectType === "formal_tenant"
      ? "正式租户"
      : objectType === "trial_tenant"
        ? "试用租户"
        : objectType === "suspended"
          ? "已暂停"
          : "已到期";
  const contactEmail = entry.contact?.contactEmail;
  const contactName = entry.contact?.contactName;
  const adminActivationTodo = resolveAdminActivationTodo({
    contactStatus: entry.contact?.status,
    pendingAdmin,
  });
  const pendingTodoLabel =
    entry.status === "suspended"
      ? "租户已暂停"
      : entry.status === "expired"
        ? "租户已到期"
        : days != null && days <= 3 && entry.status === "trial"
          ? "试用即将到期"
          : adminActivationTodo
            ? adminActivationTodo
            : utilization >= 0.9
              ? "席位接近额度"
              : anomalous
                ? recentEvent.label
                : "无待办";
  const hasPendingAction =
    entry.status === "suspended" ||
    entry.status === "expired" ||
    (days != null && days <= 3 && entry.status === "trial") ||
    Boolean(adminActivationTodo) ||
    utilization >= 0.9 ||
    anomalous;
  const updatedAtMs = resolveDirectoryUpdatedAtMs(entry);
  const updatedAtLabel = updatedAtMs
    ? formatTrialApplicationDateTime(new Date(updatedAtMs).toISOString())
    : "时间未知";
  const sortRiskRank = riskTone === "danger" ? 0 : riskTone === "warn" ? 1 : 2;
  const stageLabel = adminActivationTodo ? "待激活" : lifecycle.label;
  const stageTone: PlatformTenantTone = adminActivationTodo ? "warn" : lifecycle.tone;
  return {
    objectKey: platformTenantObjectKey({ tenantId: entry.tenantId }),
    objectType,
    objectTypeLabel,
    isApplication: false,
    tenantId: entry.tenantId,
    applicationId: null,
    name: entry.label,
    identityId: entry.tenantId,
    identityIdLabel: "租户 ID",
    ...(contactName ? { contactName } : {}),
    ...(contactEmail ? { contactEmail } : {}),
    status: entry.status,
    statusLabel: platformEnterpriseStatusLabel(entry.status),
    sourceLabel: platformEnterpriseSourceLabel(entry.createdSource),
    planLabel,
    billingStatus,
    ...(entry.trialEndsAt
      ? { trialEndsLabel: formatTrialApplicationDateTime(entry.trialEndsAt) }
      : {}),
    lifecycleStatus: lifecycle.status,
    lifecycleStatusLabel: lifecycle.label,
    lifecycleTone: lifecycle.tone,
    stageLabel,
    stageTone,
    seatUsageLabel:
      entry.seatQuota > 0
        ? `${entry.seatUsed}/${entry.seatQuota} 席位`
        : `${entry.seatUsed} 已激活`,
    seatUsed: entry.seatUsed,
    seatQuota: entry.seatQuota,
    adoptionLabel: adoption.label,
    adoptionTone: adoption.tone,
    aiActivityLabel: aiActivity.label,
    aiActivityMeta: `${aiActivity.meta} · ${usageCallsLabel}`,
    usersLabel: `${entry.seatUsed} 人`,
    agentsLabel: agentLabel(readModel, entry),
    groupsLabel: groupLabel(readModel, entry),
    runtimesLabel: runtimeLabel(readModel, entry),
    calls7dLabel: usageCallsLabel,
    cost7dLabel: usageCostLabel,
    revenue7dLabel: revenue7dValue > 0 ? formatCost(revenue7dValue) : "待转化",
    commercialMeta:
      revenue7dValue > 0
        ? `成本 ${cost7dValue != null ? formatCost(cost7dValue) : "暂无成本数据"}`
        : "收入待转化",
    usageSummaryLabel: `${entry.seatUsed} 活跃 · ${usageCallsLabel}`,
    usageSummaryMeta:
      entry.seatQuota > 0 ? `${entry.seatUsed}/${entry.seatQuota} 席位` : "席位未配置",
    topModelLabel,
    topAgentLabel: isCurrent
      ? (currentTopAgentLabel ?? "暂无智能体数据")
      : (entry.usageSummary?.topAgentLabel ?? "暂无智能体数据"),
    healthLabel: health.label,
    healthTone: health.tone,
    healthScoreLabel: healthScoreForTenant(health.tone, healthStats),
    incidentLabel: health.incident,
    lifecycleLabel,
    riskLabel,
    riskLevelLabel,
    riskTone,
    pendingTodoLabel,
    recentEventLabel: recentEvent.label,
    recentEventMeta: recentEvent.meta,
    growthLabel: growth.label,
    growthTone: growth.tone,
    isAnomalous: anomalous,
    hasPendingAction,
    updatedAtLabel,
    updatedAtMs,
    sortPendingRank: hasPendingAction ? 0 : 1,
    sortRiskRank,
    dataSources: {
      usage: usageSource,
      adoption: adoptionSource,
      health: healthSource,
    },
    usageStats,
    adoptionStats,
    healthStats,
    enterHref: platformTenantOverviewHref,
    usageHref: platformTenantUsageHref,
    settingsHref: platformTenantControlsHref,
    ...(entry.contact &&
    (entry.contact.contactName || entry.contact.contactEmail || entry.contact.contactPhone)
      ? {
          contact: {
            ...(entry.contact.contactName ? { contactName: entry.contact.contactName } : {}),
            ...(entry.contact.contactEmail ? { contactEmail: entry.contact.contactEmail } : {}),
            ...(entry.contact.contactPhone ? { contactPhone: entry.contact.contactPhone } : {}),
            ...(entry.contact.companySize ? { companySize: entry.contact.companySize } : {}),
            ...(entry.contact.industry ? { industry: entry.contact.industry } : {}),
            ...(entry.contact.status ? { status: entry.contact.status } : {}),
          },
        }
      : {}),
    ...(isCurrent ? { isCurrent: true } : {}),
  };
}

function buildAttentionItems(
  props: Pick<PlatformSurfaceProps, "readModel" | "basePath">,
  items: PlatformTenantDirectoryItemVM[],
): PlatformTenantAttentionVM[] {
  const enterpriseById = new Map(
    props.readModel.enterpriseDirectory.map((entry) => [entry.tenantId, entry] as const),
  );
  const alerts: PlatformTenantAttentionVM[] = [];
  let alertIndex = 0;
  for (const item of items) {
    if (item.isApplication || !item.tenantId) {
      continue;
    }
    const entry = enterpriseById.get(item.tenantId);
    if (item.status === "suspended" || item.status === "expired") {
      alerts.push({
        id: `${item.tenantId}:runtime`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: "critical",
        bucket: "runtime",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 需要平台介入`,
        description: `${item.statusLabel}，当前状态会直接影响运行可用性与商业续期。`,
        impactLabel: "影响：运行可用性与续费决策",
        reasonLabel: "原因：租户状态已进入暂停或到期",
        primaryActionLabel: "查看平台详情",
        primaryHref: item.enterHref,
        secondaryActionLabel: "查看平台设置",
        secondaryHref: item.settingsHref,
      });
    }
    if (
      entry &&
      item.status !== "suspended" &&
      item.status !== "expired" &&
      isHealthSummaryAnomalous(entry)
    ) {
      const errorLabel =
        typeof entry.healthSummary?.errorRate === "number"
          ? `失败率 ${formatPercent(entry.healthSummary.errorRate)}`
          : item.healthLabel;
      alerts.push({
        id: `${item.tenantId}:health-summary`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: entry.healthSummary?.tone === "danger" ? "critical" : "warning",
        bucket: "runtime",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 健康信号异常`,
        description: `${errorLabel}${entry.healthSummary?.incidentLabel ? ` · ${entry.healthSummary.incidentLabel}` : ""}`,
        impactLabel: "影响：运行稳定性与租户体验",
        reasonLabel: "原因：租户健康摘要超出阈值",
        primaryActionLabel: "查看使用分析",
        primaryHref: item.usageHref,
        secondaryActionLabel: "查看平台详情",
        secondaryHref: item.enterHref,
      });
    }
    if (entry && isUsageSummaryAnomalous(entry)) {
      alerts.push({
        id: `${item.tenantId}:cost-summary`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: "warning",
        bucket: "cost",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 成本异常上升`,
        description: `${item.cost7dLabel}，当前成本已达到租户摘要的高成本阈值。`,
        impactLabel: "影响：平台成本结构与商业健康",
        reasonLabel: "原因：租户用量摘要成本偏高",
        primaryActionLabel: "查看使用分析",
        primaryHref: item.usageHref,
        secondaryActionLabel: "查看平台详情",
        secondaryHref: item.enterHref,
      });
    }
    if (item.lifecycleLabel.includes("剩余") && item.lifecycleLabel.includes("3")) {
      alerts.push({
        id: `${item.tenantId}:commercial`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: "warning",
        bucket: "commercial",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 即将到达转化节点`,
        description: `${item.lifecycleLabel}，需要尽快判断是否升级、延长试用或跟进商业转化。`,
        impactLabel: "影响：转化窗口正在收窄",
        reasonLabel: `原因：${item.lifecycleLabel}`,
        primaryActionLabel: "查看使用分析",
        primaryHref: item.usageHref,
        secondaryActionLabel: "查看平台详情",
        secondaryHref: item.enterHref,
      });
    }
    if (
      (entry ? isAdoptionSummaryAnomalous(entry) : item.adoptionTone === "warn") &&
      item.status === "paid"
    ) {
      alerts.push({
        id: `${item.tenantId}:adoption`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: "info",
        bucket: "adoption",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 的 AI 采用度偏低`,
        description: `当前为正式租户，但 ${item.usersLabel} 中的 AI 活跃结构尚未充分建立。`,
        impactLabel: "影响：正式租户价值释放不足",
        reasonLabel: `原因：当前采用度为 ${item.adoptionLabel}`,
        primaryActionLabel: "查看使用分析",
        primaryHref: item.usageHref,
        secondaryActionLabel: "查看平台详情",
        secondaryHref: item.enterHref,
      });
    }
    if (
      (entry
        ? isAdoptionSummaryAnomalous(entry) || item.riskLabel === "使用待提升"
        : item.riskLabel === "使用待提升") &&
      item.status === "trial"
    ) {
      alerts.push({
        id: `${item.tenantId}:trial-adoption`,
        tenantId: item.tenantId,
        tenantName: item.name,
        severity: "warning",
        bucket: "adoption",
        timeLabel: formatRelativeHours(alertIndex++),
        title: `${item.name} 试用活跃度不足`,
        description: `当前试用租户尚未形成明显的 AI 使用深度，转化风险较高。`,
        impactLabel: "影响：试用转化概率偏低",
        reasonLabel: `原因：当前采用度为 ${item.adoptionLabel}`,
        primaryActionLabel: "查看使用分析",
        primaryHref: item.usageHref,
        secondaryActionLabel: "查看平台详情",
        secondaryHref: item.enterHref,
      });
    }
  }
  return alerts.toSorted((left, right) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[left.severity] - severityOrder[right.severity];
  });
}

function buildTenantRecommendations(
  item: PlatformTenantDirectoryItemVM,
  attentionItems: PlatformTenantAttentionVM[],
  basePath: string,
): PlatformTenantOperationItemVM[] {
  // 依据租户当前的运行/商业/采用信号，给出针对该租户的治理建议；
  // 这里替代了原先全局的"平台治理建议"列表，让建议和租户一一对应。
  const recommendations: PlatformTenantOperationItemVM[] = [];
  const tenantAttentions = attentionItems.filter((alert) => alert.tenantId === item.tenantId);
  const hasRuntimeAlert = tenantAttentions.some((alert) => alert.bucket === "runtime");
  const hasCostAlert = tenantAttentions.some((alert) => alert.bucket === "cost");
  const hasCommercialAlert = tenantAttentions.some((alert) => alert.bucket === "commercial");
  const hasAdoptionAlert = tenantAttentions.some((alert) => alert.bucket === "adoption");

  if (hasRuntimeAlert) {
    recommendations.push({
      id: `${item.tenantId}:rec-runtime`,
      title: "为该租户配置运行治理策略",
      subtitle: "聚焦失败率、Runtime 与策略强制，先稳住运行可用性。",
      meta: "高优先",
      tone: "danger",
      href: item.settingsHref,
      actionLabel: "去处理",
    });
  }
  if (hasCostAlert) {
    recommendations.push({
      id: `${item.tenantId}:rec-cost`,
      title: "限制高成本模型并复核预算",
      subtitle: "针对该租户启用模型白名单或降级 fallback，控制成本曲线。",
      meta: item.cost7dLabel,
      tone: "warn",
      href: item.usageHref,
      actionLabel: "查看分析",
    });
  }
  if (hasCommercialAlert || item.lifecycleStatus === "converting") {
    recommendations.push({
      id: `${item.tenantId}:rec-conversion`,
      title: "推进试用转化跟进",
      subtitle: `${item.lifecycleLabel} · 建议在转化窗口期内完成商务沟通。`,
      meta: "本周内",
      tone: "warn",
      href: item.settingsHref,
      actionLabel: "去处理",
    });
  }
  if (hasAdoptionAlert || item.adoptionTone === "warn") {
    recommendations.push({
      id: `${item.tenantId}:rec-adoption`,
      title: "提升 AI 采用度",
      subtitle: "可推送试用引导、激活活跃智能体或安排企业培训以拉升 AI 使用深度。",
      meta: item.adoptionLabel,
      tone: "neutral",
      href: item.usageHref,
      actionLabel: "查看分析",
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      id: `${item.tenantId}:rec-steady`,
      title: "该租户运营状态稳定",
      subtitle: "继续观察成本、调用量与 AI 风险趋势即可。",
      meta: "正常",
      tone: "ok",
      href: item.usageHref,
      actionLabel: "查看分析",
    });
  }
  // 始终引导到平台高级配置，方便维持平台级策略入口。
  recommendations.push({
    id: `${item.tenantId}:rec-advanced`,
    title: "查看平台高级控制",
    subtitle: "Runtime 扩容、限流、强制策略等可在高级控制中执行。",
    meta: "可选",
    tone: "neutral",
    href: pathForTab("platformAdvanced", basePath),
    actionLabel: "前往",
  });
  return recommendations;
}

function buildTenantAlerts(
  item: PlatformTenantDirectoryItemVM,
  attentionItems: PlatformTenantAttentionVM[],
): PlatformTenantOperationItemVM[] {
  // 把全局"高风险/今日关键事件"按租户拆开，仅展示属于当前租户的异常信号。
  const tenantAttentions = attentionItems.filter((alert) => alert.tenantId === item.tenantId);
  if (tenantAttentions.length === 0) {
    return [
      {
        id: `${item.tenantId}:alert-empty`,
        title: "暂无异常",
        subtitle: "该租户最近没有进入治理队列的关键事件。",
        meta: "正常",
        tone: "ok",
      },
    ];
  }
  return tenantAttentions.map((alert) => ({
    id: alert.id,
    title: alert.title,
    subtitle: alert.description,
    meta: alert.timeLabel,
    tone:
      alert.severity === "critical"
        ? ("danger" as const)
        : alert.severity === "warning"
          ? ("warn" as const)
          : ("neutral" as const),
    href: alert.primaryHref,
    actionLabel: alert.primaryActionLabel,
  }));
}

function detailMetric(
  label: string,
  value: string,
  meta?: string,
  tone?: PlatformTenantMetricVM["tone"],
): PlatformTenantMetricVM {
  return { label, value, ...(meta ? { meta } : {}), ...(tone ? { tone } : {}) };
}

function buildPendingItems(item: PlatformTenantDirectoryItemVM): PlatformTenantPendingItemVM[] {
  const items: PlatformTenantPendingItemVM[] = [];
  if (item.isApplication && item.applicationStatus === "pending") {
    items.push({
      id: `${item.objectKey}:approve`,
      title: "试用申请待审批",
      reason: "申请仍在审核队列，批准后才会开通租户。",
      statusLabel: "待审批",
      timeLabel: item.updatedAtLabel,
      tone: "warn",
      actionLabel: "前往审批",
      section: "overview",
      href: item.enterHref,
    });
    return items;
  }
  if (item.status === "suspended") {
    items.push({
      id: `${item.objectKey}:resume`,
      title: "租户已暂停",
      reason: "暂停会阻断租户侧运行可用性，需要恢复或继续冻结决策。",
      statusLabel: "已暂停",
      tone: "danger",
      actionLabel: "前往风险与策略",
      section: "risks",
      href: item.settingsHref,
    });
  }
  if (item.status === "expired") {
    items.push({
      id: `${item.objectKey}:expired`,
      title: "租户已到期",
      reason: "试用或订阅已到期，可延长试用、转化套餐或关闭。",
      statusLabel: "已到期",
      tone: "danger",
      actionLabel: "延长试用",
      section: "billing",
    });
  }
  if (isAdminActivationTodoLabel(item.pendingTodoLabel)) {
    items.push({
      id: `${item.objectKey}:activation`,
      title: item.pendingTodoLabel,
      reason: "企业管理员尚未完成开通激活，平台可重发激活邮件或核对联系人。",
      statusLabel: "待激活",
      tone: "warn",
      actionLabel: "查看概览",
      section: "overview",
      href: item.enterHref,
    });
  }
  if (item.pendingTodoLabel === "试用即将到期") {
    items.push({
      id: `${item.objectKey}:trial-ending`,
      title: "试用即将到期",
      reason: item.lifecycleLabel,
      statusLabel: "转化窗口",
      tone: "warn",
      actionLabel: "延长试用",
      section: "billing",
    });
  }
  if (item.pendingTodoLabel === "席位接近额度") {
    items.push({
      id: `${item.objectKey}:seats`,
      title: "席位接近额度",
      reason: item.seatUsageLabel,
      statusLabel: "容量紧张",
      tone: "warn",
      actionLabel: "前往计费与配额",
      section: "billing",
      href: item.enterHref.replace(/:[^:]+$/, ":billing"),
    });
  }
  if (item.healthTone === "danger" || item.healthTone === "warn") {
    if (!items.some((entry) => entry.title.includes("暂停") || entry.title.includes("到期"))) {
      items.push({
        id: `${item.objectKey}:runtime`,
        title: "Runtime 异常",
        reason: item.incidentLabel || item.healthLabel,
        statusLabel: item.healthLabel,
        tone: item.healthTone,
        actionLabel: "查看使用与资源",
        section: "usage",
        href: item.usageHref,
      });
    }
  }
  if (
    item.riskLabel === "风险需治理" ||
    (typeof item.usageStats.cost7d === "number" && item.usageStats.cost7d >= 500)
  ) {
    items.push({
      id: `${item.objectKey}:cost`,
      title: "成本或调用异常",
      reason: `${item.cost7dLabel} · ${item.riskLabel}`,
      statusLabel: item.riskLevelLabel,
      tone: item.riskTone,
      actionLabel: "查看风险",
      section: "risks",
      href: item.settingsHref,
    });
  }
  return items;
}

function buildApplicationDirectoryItem(
  basePath: string,
  application: ControlUiPlatformTrialApplicationSummary,
): PlatformTenantDirectoryItemVM {
  const objectKey = platformTenantObjectKey({ applicationId: application.id });
  const isPending = application.status === "pending";
  const isRejected = application.status === "rejected";
  const stageLabel = TRIAL_APPLICATION_STATUS_LABEL[application.status];
  const stageTone: PlatformTenantTone = isPending
    ? "warn"
    : isRejected
      ? "danger"
      : application.status === "approved"
        ? "ok"
        : "neutral";
  const updatedAtMs = Date.parse(application.updatedAt || application.createdAt) || 0;
  const enterHref = platformTenantSectionHref(basePath, objectKey, "overview");
  return {
    objectKey,
    objectType: "trial_application",
    objectTypeLabel: "试用申请",
    isApplication: true,
    tenantId: null,
    applicationId: application.id,
    ...(application.enterpriseId ? { linkedTenantId: application.enterpriseId } : {}),
    name: application.companyName,
    identityId: application.id,
    identityIdLabel: "申请编号",
    contactName: application.contactName,
    contactEmail: application.workEmail,
    status: "application",
    statusLabel: stageLabel,
    sourceLabel: "试用申请",
    planLabel: "尚未开通",
    billingStatus: stageLabel,
    lifecycleStatus: isPending ? "pending_review" : isRejected ? "rejected" : "trial",
    lifecycleStatusLabel: stageLabel,
    lifecycleTone: stageTone,
    stageLabel,
    stageTone,
    seatUsageLabel: "尚未开通",
    adoptionLabel: "尚未开通",
    adoptionTone: "neutral",
    aiActivityLabel: "尚未开通",
    aiActivityMeta: "申请阶段无调用",
    usersLabel: `预计 ${application.expectedUsers} 人`,
    agentsLabel: "尚未开通",
    groupsLabel: "尚未开通",
    runtimesLabel: "尚未开通",
    calls7dLabel: "尚未开通",
    cost7dLabel: "尚未开通",
    revenue7dLabel: "尚未开通",
    commercialMeta: "申请阶段",
    usageSummaryLabel: "尚未开通",
    usageSummaryMeta: "申请阶段无资源指标",
    topModelLabel: "尚未开通",
    topAgentLabel: "尚未开通",
    healthLabel: "尚未开通",
    healthTone: "neutral",
    healthScoreLabel: "—",
    incidentLabel: "无运行数据",
    lifecycleLabel: stageLabel,
    riskLabel: isPending ? "待审批" : isRejected ? "已拒绝" : "已处理",
    riskLevelLabel: isPending ? "中" : "低",
    riskTone: stageTone,
    pendingTodoLabel: isPending ? "试用申请待审批" : "无待办",
    recentEventLabel: isPending ? "等待审批" : stageLabel,
    recentEventMeta: formatTrialApplicationDateTime(application.createdAt),
    growthLabel: "—",
    growthTone: "neutral",
    isAnomalous: isPending,
    hasPendingAction: isPending,
    updatedAtLabel: formatTrialApplicationDateTime(application.updatedAt || application.createdAt),
    updatedAtMs,
    sortPendingRank: isPending ? 0 : 1,
    sortRiskRank: isPending ? 1 : 2,
    dataSources: { usage: "pending", adoption: "pending", health: "pending" },
    usageStats: {},
    adoptionStats: {},
    healthStats: {},
    applicationStatus: application.status,
    applicationSummary: application,
    enterHref,
    usageHref: enterHref,
    settingsHref: enterHref,
    contact: {
      contactName: application.contactName,
      contactEmail: application.workEmail,
      ...(application.companySize ? { companySize: application.companySize } : {}),
      ...(application.industry ? { industry: application.industry } : {}),
    },
  };
}

function buildApplicationDetailItem(item: PlatformTenantDirectoryItemVM): PlatformTenantDetailVM {
  const app = item.applicationSummary;
  const pendingItems = buildPendingItems(item);
  return {
    objectKey: item.objectKey,
    isApplication: true,
    tenantId: null,
    applicationId: item.applicationId,
    name: item.name,
    statusLabel: item.statusLabel,
    sourceLabel: item.sourceLabel,
    planLabel: item.planLabel,
    billingStatus: item.billingStatus,
    lifecycleStatusLabel: item.lifecycleStatusLabel,
    riskLevelLabel: item.riskLevelLabel,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    createdAtLabel: app ? formatTrialApplicationDateTime(app.createdAt) : item.updatedAtLabel,
    identityId: item.identityId,
    identityIdLabel: item.identityIdLabel,
    provisionStatusLabel: "尚未开通",
    commercialStatusLabel: item.statusLabel,
    runtimeHealthLabel: "尚未开通",
    runtimeHealthTone: "neutral",
    riskTone: item.riskTone,
    ...(item.linkedTenantId ? { linkedTenantId: item.linkedTenantId } : {}),
    summary: [
      detailMetric("审批状态", item.statusLabel, undefined, item.lifecycleTone),
      detailMetric("联系人", item.contactName ?? "—", item.contactEmail),
      detailMetric("预计人数", item.usersLabel),
      detailMetric("申请时间", item.updatedAtLabel),
    ],
    identityFields: [
      detailMetric("企业名称", item.name),
      detailMetric("申请编号", item.identityId),
      detailMetric("联系人", item.contactName ?? "—"),
      detailMetric("工作邮箱", item.contactEmail ?? "—"),
      detailMetric("行业", app?.industry ?? "未填写"),
      detailMetric("企业规模", app?.companySize ?? "未填写"),
      detailMetric("预计人数", String(app?.expectedUsers ?? "—")),
      detailMetric("使用场景", app?.useCase || "未填写"),
      detailMetric("是否需要演示", app?.needsDemo ? "是" : "否"),
      detailMetric("申请时间", app ? formatTrialApplicationDateTime(app.createdAt) : "—"),
      detailMetric("审批状态", item.statusLabel, undefined, item.lifecycleTone),
    ],
    pendingItems,
    metrics: {
      overview: [],
      usage: [detailMetric("调用与资源", "尚未开通", "申请阶段不提供运行指标")],
      agents: [],
      runtime: [],
      billing: [detailMetric("计费", "尚未开通", "开通后才会产生套餐与配额")],
      risks: [detailMetric("审批风险", item.riskLabel, undefined, item.riskTone)],
      controls: [],
      logs: [
        detailMetric("申请记录", item.statusLabel, item.updatedAtLabel),
        ...(app?.reviewedBy
          ? [detailMetric("处理人", app.reviewedBy, formatTrialApplicationDateTime(app.reviewedAt))]
          : []),
        ...(app?.reviewNote ? [detailMetric("备注", app.reviewNote)] : []),
        ...(app?.rejectionReason ? [detailMetric("拒绝原因", app.rejectionReason)] : []),
      ],
    },
    recommendations: [],
    alerts: pendingItems.map((entry) => ({
      id: entry.id,
      title: entry.title,
      subtitle: entry.reason,
      meta: entry.timeLabel ?? entry.statusLabel,
      tone: entry.tone,
      href: entry.href,
      actionLabel: entry.actionLabel,
    })),
    notes: [
      "试用申请详情仅展示申请与审批信息，不提供调用、资源与计费指标。",
      "批准、拒绝等操作仅在详情页执行。",
    ],
    ...(app ? { applicationSummary: app } : {}),
    actions: [],
  };
}

function buildDetailItem(
  props: Pick<PlatformSurfaceProps, "readModel" | "basePath">,
  item: PlatformTenantDirectoryItemVM,
  recommendations: PlatformTenantOperationItemVM[],
  alerts: PlatformTenantOperationItemVM[],
): PlatformTenantDetailVM {
  if (item.isApplication) {
    return buildApplicationDetailItem(item);
  }
  const { readModel, basePath } = props;
  const currentUsage = currentUsageOverview(readModel);
  const isCurrent = item.tenantId === readModel.currentTenantId;
  const usageSourceLabel =
    item.dataSources.usage === "current_usage"
      ? "当前租户用量聚合"
      : item.dataSources.usage === "tenant_summary"
        ? "租户摘要"
        : item.dataSources.usage === "derived"
          ? "平台推导"
          : "暂无调用数据";
  const adoptionSourceLabel =
    item.dataSources.adoption === "current_usage"
      ? "用量与资源结构"
      : item.dataSources.adoption === "tenant_summary"
        ? "租户采用摘要"
        : item.dataSources.adoption === "derived"
          ? "平台推导"
          : "数据源未连接";
  const healthSourceLabel =
    item.dataSources.health === "current_usage"
      ? "当前租户健康聚合"
      : item.dataSources.health === "tenant_summary"
        ? "租户健康摘要"
        : item.dataSources.health === "derived"
          ? "平台推导"
          : "暂无健康数据";
  const topAgentValue = item.usageStats.topAgentLabel ?? item.topAgentLabel;
  const healthMetaParts = [
    typeof item.healthStats.avgLatencyMs === "number"
      ? `平均 ${Math.round(item.healthStats.avgLatencyMs)} ms`
      : null,
    item.healthStats.incidentLabel ?? null,
  ].filter(Boolean);
  const healthValue =
    typeof item.healthStats.errorRate === "number"
      ? formatPercent(item.healthStats.errorRate)
      : item.dataSources.health === "tenant_summary" &&
          typeof item.healthStats.successRate === "number"
        ? formatPercent(1 - item.healthStats.successRate)
        : "暂无健康数据";
  const provisionStatusLabel = isAdminActivationTodoLabel(item.pendingTodoLabel)
    ? item.pendingTodoLabel
    : "已开通";
  const pendingItems = buildPendingItems(item);
  const settingsHref = pathForTab("platformSystemSettings", basePath);
  return {
    objectKey: item.objectKey,
    isApplication: false,
    tenantId: item.tenantId,
    applicationId: item.applicationId,
    name: item.name,
    statusLabel: item.statusLabel,
    sourceLabel: item.sourceLabel,
    planLabel: item.planLabel,
    billingStatus: item.billingStatus,
    ...(item.trialEndsLabel ? { trialEndsLabel: item.trialEndsLabel } : {}),
    lifecycleStatusLabel: item.lifecycleStatusLabel,
    riskLevelLabel: item.riskLevelLabel,
    contactName: item.contactName ?? item.contact?.contactName,
    contactEmail: item.contactEmail ?? item.contact?.contactEmail,
    adminActivationStatus:
      item.contact?.status ??
      (item.contactName ||
      item.contact?.contactName ||
      item.contactEmail ||
      item.contact?.contactEmail
        ? isAdminActivationTodoLabel(item.pendingTodoLabel)
          ? "pending_activation"
          : "activated"
        : "missing"),
    createdAtLabel: item.updatedAtLabel,
    identityId: item.identityId,
    identityIdLabel: item.identityIdLabel,
    ...(typeof item.seatUsed === "number" ? { seatUsed: item.seatUsed } : {}),
    ...(typeof item.seatQuota === "number" ? { seatQuota: item.seatQuota } : {}),
    provisionStatusLabel,
    commercialStatusLabel: item.statusLabel,
    runtimeHealthLabel: item.healthLabel,
    runtimeHealthTone: item.healthTone,
    riskTone: item.riskTone,
    ...(item.linkedApplicationId ? { linkedApplicationId: item.linkedApplicationId } : {}),
    summary: [
      detailMetric("生命周期", item.lifecycleStatusLabel, item.lifecycleLabel, item.lifecycleTone),
      detailMetric("活跃用户", item.usersLabel, item.seatUsageLabel, item.adoptionTone),
      detailMetric("7 天调用", item.calls7dLabel, usageSourceLabel),
      detailMetric("7 天成本", item.cost7dLabel, item.commercialMeta),
      detailMetric("风险等级", item.riskLevelLabel, item.recentEventLabel, item.riskTone),
    ],
    identityFields: [
      detailMetric("租户 ID", item.identityId),
      detailMetric(
        "管理员",
        item.contactName ?? item.contact?.contactName ?? "未填写",
        [
          item.contactEmail ?? item.contact?.contactEmail,
          item.contact?.status === "pending_activation" ||
          isAdminActivationTodoLabel(item.pendingTodoLabel)
            ? "待激活"
            : item.contact?.status === "activated"
              ? "已激活"
              : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      ),
      detailMetric("套餐", item.planLabel, item.sourceLabel),
      detailMetric("席位", item.seatUsageLabel),
      ...(item.trialEndsLabel
        ? [detailMetric("试用截止", item.trialEndsLabel, undefined, item.lifecycleTone)]
        : []),
      detailMetric("更新时间", item.updatedAtLabel),
    ],
    pendingItems,
    metrics: {
      overview: [
        detailMetric("健康度", item.healthScoreLabel, item.incidentLabel, item.healthTone),
        detailMetric("商业状态", item.revenue7dLabel, item.commercialMeta),
        detailMetric("增长趋势", item.growthLabel, item.recentEventMeta, item.growthTone),
        detailMetric("最近异常", item.recentEventLabel, item.recentEventMeta, item.riskTone),
      ],
      usage: [
        detailMetric("7 天调用量", item.calls7dLabel, usageSourceLabel),
        detailMetric("7 天成本", item.cost7dLabel, usageSourceLabel),
        detailMetric("主要模型", item.topModelLabel, usageSourceLabel),
        detailMetric(
          "成功率",
          item.healthScoreLabel,
          healthMetaParts.join(" · ") || healthSourceLabel,
          item.healthTone,
        ),
      ],
      agents: [
        detailMetric("AI 活跃度", item.aiActivityLabel, adoptionSourceLabel, item.adoptionTone),
        detailMetric(
          "智能体数",
          item.agentsLabel,
          item.dataSources.usage === "pending" ? "租户级数据源未连接" : usageSourceLabel,
        ),
        detailMetric(
          "主要智能体",
          topAgentValue,
          item.dataSources.usage === "pending" ? "暂无智能体排名" : usageSourceLabel,
        ),
        detailMetric(
          "自动化潜力",
          typeof item.adoptionStats.automationTaskCount === "number"
            ? `${item.adoptionStats.automationTaskCount} 个任务`
            : item.status === "paid"
              ? "可扩展"
              : "以试用验证为主",
          item.adoptionStats.note ?? "后续补真实自动化任务数据",
        ),
      ],
      runtime: [
        detailMetric("健康状态", item.healthLabel, item.incidentLabel, item.healthTone),
        detailMetric(
          "运行实例",
          item.runtimesLabel,
          item.dataSources.usage === "pending" ? "租户级数据源未连接" : usageSourceLabel,
        ),
        detailMetric(
          "会话与消息",
          isCurrent ? `${readModel.sessionsCount} 个会话` : "暂无会话明细",
          isCurrent ? `${currentUsage.totalMessages} 条消息` : "租户级运行明细未连接",
        ),
        detailMetric(
          "错误率 / 时延",
          healthValue,
          healthMetaParts.join(" · ") || healthSourceLabel,
          typeof item.healthStats.errorRate === "number"
            ? item.healthStats.errorRate >= 0.08
              ? "danger"
              : item.healthStats.errorRate >= 0.03
                ? "warn"
                : "ok"
            : item.healthTone,
        ),
      ],
      billing: [
        detailMetric("套餐", item.planLabel),
        detailMetric("计费状态", item.billingStatus),
        detailMetric("7 天成本", item.cost7dLabel, usageSourceLabel),
        detailMetric("预计收入", item.revenue7dLabel, item.commercialMeta),
        detailMetric("席位占用", item.seatUsageLabel),
      ],
      risks: [
        detailMetric("风险等级", item.riskLevelLabel, item.riskLabel, item.riskTone),
        detailMetric("最近异常", item.recentEventLabel, item.recentEventMeta, item.riskTone),
        detailMetric("健康信号", item.healthLabel, item.incidentLabel, item.healthTone),
        detailMetric("成本信号", item.cost7dLabel, item.commercialMeta, item.riskTone),
      ],
      controls: [
        detailMetric(
          "生命周期控制",
          item.lifecycleStatusLabel,
          "可执行升级、冻结或恢复策略",
          item.lifecycleTone,
        ),
        detailMetric("配额控制", item.seatUsageLabel, "支持重置配额与限制高成本模型"),
        detailMetric("策略强制", item.topModelLabel, "可强制模型、fallback 与安全策略"),
        detailMetric(
          "商业动作",
          item.status === "trial" ? "转化跟进" : "续费扩容",
          item.status === "trial" ? item.lifecycleLabel : item.commercialMeta,
        ),
      ],
      logs: [
        detailMetric("最近事件", item.recentEventLabel, item.recentEventMeta, item.riskTone),
        detailMetric("策略变更", "暂无操作日志", "后续接入平台操作日志"),
        detailMetric("计费操作", item.billingStatus, item.commercialMeta),
        detailMetric("治理状态", item.riskLevelLabel, item.riskLabel, item.riskTone),
      ],
    },
    notes: [
      "平台端可查看并维护租户管理员联系人；企业内部普通成员与权限仍在企业端管理。",
      "调用量、成本、AI 采用度与健康度优先使用租户摘要，缺失时再降级为平台推导。",
    ],
    recommendations,
    alerts,
    actions: [
      {
        label: item.status === "trial" ? "转化跟进" : "升级套餐",
        section: "billing",
        kind: "primary",
      },
      { label: "查看风险", section: "risks" },
      { label: "配置策略", section: "controls" },
      { label: "前往系统设置", href: settingsHref, externalSettings: true },
      {
        label: item.status === "suspended" ? "恢复租户" : "暂停租户",
        section: "risks",
        kind: "danger",
      },
    ],
  };
}

function sortDirectoryItems(items: PlatformTenantDirectoryItemVM[]) {
  return items.toSorted((left, right) => {
    if (left.sortPendingRank !== right.sortPendingRank) {
      return left.sortPendingRank - right.sortPendingRank;
    }
    if (left.sortRiskRank !== right.sortRiskRank) {
      return left.sortRiskRank - right.sortRiskRank;
    }
    return right.updatedAtMs - left.updatedAtMs;
  });
}

export function buildPlatformTenantsVM(
  props: Pick<PlatformSurfaceProps, "readModel" | "basePath"> & {
    trialApplications?: ControlUiPlatformTrialApplicationSummary[];
    pendingAdminActivations?: ControlUiPlatformPendingAdminActivationSummary[];
  },
  selectedObjectKey: string | null,
  options?: { detailOnly?: boolean },
): PlatformTenantsVM {
  const { readModel, basePath } = props;
  const trialApplications = props.trialApplications ?? [];
  const pendingAdminByEnterpriseId = new Map(
    (props.pendingAdminActivations ?? []).map((row) => [row.enterpriseId, row] as const),
  );
  const currentUsage = currentUsageOverview(readModel);
  const agentDirectory = readModel.agentDirectory ?? [];
  const rawEnterprises =
    readModel.enterpriseDirectory.length > 0
      ? readModel.enterpriseDirectory
      : readModel.tenantDirectory.map((entry) => ({
          tenantId: entry.tenantId,
          label: entry.label,
          status: "trial" as const,
          plan: "trial",
          billingStatus: "pending",
          createdSource: "platform-created" as const,
          seatQuota: 0,
          seatUsed: 0,
          seatsRemaining: 0,
        }));

  // Detail-page fast path: only materialize the selected object (Tab switches
  // must not rebuild the full directory / attention / overview metrics).
  if (options?.detailOnly && selectedObjectKey) {
    const parsed = parsePlatformTenantObjectKey(selectedObjectKey);
    let selected: PlatformTenantDirectoryItemVM | null = null;
    if (parsed?.kind === "tenant") {
      const entry = rawEnterprises.find((item) => item.tenantId === parsed.tenantId);
      if (entry) {
        selected = buildDirectoryItem(
          props,
          entry,
          tenantUsageWeight(entry) || 1,
          pendingAdminByEnterpriseId.get(entry.tenantId) ?? null,
        );
      }
    } else if (parsed?.kind === "application") {
      const application = trialApplications.find((item) => item.id === parsed.applicationId);
      if (application) {
        selected = buildApplicationDirectoryItem(basePath, application);
      }
    }
    return {
      summary: [],
      chips: [],
      overviewItems: [],
      tenantItems: [],
      coverageItems: [],
      trialItems: [],
      overview: { primary: [], secondary: [], quickActions: [] },
      directory: {
        items: selected ? [selected] : [],
        pendingApplicationCount: 0,
        pendingActionCount: 0,
        emptyTitle: "暂无平台租户或试用申请",
        emptyDescription: "请先开通企业租户，或等待企业自助试用申请进入队列。",
      },
      attention: {
        items: [],
        emptyTitle: "暂无待处理的租户异常",
        emptyDescription: "当前没有检测到需要平台人工介入的商业、运行或 AI 采用风险。",
      },
      detail: {
        selectedObjectKey: selected?.objectKey ?? null,
        items: selected ? [buildDetailItem(props, selected, [], [])] : [],
      },
      notes: {
        usageData: "",
        adoptionData: "",
      },
      trends: [],
    };
  }

  const totalWeight = rawEnterprises.reduce((sum, entry) => sum + tenantUsageWeight(entry), 0);
  const tenantItemsRaw = rawEnterprises.map((entry) =>
    buildDirectoryItem(
      props,
      entry,
      totalWeight,
      pendingAdminByEnterpriseId.get(entry.tenantId) ?? null,
    ),
  );
  const tenantById = new Map(
    tenantItemsRaw
      .filter((item) => item.tenantId)
      .map((item) => [item.tenantId as string, item] as const),
  );
  const applicationItems: PlatformTenantDirectoryItemVM[] = [];
  for (const application of trialApplications) {
    if (
      application.status === "converted" &&
      application.enterpriseId &&
      tenantById.has(application.enterpriseId)
    ) {
      const tenant = tenantById.get(application.enterpriseId);
      if (tenant) {
        tenant.linkedApplicationId = application.id;
        tenant.applicationId = application.id;
      }
      continue;
    }
    applicationItems.push(buildApplicationDirectoryItem(basePath, application));
  }
  const directoryItems = sortDirectoryItems([...tenantItemsRaw, ...applicationItems]);
  const attentionItems = buildAttentionItems(props, directoryItems);
  const selected =
    (selectedObjectKey
      ? directoryItems.find((item) => item.objectKey === selectedObjectKey)
      : null) ?? null;
  const activeTenants = rawEnterprises.filter(
    (entry) => (entry.status === "paid" || entry.status === "trial") && entry.seatUsed > 0,
  ).length;
  const anomalousTenants = rawEnterprises.filter((entry) =>
    isTenantAnomalous(
      entry,
      directoryItems.find((item) => item.tenantId === entry.tenantId),
    ),
  ).length;
  const trialTenants = rawEnterprises.filter((entry) => entry.status === "trial").length;
  const convertingTenants = directoryItems.filter(
    (item) => item.lifecycleStatus === "converting",
  ).length;
  const pendingApplicationCount = applicationItems.filter(
    (item) => item.applicationStatus === "pending",
  ).length;
  const pendingActionCount = directoryItems.filter((item) => item.hasPendingAction).length;
  const trialConversionRate = trialTenants > 0 ? convertingTenants / trialTenants : 0;
  const estimatedRevenue = rawEnterprises.reduce(
    (sum, entry) => sum + estimateWeeklyRevenue(entry),
    0,
  );
  const aiCalls = Math.max(currentUsage.sessionCount, Math.round(readModel.totalTokens / 120) || 0);
  const activeAgents = Math.max(
    currentUsage.activeAgentCount,
    directoryItems.reduce(
      (sum, item) =>
        sum +
        (typeof item.usageStats.activeAgentCount === "number"
          ? item.usageStats.activeAgentCount
          : 0),
      0,
    ),
  );
  const primaryMetrics: PlatformTenantMetricVM[] = [
    detailMetric(
      "活跃租户（7d）",
      formatNumber(activeTenants),
      "活跃中",
      activeTenants > 0 ? "ok" : "warn",
    ),
    detailMetric(
      "试用转化率",
      trialTenants > 0 ? formatPercent(trialConversionRate) : "0%",
      `${formatNumber(convertingTenants)} 户待转化`,
      convertingTenants > 0 ? "warn" : "neutral",
    ),
    detailMetric(
      "本周收入（预估）",
      formatCost(estimatedRevenue),
      estimatedRevenue > 0 ? "付费租户估算" : "收入待转化",
      estimatedRevenue > 0 ? "ok" : "neutral",
    ),
    detailMetric(
      "平台成本（7天）",
      formatCost(readModel.totalCost),
      readModel.totalCost > estimatedRevenue && estimatedRevenue > 0 ? "成本需观察" : "成本可控",
      readModel.totalCost > estimatedRevenue && estimatedRevenue > 0 ? "warn" : "neutral",
    ),
    detailMetric(
      "异常租户",
      formatNumber(anomalousTenants),
      anomalousTenants > 0 ? "需处理" : "正常",
      anomalousTenants > 0 ? "danger" : "ok",
    ),
    detailMetric(
      "AI调用总量（7天）",
      formatCompact(aiCalls),
      currentUsage.sessionCount > 0 ? "会话 + 折算" : "按令牌折算",
    ),
  ];
  const secondaryMetrics: PlatformTenantMetricVM[] = [
    detailMetric("Agent 总数", formatNumber(agentDirectory.length), "当前可见"),
    detailMetric("活跃 Agent（7天）", formatNumber(activeAgents), "参与租户服务"),
    detailMetric("协作组总数", formatNumber(readModel.channelIds.length), "租户协作资产"),
    detailMetric(
      "运行 Runtime 总数",
      formatNumber(readModel.runtimeHosts.length),
      `${readModel.sessionsCount} 会话`,
    ),
    detailMetric(
      "模型供给数",
      formatNumber(readModel.configuredModelCount),
      `${readModel.providerIds.length} 个供应商`,
    ),
    detailMetric("知识空间总数", formatNumber(readModel.connectedAccountCount), "平台知识资产"),
  ];
  const tenantItems = directoryItems
    .filter((item) => !item.isApplication)
    .map((item) => ({
      title: item.name,
      subtitle: `${item.statusLabel} · ${item.planLabel} · ${item.seatUsageLabel}`,
      meta: item.riskLabel,
      href: item.enterHref,
    }));
  const coverageItems = directoryItems
    .filter((item) => !item.isApplication)
    .map((item) => ({
      title: item.name,
      subtitle: `${item.healthLabel} · ${item.calls7dLabel} · ${item.agentsLabel}`,
      meta: item.dataSources.usage,
      href: item.usageHref,
    }));
  const trialItems = directoryItems
    .filter(
      (item) =>
        item.status === "trial" ||
        item.status === "expired" ||
        item.objectType === "trial_application" ||
        item.riskTone === "danger",
    )
    .map((item) => ({
      title: item.name,
      subtitle: `${item.lifecycleLabel} · ${item.trialEndsLabel ?? item.billingStatus}`,
      meta: item.riskLabel,
      href: item.settingsHref,
    }));
  const overviewItems = [
    {
      title: "查看平台租户详情",
      subtitle: selected
        ? `打开 ${selected.name} 的平台运营视图`
        : "选择一个企业租户后进入平台视图",
      meta: selected?.statusLabel,
      href: selected?.enterHref,
    },
    {
      title: "查看平台使用分析",
      subtitle: "按租户追踪调用量、成本、模型与健康状态。",
      meta: currentUsage.sessionCount > 0 ? "用量聚合" : "平台推导",
      href: selected?.usageHref ?? pathForTab("platformTenants", basePath),
    },
  ];
  return {
    summary: primaryMetrics.slice(0, 4),
    chips: [
      `${formatNumber(rawEnterprises.length)} 租户`,
      `${formatNumber(activeTenants)} 活跃`,
      `${formatNumber(trialTenants)} 试用`,
      `${formatNumber(pendingApplicationCount)} 待审申请`,
    ],
    overviewItems,
    tenantItems,
    coverageItems,
    trialItems,
    overview: {
      primary: primaryMetrics,
      secondary: secondaryMetrics,
      quickActions: [
        {
          label: "开通企业",
          href: platformCreateTenantHref(basePath),
          kind: "primary",
        },
        {
          label: "查看使用分析",
          href: selected?.usageHref ?? pathForTab("platformTenants", basePath),
        },
      ],
    },
    directory: {
      items: directoryItems,
      pendingApplicationCount,
      pendingActionCount,
      emptyTitle: "暂无平台租户或试用申请",
      emptyDescription: "请先开通企业租户，或等待企业自助试用申请进入队列。",
    },
    attention: {
      items: attentionItems,
      emptyTitle: "暂无待处理的租户异常",
      emptyDescription: "当前没有检测到需要平台人工介入的商业、运行或 AI 采用风险。",
    },
    detail: {
      selectedObjectKey: selected?.objectKey ?? null,
      items: selected
        ? [
            buildDetailItem(
              props,
              selected,
              selected.isApplication
                ? []
                : buildTenantRecommendations(selected, attentionItems, basePath),
              selected.isApplication ? [] : buildTenantAlerts(selected, attentionItems),
            ),
          ]
        : [],
    },
    notes: {
      usageData:
        currentUsage.sessionCount > 0
          ? "当前租户已接入用量聚合；其他租户的调用量、成本与主要模型仍以平台可见数据推导为主，页面以“约”标识近似值。"
          : "当前租户级调用量、成本、主要模型与主要智能体仍以平台可见数据推导为主，后续需要接入真实租户级用量数据。",
      adoptionData:
        "AI 采用当前基于席位活跃、租户状态与平台可见资源做运营推导，后续应补真实活跃智能体、协作组和自动化任务数据。",
    },
    trends: [
      {
        id: "cost",
        label: "成本趋势",
        value: formatCost(readModel.totalCost),
        delta: formatWindowDelta(currentUsage.dailyCost),
        tone: "cost",
      },
      {
        id: "usage",
        label: "调用量趋势",
        value: formatCompact(Math.max(currentUsage.sessionCount, 1)),
        delta: formatWindowDelta(currentUsage.dailyCalls),
        tone: "usage",
      },
      {
        id: "conversion",
        label: "试用转化观察",
        value: formatNumber(trialTenants),
        delta: trialTenants > 0 ? "需跟进" : "正常",
        tone: "conversion",
      },
    ],
  };
}
