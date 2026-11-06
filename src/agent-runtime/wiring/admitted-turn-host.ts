/** Fixed production effects. Binding captures function references only, never run state or decisions. */
import fs from "node:fs";
import { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { noteSkillSmokeClock } from "../../agents/turn-completion/contract.js";
import { recordHonestCapabilityGap } from "../../auto-reply/reply/honest-empty-reply.js";
import { resolveSessionTranscriptPath, updateSessionStore } from "../../config/sessions.js";
import {
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import {
  recordAorRoutingExplanation,
  recordAorRunFeedback,
} from "../../gateway/model-entitlement/aor-feedback.js";
import { consumeCapabilityRoutingResult } from "../../gateway/model-entitlement/capability-entry-consume.js";
import { buildRunContextEstimateParts } from "../../gateway/model-entitlement/run-context-estimate.js";
import { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import { resolvePlatformModelsMode } from "../../gateway/models/platform-models-config.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { registerRunReplyLanguage } from "../../shared/text/run-reply-language.js";
import { ensureChatTurnTaskOutcome } from "../../task-outcome/chat-entry.js";
import {
  assessRunnerTurnBudgetGate,
  chargeModelCallAgainstTip,
} from "../../task-outcome/runtime-from-runner.js";
import { normalizeTaskOutcomeSubjectRef } from "../../task-outcome/subject-ref.js";
import type { AdmittedTurnHost } from "../execution/runner/admitted-turn-host.js";
import { sessionTaskState, resetCorruptedSession } from "../state/index.js";

export function bindAdmittedTurnHost(): AdmittedTurnHost {
  return {
    task: {
      ensureChatTurnTaskOutcome,
      normalizeTaskOutcomeSubjectRef,
      isTaskExecutionBindingCurrent: sessionTaskState.bindingCurrent,
    },
    budget: { assessRunnerTurnBudgetGate, chargeModelCallAgainstTip },
    admission: { tryAcquireEnterpriseAgentRun, releaseEnterpriseAgentRun },
    model: {
      resolveEmbeddedModelGovernance,
      runWithModelFallback,
      buildRunModelSetSnapshot,
      forgetRunModelSet,
      rememberRunModelSet,
      snapshotCreditReportingFromGate,
      consumeCapabilityRoutingResult,
      buildRunContextEstimateParts,
      resolveExecutionRoutingFromCapabilityPlan,
      resolvePlatformModelsMode,
    },
    accounting: { recordCreditUsage, recordAorRoutingExplanation, recordAorRunFeedback },
    observability: {
      noteSkillSmokeClock,
      registerAgentRunContext,
      registerRunReplyLanguage,
      recordHonestCapabilityGap,
    },
    sessions: {
      resetCorruptedSession: (params) =>
        resetCorruptedSession(params, {
          removeTranscript: (sessionId) => fs.unlinkSync(resolveSessionTranscriptPath(sessionId)),
          removeStoredSession: async (storePath, sessionKey) => {
            await updateSessionStore(storePath, (store) => {
              delete store[sessionKey];
            });
          },
          reportError: (message) => defaultRuntime.error(message),
        }),
    },
  };
}
