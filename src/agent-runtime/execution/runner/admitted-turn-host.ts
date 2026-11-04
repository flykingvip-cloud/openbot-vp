import type { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import type { runWithModelFallback } from "../../../agents/model-fallback.js";
import type { noteSkillSmokeClock } from "../../../agents/turn-completion/contract.js";
import type { recordHonestCapabilityGap } from "../../../auto-reply/reply/honest-empty-reply.js";
import type { isTaskExecutionBindingCurrent } from "../../../conversation-task/session-task-board.js";
import type {
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
} from "../../../gateway/billing/agent-run-governance.js";
import type { recordCreditUsage } from "../../../gateway/billing/record-credit-usage.js";
import type {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../../gateway/governance/spawn-snapshot-handoff.js";
import type {
  recordAorRoutingExplanation,
  recordAorRunFeedback,
} from "../../../gateway/model-entitlement/aor-feedback.js";
import type { consumeCapabilityRoutingResult } from "../../../gateway/model-entitlement/capability-entry-consume.js";
import type { buildRunContextEstimateParts } from "../../../gateway/model-entitlement/run-context-estimate.js";
import type { resolveExecutionRoutingFromCapabilityPlan } from "../../../gateway/model-entitlement/task-capability-plan.js";
import type { resolvePlatformModelsMode } from "../../../gateway/models/platform-models-config.js";
import type { registerAgentRunContext } from "../../../infra/agent-events.js";
import type { registerRunReplyLanguage } from "../../../shared/text/run-reply-language.js";
import type { ensureChatTurnTaskOutcome } from "../../../task-outcome/chat-entry.js";
import type {
  assessRunnerTurnBudgetGate,
  chargeModelCallAgainstTip,
} from "../../../task-outcome/runtime-from-runner.js";
import type { normalizeTaskOutcomeSubjectRef } from "../../../task-outcome/subject-ref.js";
/** Mandatory internal host capabilities for one admitted turn. Not a plugin/configuration API. */
import type { AgentTurnExecutionParams } from "./turn-contract.js";

export type AdmittedTurnHost = {
  task: {
    ensureChatTurnTaskOutcome: typeof ensureChatTurnTaskOutcome;
    normalizeTaskOutcomeSubjectRef: typeof normalizeTaskOutcomeSubjectRef;
    isTaskExecutionBindingCurrent: typeof isTaskExecutionBindingCurrent;
  };
  budget: {
    assessRunnerTurnBudgetGate: typeof assessRunnerTurnBudgetGate;
    chargeModelCallAgainstTip: typeof chargeModelCallAgainstTip;
  };
  admission: {
    tryAcquireEnterpriseAgentRun: typeof tryAcquireEnterpriseAgentRun;
    releaseEnterpriseAgentRun: typeof releaseEnterpriseAgentRun;
  };
  model: {
    resolveEmbeddedModelGovernance: typeof resolveEmbeddedModelGovernance;
    runWithModelFallback: typeof runWithModelFallback;
    buildRunModelSetSnapshot: typeof buildRunModelSetSnapshot;
    forgetRunModelSet: typeof forgetRunModelSet;
    rememberRunModelSet: typeof rememberRunModelSet;
    snapshotCreditReportingFromGate: typeof snapshotCreditReportingFromGate;
    consumeCapabilityRoutingResult: typeof consumeCapabilityRoutingResult;
    buildRunContextEstimateParts: typeof buildRunContextEstimateParts;
    resolveExecutionRoutingFromCapabilityPlan: typeof resolveExecutionRoutingFromCapabilityPlan;
    resolvePlatformModelsMode: typeof resolvePlatformModelsMode;
  };
  accounting: {
    recordCreditUsage: typeof recordCreditUsage;
    recordAorRoutingExplanation: typeof recordAorRoutingExplanation;
    recordAorRunFeedback: typeof recordAorRunFeedback;
  };
  observability: {
    noteSkillSmokeClock: typeof noteSkillSmokeClock;
    registerAgentRunContext: typeof registerAgentRunContext;
    registerRunReplyLanguage: typeof registerRunReplyLanguage;
    recordHonestCapabilityGap: typeof recordHonestCapabilityGap;
  };
  sessions: {
    resetCorruptedSession: (params: {
      sessionKey: string;
      storePath: string;
      activeSessionStore: NonNullable<AgentTurnExecutionParams["activeSessionStore"]>;
      getActiveSessionEntry: AgentTurnExecutionParams["getActiveSessionEntry"];
    }) => Promise<void>;
  };
};
