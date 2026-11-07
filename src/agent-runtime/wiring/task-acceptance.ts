import { readFileWithinRoot } from "../../infra/fs-safe.js";
import type { TaskCompletionBinding } from "../contracts/task.js";
import { evaluateTaskAcceptance } from "../delivery/index.js";
import { sessionTaskState } from "../state/index.js";

/** Bind the shared verifier to the accepted task and workspace, never model completion prose. */
export async function evaluateBoundTaskAcceptance(input: {
  sessionFile?: string;
  workspaceDir?: string;
  runId: string;
  completionBinding?: TaskCompletionBinding;
}) {
  const binding = input.completionBinding;
  if (
    !input.sessionFile ||
    !binding?.taskId ||
    binding.executionAttempt !== input.runId ||
    !binding.deliverableVersion
  ) {
    return undefined;
  }
  const board = sessionTaskState.read(input.sessionFile);
  const task = board.current;
  if (!task?.acceptanceCriteria?.length || task.taskId !== binding.taskId) {
    return undefined;
  }
  const evaluation = await evaluateTaskAcceptance(
    {
      taskId: task.taskId,
      executionAttempt: input.runId,
      deliverableVersion: binding.deliverableVersion,
      criteria: task.acceptanceCriteria,
      checks: task.acceptanceChecks ?? [],
    },
    {
      readArtifact: async (relativePath) => {
        if (!input.workspaceDir) {
          throw new Error("Artifact workspace unavailable");
        }
        return (
          await readFileWithinRoot({
            rootDir: input.workspaceDir,
            relativePath,
            rejectHardlinks: true,
            maxBytes: 1024 * 1024,
          })
        ).buffer;
      },
    },
  );
  // A revision, pause, cancellation or new focus during I/O invalidates this evaluation.
  if (
    sessionTaskState.read(input.sessionFile).writeEpoch !== board.writeEpoch ||
    !sessionTaskState.bindingCurrent(input.sessionFile, binding)
  ) {
    evaluation.status = "pending";
    return { evaluation, evidence: [] };
  }
  const evidence = evaluation.verdicts.flatMap((verdict) =>
    verdict.artifactHash
      ? [
          {
            validatorId: "artifact.text.exact.v1",
            validatorVersion: "1",
            scope: `${task.taskId}:criterion:${verdict.criterion}:${evaluation.criteriaHash}`,
            artifactDigestOrReceiptRef: verdict.artifactHash,
            taskContractVersion: "1",
            executionVersion: binding.deliverableVersion!,
          },
        ]
      : [],
  );
  return { evaluation, evidence };
}
