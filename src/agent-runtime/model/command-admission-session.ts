import type { AgentCommandGovernanceEntry } from "../../commands/agent/types.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  buildRunModelSetSnapshot,
  rememberRunModelSet,
  forgetRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import { createRunAdmissionLease } from "./admission-lease.js";
import {
  acquireAgentCommandCommercialRun,
  releaseAgentCommandCommercialRun,
  type AgentCommandCommercialGateResult,
} from "./command-commercial-gate.js";
import { resolveAgentCommandModelGovernance } from "./command-governance.js";
/** Serial command admission lifetime; no inference or task creation. */
export function createCommandAdmissionSession(params: {
  runId: string;
  isSubagentLane: boolean;
  identity?: ExecutionIdentityContext;
  entry?: AgentCommandGovernanceEntry;
}) {
  let gate: AgentCommandCommercialGateResult | undefined;
  let routing: ReturnType<typeof resolveExecutionRoutingFromCapabilityPlan> | undefined;
  const lease = createRunAdmissionLease({
    acquire: async (input: Parameters<typeof acquireAgentCommandCommercialRun>[0]) => {
      const result = await acquireAgentCommandCommercialRun(input);
      return { acquired: result.status === "acquired", gate: result };
    },
    release: () => {
      void releaseAgentCommandCommercialRun(params.runId);
    },
    forgetSnapshot: () => forgetRunModelSet(params.runId),
  });
  return {
    async acquire(input: Parameters<typeof acquireAgentCommandCommercialRun>[0]) {
      gate = (await lease.acquire(input)).gate;
      if (gate.status === "acquired" && !params.isSubagentLane) {
        const governance = resolveAgentCommandModelGovernance(gate, process.env, params.identity);
        routing = resolveExecutionRoutingFromCapabilityPlan({
          allowlist: governance.entitlementAllowlist,
          preferredModelOrder: gate.modelGate?.preferredModelOrder,
          capabilityPlan: gate.modelGate?.capabilityPlan,
        });
        const snapshot = buildRunModelSetSnapshot({
          runId: params.runId,
          allowlist: routing.allowlist,
          governanceMode: governance.governanceMode,
          commercialAuthorizationId: governance.governanceContext?.commercialAuthorizationId,
          tenantId: governance.governanceContext?.tenantId,
          actorId: governance.governanceContext?.actorId,
          preferredModelOrder: routing.preferredModelOrder,
          creditReporting: snapshotCreditReportingFromGate(gate),
        });
        if (snapshot) {
          rememberRunModelSet(params.runId, snapshot);
        }
      }
      return gate;
    },
    fallbackGovernance() {
      return {
        ...resolveAgentCommandModelGovernance(
          params.isSubagentLane ? undefined : gate,
          process.env,
          params.identity,
          params.entry,
        ),
        ...(routing?.allowlist !== undefined ? { entitlementAllowlist: routing.allowlist } : {}),
        ...(routing?.preferredModelOrder
          ? { preferredModelOrder: routing.preferredModelOrder }
          : {}),
      };
    },
    dispose: () => lease.dispose(),
  };
}
