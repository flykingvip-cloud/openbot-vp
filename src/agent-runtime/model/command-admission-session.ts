import type { OpenBotConfig } from "../../config/config.js";
import { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  buildRunModelSetSnapshot,
  rememberRunModelSet,
  forgetRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import { resolvePlatformModelsMode } from "../../gateway/models/platform-models-config.js";
import type { AgentCommandGovernanceEntry } from "../contracts/command.js";
import { createCommandModelSession, type CommandModelSessionPorts } from "./authorized-session.js";
import {
  acquireAgentCommandCommercialRun,
  releaseAgentCommandCommercialRun,
} from "./command-commercial-gate.js";
import { resolveAgentCommandModelGovernance } from "./command-governance.js";

/** Serial command admission lifetime; delegates session state, snapshot, infer & usage to authorized-session. */
export function createCommandAdmissionSession(
  params: {
    runId: string;
    isSubagentLane: boolean;
    identity?: ExecutionIdentityContext;
    entry?: AgentCommandGovernanceEntry;
    config?: OpenBotConfig;
  },
  ports?: {
    runWithModelFallback?: CommandModelSessionPorts["model"]["runWithModelFallback"];
  },
) {
  return createCommandModelSession(params, {
    accounting: { recordCreditUsage },
    admission: {
      acquireAgentCommandCommercialRun: async (input) =>
        await acquireAgentCommandCommercialRun(input),
      releaseAgentCommandCommercialRun,
    },
    model: {
      resolveAgentCommandModelGovernance,
      resolveExecutionRoutingFromCapabilityPlan,
      buildRunModelSetSnapshot,
      rememberRunModelSet,
      forgetRunModelSet,
      snapshotCreditReportingFromGate,
      resolvePlatformModelsMode,
      runWithModelFallback:
        ports?.runWithModelFallback ??
        (() => {
          throw new Error("Command model session requires runWithModelFallback port");
        }),
    },
  });
}
