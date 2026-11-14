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

export type HeartbeatInput = {
  expectedSamples?: number | null;
  observedSamples?: number | null;
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

export function formatHeartbeat(activity: HeartbeatInput | null | undefined): FormattedMetric {
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
      detail: "expectedSamples 未知 / observedSamples 未知",
      note: "source_unavailable · 不等于窗口覆盖",
    };
  }
  return {
    value: `${observed}/${expected}`,
    detail: `expectedSamples ${expected} / observedSamples ${observed}`,
    note: "心跳时效 · 不等于窗口覆盖",
  };
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

export function formatGrantCensus(census: GrantCensus): FormattedMetric {
  if (!census.hasConfirmed) {
    return {
      value: "尚未确认",
      detail: census.total > 0 ? `目录 ${census.total} · 授权尚未确认` : "授权结果尚未确认",
      note: "不把未确认计为无授权",
    };
  }
  const parts = [`${census.granted} 已授权`];
  if (census.none > 0) {
    parts.push(`${census.none} 无授权`);
  }
  if (census.unconfirmed > 0) {
    parts.push(`${census.unconfirmed} 尚未确认`);
  }
  return {
    value: parts.join(" / "),
    detail: `目录分母 ${census.total}（仅已确认授权计数）`,
    note: "仅已授权租户可被精确查询；未确认不记为无授权",
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
