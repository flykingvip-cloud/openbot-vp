/** Read-only first-screen snapshot. Aggregates a window cohort, never a single task. */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { readExecutorEvidence } from "../executor-evidence/read-port.js";
import { resolveConfiguredTaskOutcomeRoot } from "../task-outcome/reject-result.js";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { projectDurableExecutorExecutions } from "./durable-execution-projection.js";
import {
  getExecutionEvidenceStore,
  type createExecutionEvidenceStore,
} from "./execution-evidence-store.js";
import { projectExecutionEvidence } from "./execution-projection.js";
import {
  projectOutcomeRecordMetadata,
  type OutcomeMetadata,
} from "./outcome-reader.js";
import { getOutcomeSourceStore, type createOutcomeSourceStore } from "./outcome-source.js";
import {
  assembleObservationSamples,
  type ExecutionEvidence,
  type OutcomeEvidence,
} from "./sample-assembler.js";

export function scopeKey(scope: TrustedScope): string {
  return JSON.stringify(
    scope.kind === "enterprise"
      ? [scope.kind, scope.subjectRef, scope.authzScopeRef, scope.tenantId, scope.enterpriseDomainId]
      : [scope.kind, scope.subjectRef, scope.authzScopeRef, scope.personalDomainId],
  );
}

export function configuredAgentIds(cfg: OpenBotConfig): string[] {
  return [...new Set(listAgentIds(cfg).map((id) => id.trim()).filter(Boolean))];
}

export function scopeTenantId(scope: TrustedScope): string | null {
  return scope.kind === "enterprise" && scope.tenantId.trim() ? scope.tenantId.trim() : null;
}

export type ScannedOutcomeTip = {
  agentId: string;
  record: OutcomeMetadata;
};

export type OutcomeScanStats = {
  configuredAgents: number;
  resolvedRoots: number;
  missingRoots: number;
  tipFiles: number;
  acceptedTips: number;
  inWindow: number;
  outsideWindow: number;
};

export function scanConfiguredOutcomeTips(input: {
  cfg: OpenBotConfig;
  from: number;
  to: number;
}): { tips: ScannedOutcomeTip[]; stats: OutcomeScanStats } {
  const agentIds = configuredAgentIds(input.cfg);
  const stats: OutcomeScanStats = {
    configuredAgents: agentIds.length,
    resolvedRoots: 0,
    missingRoots: 0,
    tipFiles: 0,
    acceptedTips: 0,
    inWindow: 0,
    outsideWindow: 0,
  };
  const tips: ScannedOutcomeTip[] = [];
  for (const agentId of agentIds) {
    const located = resolveConfiguredTaskOutcomeRoot(input.cfg, agentId);
    if (!located.ok) {
      stats.missingRoots += 1;
      continue;
    }
    stats.resolvedRoots += 1;
    const tipsDir = path.join(located.root, "tips");
    let names: string[] = [];
    try {
      if (!fs.existsSync(tipsDir)) {
        continue;
      }
      names = fs.readdirSync(tipsDir).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    stats.tipFiles += names.length;
    for (const name of names) {
      try {
        const tipRaw: unknown = JSON.parse(fs.readFileSync(path.join(tipsDir, name), "utf8"));
        const tip = projectOutcomeRecordMetadata(tipRaw, { isCurrentTip: true });
        if (!tip) {
          continue;
        }
        const versionPath = path.join(
          located.root,
          "versions",
          `${boundedOutcomePathSegment(tip.taskId)}__v${tip.outcomeVersion}.json`,
        );
        if (!fs.existsSync(versionPath)) {
          continue;
        }
        const snap = projectOutcomeRecordMetadata(JSON.parse(fs.readFileSync(versionPath, "utf8")), {
          isCurrentTip: true,
        });
        if (
          !snap ||
          snap.taskId !== tip.taskId ||
          snap.outcomeVersion !== tip.outcomeVersion ||
          scopeKey(snap.scope) !== scopeKey(tip.scope)
        ) {
          continue;
        }
        stats.acceptedTips += 1;
        const decided = Date.parse(snap.decidedAt);
        if (!Number.isFinite(decided) || decided < input.from || decided >= input.to) {
          stats.outsideWindow += 1;
          continue;
        }
        stats.inWindow += 1;
        tips.push({ agentId, record: snap });
      } catch {
        /* skip unreadable tips; never invent records */
      }
    }
  }
  return { tips, stats };
}

export function coverageReasonsFromScan(stats: OutcomeScanStats, attemptedCount: number): string[] {
  if (attemptedCount > 0) {
    return [];
  }
  const reasons = ["no_candidates"];
  if (stats.configuredAgents > 0 && stats.resolvedRoots === 0) {
    reasons.push("configured_outcome_store_not_found");
  }
  if (stats.acceptedTips > 0 && stats.inWindow === 0) {
    reasons.push("tips_outside_window");
  }
  if (stats.tipFiles > 0 && stats.acceptedTips === 0) {
    reasons.push("tips_unreadable");
  }
  return reasons;
}

function durableExecutions(input: {
  cfg: OpenBotConfig;
  agentId: string;
  record: OutcomeMetadata;
  from: number;
  to: number;
  read?: typeof readExecutorEvidence;
}): ExecutionEvidence[] {
  const located = resolveConfiguredTaskOutcomeRoot(input.cfg, input.agentId);
  if (!located.ok) {
    return [];
  }
  try {
    const view = (input.read ?? readExecutorEvidence)({
      agentId: input.agentId,
      scope: input.record.scope,
      taskId: input.record.taskId,
      outcomeVersion: input.record.outcomeVersion,
      storeRoot: located.root,
    });
    return projectDurableExecutorExecutions({
      view,
      taskId: input.record.taskId,
      outcomeVersion: input.record.outcomeVersion,
      from: input.from,
      to: input.to,
    });
  } catch {
    return [];
  }
}

export type HeartbeatActivityMark = {
  ts: number;
  status: string;
};

export type PlatformHeartbeatSnapshot = {
  expectedPeriodMs: number | null;
  expectedSamples: number | null;
  observedSamples: number | null;
  observedEventCount: number;
  lastEventAt: number | null;
  events: HeartbeatActivityMark[];
  reasons: string[];
};

export type PlatformWindowSnapshot = {
  ok: true;
  readOnly: true;
  projectedAt: number;
  window: { from: number; to: number };
  coverage: {
    attemptedCount: number;
    fullyLinkedCount: number;
    invalidCount: number;
    link: number | null;
    reasons: string[];
  };
  heartbeat: PlatformHeartbeatSnapshot;
  unmappedEvents: {
    count: number;
  };
  capacity: {
    concurrency: {
      activeRuns: number | null;
      limit: number | null;
      remaining: number | null;
      reasons: string[];
    };
    quota: {
      remaining: number | null;
      allowance: number | null;
      reasons: string[];
    };
  };
};

export type HeartbeatActivityInput = {
  expectedPeriodMs?: number | null;
  expectedSamples?: number | null;
  observedSamples?: number | null;
  events?: readonly { ts: number; status?: string }[];
  reasons: readonly string[];
} | null;

export function projectHeartbeatSnapshot(
  activity: HeartbeatActivityInput,
  window: { from: number; to: number },
): PlatformHeartbeatSnapshot {
  const marks = (activity?.events ?? [])
    .filter(
      (event) =>
        Number.isFinite(event.ts) && event.ts >= window.from && event.ts < window.to,
    )
    .map((event) => ({
      ts: event.ts,
      status: typeof event.status === "string" && event.status.trim() ? event.status : "unknown",
    }))
    .toSorted((left, right) => left.ts - right.ts);
  const lastEventAt = marks.length ? marks[marks.length - 1].ts : null;
  if (!activity) {
    return {
      expectedPeriodMs: null,
      expectedSamples: null,
      observedSamples: null,
      observedEventCount: marks.length,
      lastEventAt,
      events: marks,
      reasons: [
        "heartbeat_activity_not_liveness",
        "tenant_attribution_unavailable",
        "expected_period_unknown",
        "platform_activity_unavailable",
      ],
    };
  }
  return {
    expectedPeriodMs: activity.expectedPeriodMs ?? null,
    expectedSamples: activity.expectedSamples ?? null,
    observedSamples: activity.observedSamples ?? null,
    observedEventCount: marks.length,
    lastEventAt,
    events: marks,
    reasons: [...activity.reasons],
  };
}

export function queryPlatformObservationSnapshot(input: {
  cfg: OpenBotConfig;
  from: number;
  to: number;
  projectedAt: number;
  evidenceLookupWindow?: { from: number; to: number };
  executionStore?: Pick<ReturnType<typeof createExecutionEvidenceStore>, "query" | "queryAll">;
  outcomeSourceStore?: Pick<ReturnType<typeof createOutcomeSourceStore>, "query">;
  activity?: HeartbeatActivityInput;
  readExecutorEvidence?: typeof readExecutorEvidence;
}): { ok: false; code: "invalid_window" | "invalid_evidence_lookup_window" } | PlatformWindowSnapshot {
  if (
    ![input.from, input.to, input.projectedAt].every(Number.isFinite) ||
    input.from >= input.to ||
    input.to - input.from > 30 * 86_400_000 ||
    input.to > input.projectedAt
  ) {
    return { ok: false, code: "invalid_window" };
  }
  const lookup = input.evidenceLookupWindow ?? { from: input.from, to: input.to };
  if (
    ![lookup.from, lookup.to].every(Number.isFinite) ||
    lookup.from > input.from ||
    lookup.to < input.to ||
    lookup.from >= lookup.to ||
    lookup.to - lookup.from > 30 * 86_400_000 ||
    lookup.to > input.projectedAt
  ) {
    return { ok: false, code: "invalid_evidence_lookup_window" };
  }
  const executionStore = input.executionStore ?? getExecutionEvidenceStore();
  const outcomeSources = input.outcomeSourceStore ?? getOutcomeSourceStore();
  const outcomesByScope = new Map<string, { scope: TrustedScope; outcomes: OutcomeEvidence[] }>();
  const executionsByScope = new Map<string, ExecutionEvidence[]>();
  const addOutcome = (agentId: string, record: OutcomeMetadata) => {
    const key = scopeKey(record.scope);
    const bucket = outcomesByScope.get(key) ?? { scope: record.scope, outcomes: [] };
    const source = outcomeSources.query(agentId, record);
    bucket.outcomes.push({
      record,
      sourceId: "task-outcome-version",
      provenance: source.provenance,
      isCurrentTip: record.isCurrentTip,
    });
    outcomesByScope.set(key, bucket);
  };
  const addExecutions = (scope: TrustedScope, rows: ExecutionEvidence[]) => {
    if (!rows.length) {
      return;
    }
    const key = scopeKey(scope);
    executionsByScope.set(key, [...(executionsByScope.get(key) ?? []), ...rows]);
  };
  const scanned = scanConfiguredOutcomeTips({
    cfg: input.cfg,
    from: input.from,
    to: input.to,
  });
  for (const tip of scanned.tips) {
    addOutcome(tip.agentId, tip.record);
    const memory = projectExecutionEvidence({
      snapshot: executionStore.query(tip.record.scope),
      scope: tip.record.scope,
      taskId: tip.record.taskId,
      outcomeVersion: tip.record.outcomeVersion,
    });
    addExecutions(memory.executions[0]?.scope ?? tip.record.scope, memory.executions);
    addExecutions(
      tip.record.scope,
      durableExecutions({
        cfg: input.cfg,
        agentId: tip.agentId,
        record: tip.record,
        from: lookup.from,
        to: lookup.to,
        read: input.readExecutorEvidence,
      }),
    );
  }
  const linkedIds = new Set(
    [...executionsByScope.values()].flatMap((rows) => rows.map((row) => row.eventId)),
  );
  const live = executionStore.queryAll();
  let unmappedEventCount = 0;
  for (const fact of live.facts) {
    if (fact.occurredAt < lookup.from || fact.occurredAt >= lookup.to) {
      continue;
    }
    if (!scopeTenantId(fact.scope)) {
      unmappedEventCount += 1;
    }
    const receipt = live.links.find((link) => link.eventIds.includes(fact.eventId));
    const eventId = receipt ? fact.eventId : fact.eventId;
    if (linkedIds.has(eventId) && receipt) {
      continue;
    }
    if (receipt) {
      const projected = projectExecutionEvidence({
        snapshot: live,
        scope: receipt.scope,
        taskId: receipt.taskId,
        outcomeVersion: receipt.outcomeVersion,
      });
      const fresh = projected.executions.filter((row) => !linkedIds.has(row.eventId));
      addExecutions(receipt.scope, fresh);
      for (const row of fresh) {
        linkedIds.add(row.eventId);
      }
      continue;
    }
    if (linkedIds.has(fact.eventId)) {
      continue;
    }
    linkedIds.add(fact.eventId);
    addExecutions(fact.scope, [
      {
        sourceId: JSON.stringify(["runtime_execution", live.processId, live.epoch]),
        eventId: fact.eventId,
        occurredAt: new Date(fact.occurredAt).toISOString(),
        provenance: fact.source?.provenance ?? "unknown",
        collector: fact.source?.collector ?? "unknown",
        runId: fact.runId,
        scope: fact.scope,
        taskId: fact.taskId,
      },
    ]);
  }
  const scopes = new Set([...outcomesByScope.keys(), ...executionsByScope.keys()]);
  const samples = [...scopes].toSorted().flatMap((key) => {
    const bucket = outcomesByScope.get(key);
    const scope = bucket?.scope ?? executionsByScope.get(key)?.[0]?.scope;
    if (!scope) {
      return [];
    }
    return assembleObservationSamples({
      scope,
      from: input.from,
      to: input.to,
      projectedAt: input.projectedAt,
      evidenceLookupWindow: lookup,
      sourceWatermark: null,
      outcomes: bucket?.outcomes ?? [],
      executions: executionsByScope.get(key) ?? [],
    }).samples;
  });
  const fullyLinkedCount = samples.filter((sample) => sample.qualification === "fully_linked").length;
  const invalidCount = samples.filter((sample) => sample.qualification === "invalid").length;
  const attemptedCount = samples.length;
  return {
    ok: true,
    readOnly: true,
    projectedAt: input.projectedAt,
    window: { from: input.from, to: input.to },
    coverage: {
      attemptedCount,
      fullyLinkedCount,
      invalidCount,
      link: attemptedCount ? fullyLinkedCount / attemptedCount : null,
      reasons: coverageReasonsFromScan(scanned.stats, attemptedCount),
    },
    heartbeat: projectHeartbeatSnapshot(input.activity ?? null, { from: input.from, to: input.to }),
    unmappedEvents: { count: unmappedEventCount },
    capacity: {
      concurrency: {
        activeRuns: null,
        limit: null,
        remaining: null,
        reasons: ["platform_concurrency_denominator_unavailable"],
      },
      quota: {
        remaining: null,
        allowance: null,
        reasons: ["authoritative_balance_not_collected"],
      },
    },
  };
}
