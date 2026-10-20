/**
 * supervisor/escalator.ts — human handoff via support-case (M2, Task 2.3).
 */

import { createSupportCase } from "../../support-cases/store.js";
import { stopReasonLabel } from "./retry.js";
import type { SupervisedTask } from "./types.js";

export interface EscalatorPort {
  escalate(task: SupervisedTask, reason: string): Promise<{ ref: string }>;
}

function buildContextBundle(task: SupervisedTask, reason: string) {
  const last = task.iterations.at(-1);
  const evidence: string[] = [reason];
  if (last?.validation) {
    for (const step of last.validation.steps.filter((s) => !s.ok)) {
      evidence.push(
        `${step.id}: exit=${step.exitCode ?? "null"}${step.stderrSummary ? ` — ${step.stderrSummary}` : ""}`,
      );
    }
  }
  return {
    userMessage: task.goal,
    recentExecutionSummary: `state=${task.state} iterations=${task.iterations.length} workspace=${task.workspace.root}`,
    errorEvidence: evidence,
  };
}

export function createSupportCaseEscalatorPort(): EscalatorPort {
  return {
    async escalate(task, reason) {
      const userId = task.userId?.trim() || "system";
      const created = await createSupportCase({
        userId,
        tenantId: task.tenantId,
        category: "governance",
        userProblem: task.goal,
        daibaiSummary: reason,
        relatedEntities: task.agentId ? { agentId: task.agentId } : undefined,
        contextBundle: buildContextBundle(task, reason),
      });
      return { ref: created.caseId };
    },
  };
}

export function escalationReasonForStop(state: SupervisedTask["state"]): string {
  return stopReasonLabel(state);
}
