/** Read-only first-screen snapshot. Aggregates a window cohort, never a single task. */
import fs from "node:fs";
import path from "node:path";
import { listAgentEntries, resolveDefaultAgentId } from "../agents/agent-scope.js";
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

function scopeKey(scope: TrustedScope): string {
  return JSON.stringify(
    scope.kind === "enterprise"
      ? [scope.kind, scope.subjectRef, scope.authzScopeRef, scope.tenantId, scope.enterpriseDomainId]
      : [scope.kind, scope.subjectRef, scope.authzScopeRef, scope.personalDomainId],
  );
}

function configuredAgentIds(cfg: OpenBotConfig): string[] {
  const ids = listAgentEntries(cfg)
    .map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
    .filter(Boolean);
  if (ids.length) {
    return [...new Set(ids)];
  }
  const fallback = resolveDefaultAgentId(cfg);
  return fallback ? [fallback] : [];
}

function readCurrentOutcomes(cfg: OpenBotConfig, agentId: string): OutcomeMetadata[] {
  const located = resolveConfiguredTaskOutcomeRoot(cfg, agentId);
  if (!located.ok) {
    return [];
  }
  const tipsDir = path.join(located.root, "tips");
  let names: string[] = [];
  try {
    if (!fs.existsSync(tipsDir)) {
      return [];
    }
    names = fs.readdirSync(tipsDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const rows: OutcomeMetadata[] = [];
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
      rows.push(snap);
    } catch {
      /* skip unreadable tips; never invent records */
    }
  }
  return rows;
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
  heartbeat: {
    expectedPeriodMs: number | null;
    expectedSamples: number | null;
    observedSamples: number | null;
    reasons: string[];
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

export function queryPlatformObservationSnapshot(input: {
  cfg: OpenBotConfig;
  from: number;
  to: number;
  projectedAt: number;
  evidenceLookupWindow?: { from: number; to: number };
  executionStore?: Pick<ReturnType<typeof createExecutionEvidenceStore>, "query" | "queryAll">;
  outcomeSourceStore?: Pick<ReturnType<typeof createOutcomeSourceStore>, "query">;
  activity?: {
    expectedPeriodMs?: number | null;
    expectedSamples?: number | null;
    observedSamples?: number | null;
    reasons: readonly string[];
  } | null;
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
    const decided = Date.parse(record.decidedAt);
    if (!Number.isFinite(decided) || decided < input.from || decided >= input.to) {
      return;
    }
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
  for (const agentId of configuredAgentIds(input.cfg)) {
    const records = readCurrentOutcomes(input.cfg, agentId);
    for (const record of records) {
      addOutcome(agentId, record);
      const memory = projectExecutionEvidence({
        snapshot: executionStore.query(record.scope),
        scope: record.scope,
        taskId: record.taskId,
        outcomeVersion: record.outcomeVersion,
      });
      addExecutions(memory.executions[0]?.scope ?? record.scope, memory.executions);
      addExecutions(
        record.scope,
        durableExecutions({
          cfg: input.cfg,
          agentId,
          record,
          from: lookup.from,
          to: lookup.to,
          read: input.readExecutorEvidence,
        }),
      );
    }
  }
  const linkedIds = new Set(
    [...executionsByScope.values()].flatMap((rows) => rows.map((row) => row.eventId)),
  );
  const live = executionStore.queryAll();
  for (const fact of live.facts) {
    if (fact.occurredAt < lookup.from || fact.occurredAt >= lookup.to) {
      continue;
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
  const activity = input.activity;
  const heartbeat = activity
    ? {
        expectedPeriodMs: activity.expectedPeriodMs ?? null,
        expectedSamples: activity.expectedSamples ?? null,
        observedSamples: activity.observedSamples ?? null,
        reasons: [...activity.reasons],
      }
    : {
        expectedPeriodMs: null,
        expectedSamples: null,
        observedSamples: null,
        reasons: [
          "heartbeat_activity_not_liveness",
          "tenant_attribution_unavailable",
          "expected_period_unknown",
          "platform_activity_unavailable",
        ],
      };
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
      reasons: attemptedCount ? [] : ["no_candidates"],
    },
    heartbeat,
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
