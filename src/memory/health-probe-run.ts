import {
  createMemoryHealthProbe,
  listAgentProbeWatchPaths,
  type MemoryHealthProbeAgentInput,
} from "./health-probe.js";
import type {
  GroupOpsStatus,
  HealthReportMeta,
  HealthReportOpsOk,
  HealthReportProbeInvalid,
  MemoryOpsStatus,
} from "./health-report.js";
import { createProbeInvalidReport } from "./health-report.js";

export type RunOpsHealthProbeParams = {
  meta: HealthReportMeta;
  callerScope: HealthReportOpsOk["callerScope"];
  authorizedAgentIds: string[];
  runtime: HealthReportOpsOk["runtime"];
  agents: MemoryHealthProbeAgentInput[];
  groups?: GroupOpsStatus[];
  backend?: string;
};

export type RunOpsHealthProbeResult = HealthReportOpsOk | HealthReportProbeInvalid;

export type RunOpsHealthProbeDeps = {
  createProbe?: typeof createMemoryHealthProbe;
};

/**
 * Run read-only probe with integrity envelope and map mutation failures to probe.invalid.
 */
export async function runOpsHealthProbe(
  params: RunOpsHealthProbeParams,
  deps: RunOpsHealthProbeDeps = {},
): Promise<RunOpsHealthProbeResult> {
  const probe = (deps.createProbe ?? createMemoryHealthProbe)();
  const agentResults: MemoryOpsStatus[] = [];
  const watchPaths = new Set<string>();

  for (const agentInput of params.agents) {
    const resolved = {
      ...agentInput,
      backend: agentInput.backend ?? params.backend ?? "unknown",
    };
    for (const watchPath of listAgentProbeWatchPaths(resolved)) {
      watchPaths.add(watchPath);
    }
  }

  let integrity;
  try {
    integrity = await probe.runIntegrityCheck([...watchPaths], async () => {
      for (const agentInput of params.agents) {
        const result = probe.probeAgent({
          ...agentInput,
          backend: agentInput.backend ?? params.backend ?? "unknown",
        });
        agentResults.push(result.agent);
      }
    });
  } catch (error) {
    return createProbeInvalidReport({
      meta: params.meta,
      callerScope: params.callerScope,
      reason: error instanceof Error ? error.message : String(error),
      probeIntegrity: {
        preSnapshotHash: "",
        postSnapshotHash: "",
        mutationsDetected: true,
      },
    });
  }

  if (integrity.mutationsDetected) {
    return createProbeInvalidReport({
      meta: params.meta,
      callerScope: params.callerScope,
      reason: "Probe integrity check detected filesystem mutations",
      probeIntegrity: integrity,
    });
  }

  return {
    ...params.meta,
    reportKind: "ops",
    status: "ok",
    reasonCode: "probe.ok",
    callerScope: params.callerScope,
    authorizedAgentIds: params.authorizedAgentIds,
    runtime: params.runtime,
    agents: agentResults,
    groups: params.groups ?? [],
    probeIntegrity: {
      ...integrity,
      mutationsDetected: false,
    },
  };
}
