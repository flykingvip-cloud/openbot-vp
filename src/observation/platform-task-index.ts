/** Read-only compact task index for platform observation search. No task bodies. */
import type { OpenBotConfig } from "../config/config.js";
import { readExecutorEvidence } from "../executor-evidence/read-port.js";
import { resolveConfiguredTaskOutcomeRoot } from "../task-outcome/reject-result.js";
import { projectDurableExecutorExecutions } from "./durable-execution-projection.js";
import {
  getExecutionEvidenceStore,
  type createExecutionEvidenceStore,
} from "./execution-evidence-store.js";
import { projectExecutionEvidence } from "./execution-projection.js";
import {
  configuredAgentIds,
  scanConfiguredOutcomeTips,
  scopeTenantId,
  type ScannedOutcomeTip,
} from "./platform-window-snapshot.js";
import { assembleObservationSamples } from "./sample-assembler.js";

const MAX_TASK_INDEX = 200;

export type PlatformTaskIndexItem = {
  taskId: string;
  outcomeVersion: number;
  agentId: string;
  decidedAt: string;
  tenantId: string | null;
  coverage: {
    attemptedCount: number;
    fullyLinkedCount: number;
    link: number | null;
  } | null;
};

export type PlatformTaskIndex = {
  ok: true;
  readOnly: true;
  projectedAt: number;
  window: { from: number; to: number };
  authorization: "granted" | "unknown";
  tasks: PlatformTaskIndexItem[];
  agents: { id: string }[];
  truncated: boolean;
};

function taskCoverage(input: {
  tip: ScannedOutcomeTip;
  from: number;
  to: number;
  projectedAt: number;
  cfg: OpenBotConfig;
  executionStore: Pick<ReturnType<typeof createExecutionEvidenceStore>, "query">;
}): PlatformTaskIndexItem["coverage"] {
  const { tip } = input;
  try {
    const memory = projectExecutionEvidence({
      snapshot: input.executionStore.query(tip.record.scope),
      scope: tip.record.scope,
      taskId: tip.record.taskId,
      outcomeVersion: tip.record.outcomeVersion,
    });
    const located = resolveConfiguredTaskOutcomeRoot(input.cfg, tip.agentId);
    const durable =
      located.ok
        ? projectDurableExecutorExecutions({
            view: readExecutorEvidence({
              agentId: tip.agentId,
              scope: tip.record.scope,
              taskId: tip.record.taskId,
              outcomeVersion: tip.record.outcomeVersion,
              storeRoot: located.root,
            }),
            taskId: tip.record.taskId,
            outcomeVersion: tip.record.outcomeVersion,
            from: input.from,
            to: input.to,
          })
        : [];
    const assembled = assembleObservationSamples({
      scope: tip.record.scope,
      from: input.from,
      to: input.to,
      projectedAt: input.projectedAt,
      sourceWatermark: null,
      outcomes: [
        {
          record: tip.record,
          sourceId: "task-outcome-version",
          provenance: "live",
          isCurrentTip: tip.record.isCurrentTip,
        },
      ],
      executions: [...memory.executions, ...durable],
    });
    const attemptedCount = assembled.samples.length;
    if (!attemptedCount) {
      return null;
    }
    const fullyLinkedCount = assembled.samples.filter(
      (sample) => sample.qualification === "fully_linked",
    ).length;
    return {
      attemptedCount,
      fullyLinkedCount,
      link: fullyLinkedCount / attemptedCount,
    };
  } catch {
    return null;
  }
}

export function queryPlatformTaskIndex(input: {
  cfg: OpenBotConfig;
  from: number;
  to: number;
  projectedAt: number;
  agentId?: string | null;
  tenantId?: string | null;
  grantedTenantIds: readonly string[];
  executionStore?: Pick<ReturnType<typeof createExecutionEvidenceStore>, "query">;
}): { ok: false; code: "invalid_window" } | PlatformTaskIndex {
  if (
    ![input.from, input.to, input.projectedAt].every(Number.isFinite) ||
    input.from >= input.to ||
    input.to - input.from > 30 * 86_400_000 ||
    input.to > input.projectedAt
  ) {
    return { ok: false, code: "invalid_window" };
  }
  const agents = configuredAgentIds(input.cfg).map((id) => ({ id }));
  const requestedAgent = input.agentId?.trim() || "";
  const requestedTenant = input.tenantId?.trim() && input.tenantId.trim() !== "all"
    ? input.tenantId.trim()
    : "";
  const granted = new Set(input.grantedTenantIds.map((id) => id.trim()).filter(Boolean));
  if (requestedTenant && !granted.has(requestedTenant)) {
    return {
      ok: true,
      readOnly: true,
      projectedAt: input.projectedAt,
      window: { from: input.from, to: input.to },
      authorization: "unknown",
      tasks: [],
      agents,
      truncated: false,
    };
  }
  const scanned = scanConfiguredOutcomeTips({
    cfg: input.cfg,
    from: input.from,
    to: input.to,
  });
  const executionStore = input.executionStore ?? getExecutionEvidenceStore();
  const matched: ScannedOutcomeTip[] = [];
  for (const tip of scanned.tips) {
    if (requestedAgent && tip.agentId !== requestedAgent) {
      continue;
    }
    const tenantId = scopeTenantId(tip.record.scope);
    if (requestedTenant) {
      if (tenantId !== requestedTenant) {
        continue;
      }
    } else if (tenantId && !granted.has(tenantId)) {
      continue;
    }
    matched.push(tip);
  }
  matched.sort((left, right) => {
    const delta = Date.parse(right.record.decidedAt) - Date.parse(left.record.decidedAt);
    if (delta !== 0) {
      return delta;
    }
    return `${left.agentId}:${left.record.taskId}`.localeCompare(
      `${right.agentId}:${right.record.taskId}`,
    );
  });
  const truncated = matched.length > MAX_TASK_INDEX;
  const page = truncated ? matched.slice(0, MAX_TASK_INDEX) : matched;
  return {
    ok: true,
    readOnly: true,
    projectedAt: input.projectedAt,
    window: { from: input.from, to: input.to },
    authorization: "granted",
    tasks: page.map((tip) => {
      const tenantId = scopeTenantId(tip.record.scope);
      return {
        taskId: tip.record.taskId,
        outcomeVersion: tip.record.outcomeVersion,
        agentId: tip.agentId,
        decidedAt: tip.record.decidedAt,
        tenantId: tenantId && granted.has(tenantId) ? tenantId : null,
        coverage: taskCoverage({
          tip,
          from: input.from,
          to: input.to,
          projectedAt: input.projectedAt,
          cfg: input.cfg,
          executionStore,
        }),
      };
    }),
    agents,
    truncated,
  };
}
