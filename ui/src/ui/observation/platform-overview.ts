/**
 * Display-only helpers for the platform observation first screen.
 * Coverage and heartbeat stay unknown unless the caller supplies a confirmed
 * numerator and a positive denominator. This module never invents grants.
 */
import {
  resolveTenantGrant,
  type TenantGrant,
} from "./access-state.ts";
import type { ObservationRun } from "./model.ts";

export type LinkCoverageInput = {
  fullyLinkedCount?: number | null;
  attemptedCount?: number | null;
  link?: number | null;
};

export type HeartbeatActivityMark = {
  ts: number;
  status?: string;
};

export type HeartbeatTenantInput = {
  tenantId: string;
  scheduledRobotCount?: number | null;
  confirmedRobotCount?: number | null;
  onCadenceRobotCount?: number | null;
  expectedSamples?: number | null;
  observedSamples?: number | null;
};

export type HeartbeatInput = {
  expectedSamples?: number | null;
  observedSamples?: number | null;
  scheduledRobotCount?: number | null;
  confirmedRobotCount?: number | null;
  onCadenceRobotCount?: number | null;
  observedEventCount?: number | null;
  lastEventAt?: number | null;
  events?: readonly HeartbeatActivityMark[] | null;
  tenants?: readonly HeartbeatTenantInput[] | null;
};

export type ConcurrencyInput = {
  activeRuns?: number | null;
  limit?: number | null;
};

export type QuotaInput = {
  remaining?: number | null;
  allowance?: number | null;
};

export type UnmappedEventsInput = {
  count?: number | null;
};

export type PlatformTaskIndexItem = {
  taskId: string;
  outcomeVersion: number;
  agentId: string;
  decidedAt: string;
  tenantId?: string | null;
  coverage?: LinkCoverageInput | null;
};

export type PlatformTaskIndexSnapshot = {
  authorization: "granted" | "unknown";
  window: { from: number; to: number };
  tasks: readonly PlatformTaskIndexItem[];
  agents?: readonly { id: string }[];
  truncated?: boolean;
};

export type PlatformFirstScreenSnapshot = {
  coverage?: LinkCoverageInput | null;
  heartbeat?: HeartbeatInput | null;
  unmappedEvents?: UnmappedEventsInput | null;
  capacity?: {
    concurrency?: ConcurrencyInput | null;
    quota?: QuotaInput | null;
  } | null;
};

export type GrantCensus = {
  granted: number;
  none: number;
  unconfirmed: number;
  total: number;
  /** True when at least one grant was server-confirmed as granted or none. */
  hasConfirmed: boolean;
};

export type FormattedMetric = {
  value: string;
  detail: string;
  note: string;
};

const UNKNOWN_COVERAGE_DETAIL = "关联覆盖率，非业务成功率。分母未供给或为 0 时显示未知，不填 0%。";

export function linkCoverageFraction(coverage: LinkCoverageInput | null | undefined): number | null {
  const formatted = formatLinkCoverage(coverage);
  if (formatted.value === "未知") {
    return null;
  }
  const attempted = coverage?.attemptedCount;
  const linked = coverage?.fullyLinkedCount;
  if (
    attempted == null ||
    linked == null ||
    !Number.isFinite(attempted) ||
    !Number.isFinite(linked) ||
    attempted <= 0
  ) {
    return null;
  }
  return Math.min(1, Math.max(0, linked / attempted));
}

export function formatLinkCoverage(coverage: LinkCoverageInput | null | undefined): FormattedMetric {
  const attempted = coverage?.attemptedCount;
  const linked = coverage?.fullyLinkedCount;
  if (
    attempted == null ||
    !Number.isFinite(attempted) ||
    attempted <= 0 ||
    linked == null ||
    !Number.isFinite(linked) ||
    linked < 0
  ) {
    return {
      value: "未知",
      detail: UNKNOWN_COVERAGE_DETAIL,
      note: "覆盖率必须带分子分母；不足则为未知。",
    };
  }
  const percent = Math.round((linked / attempted) * 1000) / 10;
  return {
    value: `${linked}/${attempted} · ${percent}%`,
    detail: "关联覆盖率，非业务成功率",
    note: "覆盖率必须带分子分母；不足则为未知。",
  };
}

function confirmedCohort(activity: HeartbeatInput | null | undefined): {
  onCadence: number;
  scheduled: number;
} | null {
  const confirmed = activity?.confirmedRobotCount;
  const scheduled =
    confirmed != null && Number.isFinite(confirmed) && confirmed > 0
      ? confirmed
      : activity?.scheduledRobotCount;
  const onCadence = activity?.onCadenceRobotCount;
  if (
    scheduled == null ||
    onCadence == null ||
    !Number.isFinite(scheduled) ||
    !Number.isFinite(onCadence) ||
    scheduled <= 0 ||
    onCadence < 0
  ) {
    return null;
  }
  return { onCadence, scheduled };
}

export function heartbeatFraction(activity: HeartbeatInput | null | undefined): number | null {
  const formatted = formatHeartbeat(activity);
  if (formatted.value === "未知") {
    return null;
  }
  const cohort = confirmedCohort(activity);
  if (cohort) {
    return Math.min(1, Math.max(0, cohort.onCadence / cohort.scheduled));
  }
  const expected = activity?.expectedSamples;
  const observed = activity?.observedSamples;
  if (
    expected == null ||
    observed == null ||
    !Number.isFinite(expected) ||
    !Number.isFinite(observed) ||
    expected <= 0
  ) {
    return null;
  }
  return Math.min(1, Math.max(0, observed / expected));
}

export function formatHeartbeat(activity: HeartbeatInput | null | undefined): FormattedMetric {
  const cohort = confirmedCohort(activity);
  if (cohort) {
    const percent = Math.round((cohort.onCadence / cohort.scheduled) * 1000) / 10;
    return {
      value: `${cohort.onCadence}/${cohort.scheduled} · ${percent}%`,
      detail: "",
      note: "心跳时效 · 不等于窗口覆盖",
    };
  }
  const expected = activity?.expectedSamples;
  const observed = activity?.observedSamples;
  if (
    expected == null ||
    observed == null ||
    !Number.isFinite(expected) ||
    !Number.isFinite(observed) ||
    expected <= 0 ||
    observed < 0
  ) {
    return {
      value: "未知",
      detail: "",
      note: "source_unavailable · 不等于窗口覆盖",
    };
  }
  return {
    value: `${observed}/${expected}`,
    detail: "",
    note: "心跳时效 · 不等于窗口覆盖",
  };
}

export function formatTenantHeartbeat(
  grant: TenantGrant,
  activity?: HeartbeatInput | null,
): string {
  if (grant === "none") {
    return "无授权";
  }
  if (grant === "unknown") {
    return "尚未确认";
  }
  return formatHeartbeat(activity).value;
}

function ratioOrUnknown(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  note: string,
): FormattedMetric {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator < 0
  ) {
    return { value: "未知", detail: "", note };
  }
  return { value: `${numerator}/${denominator}`, detail: "", note };
}

export function formatConcurrency(
  concurrency: ConcurrencyInput | null | undefined,
): FormattedMetric {
  return ratioOrUnknown(concurrency?.activeRuns, concurrency?.limit, "登记并发 · 无分母时未知");
}

export function formatQuota(quota: QuotaInput | null | undefined): FormattedMetric {
  return ratioOrUnknown(quota?.remaining, quota?.allowance, "额度 · 无分母时未知");
}

/**
 * Secondary tenant id for display. When a distinct human label exists, hide the
 * technical id. Show the id only when it is the only label (empty display name).
 */
export function visibleTenantCode(label: string, tenantId: string): string | null {
  const name = label.trim();
  const id = tenantId.trim();
  if (!id) {
    return null;
  }
  if (name) {
    return null;
  }
  return id;
}

export function tenantDisplayName(label: string, tenantId: string): string {
  return label.trim() || tenantId.trim();
}

export function censusTenantGrants(
  entries: readonly { tenantId: string; tenantGrant?: unknown }[],
  grants: Readonly<Record<string, TenantGrant>> | null | undefined,
): GrantCensus {
  let granted = 0;
  let none = 0;
  let unconfirmed = 0;
  for (const entry of entries) {
    const grant = resolveTenantGrant(grants?.[entry.tenantId] ?? entry.tenantGrant);
    if (grant === "granted") {
      granted += 1;
    } else if (grant === "none") {
      none += 1;
    } else {
      unconfirmed += 1;
    }
  }
  return {
    granted,
    none,
    unconfirmed,
    total: entries.length,
    hasConfirmed: granted + none > 0,
  };
}

export function grantFraction(census: GrantCensus): number | null {
  if (!Number.isFinite(census.total) || census.total <= 0) {
    return null;
  }
  const granted = Number.isFinite(census.granted) ? Math.max(0, census.granted) : 0;
  return Math.min(1, Math.max(0, granted / census.total));
}

export function formatGrantCensus(census: GrantCensus): FormattedMetric {
  if (!Number.isFinite(census.total) || census.total <= 0) {
    return {
      value: "未知",
      detail: "",
      note: "无目录分母时未知",
    };
  }
  const granted = Number.isFinite(census.granted) ? Math.max(0, census.granted) : 0;
  const percent = Math.round((granted / census.total) * 1000) / 10;
  return {
    value: `${granted}/${census.total} · ${percent}%`,
    detail: "",
    note: "仅已授权计入分子；未确认不记为无授权",
  };
}

export function formatTenantCoverage(
  grant: TenantGrant,
  coverage?: LinkCoverageInput | null,
): string {
  if (grant === "none") {
    return "无授权";
  }
  if (grant === "unknown") {
    return "尚未确认";
  }
  return formatLinkCoverage(coverage).value;
}

export function tenantGrantNote(grant: TenantGrant, sample: boolean): string {
  if (grant === "none") {
    return "无授权，不返回该租户运行";
  }
  if (grant === "unknown") {
    return "授权尚未确认，不返回该租户运行";
  }
  return sample
    ? "已授权可精确查询 · 样例目录，覆盖率未作为生产健康"
    : "已授权可精确查询；覆盖率未供给则显示未知";
}

export function runExactIdentifiers(run: ObservationRun): string[] {
  const ids = [
    run.id,
    run.clientRunId,
    run.sourceRunId,
    run.admittedWorkId,
    run.scenarioTaskRef,
  ];
  if (run.scenarioTaskRef && run.outcomeRevision) {
    ids.push(`${run.scenarioTaskRef}@${run.outcomeRevision}`);
  }
  return [...new Set(ids.filter((value): value is string => Boolean(value && value.trim())))];
}

/** Exact identifier lookup only. No fuzzy, prefix, or case-folded match. */
export function exactRunMatches(
  runs: readonly ObservationRun[],
  identifier: string,
): ObservationRun[] {
  const needle = identifier.trim();
  if (!needle) {
    return [];
  }
  return runs.filter((run) => runExactIdentifiers(run).includes(needle));
}

export function formatUnmappedEvents(input: UnmappedEventsInput | null | undefined): FormattedMetric {
  const count = input?.count;
  if (count == null || !Number.isFinite(count) || count < 0) {
    return { value: "未知", detail: "", note: "未映射事件计数未供给" };
  }
  if (count === 0) {
    return { value: "0", detail: "当前窗口没有未映射事件", note: "" };
  }
  return { value: String(count), detail: "", note: "" };
}

export function heartbeatActivityMarks(
  activity: HeartbeatInput | null | undefined,
): HeartbeatActivityMark[] {
  const events = activity?.events;
  if (!events) {
    return [];
  }
  return events.filter((event) => Number.isFinite(event.ts)).toSorted((left, right) => left.ts - right.ts);
}

export function formatHeartbeatFreshness(
  activity: HeartbeatInput | null | undefined,
  now = Date.now(),
): string {
  const last = activity?.lastEventAt;
  const count =
    activity?.observedEventCount ??
    (Array.isArray(activity?.events) ? activity.events.length : null);
  if (last == null || !Number.isFinite(last)) {
    if (count === 0) {
      return "暂无心跳记录";
    }
    return count != null && Number.isFinite(count) ? `已观察 ${count}` : "";
  }
  const delta = now - last;
  if (!Number.isFinite(delta) || delta < 0) {
    return count != null && Number.isFinite(count) ? `已观察 ${count}` : "";
  }
  const minutes = Math.floor(delta / 60_000);
  const freshness =
    minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`;
  if (count != null && Number.isFinite(count)) {
    return `${freshness} · ${count} 次`;
  }
  return freshness;
}
