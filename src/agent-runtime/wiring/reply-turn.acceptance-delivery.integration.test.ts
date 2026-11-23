import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sessionTaskState } from "../state/index.js";
import { admitSessionExecution } from "./execution-admission.js";
import { replyTurnRuntime } from "./reply-turn.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([true, false])(
  "passes real artifact acceptance into terminal delivery (artifact exists: %s)",
  async (exists) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-acceptance-wire-"));
    roots.push(root);
    const sessionFile = path.join(root, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const admitted = await admitSessionExecution(
      sessionFile,
      {
        requestId: "request-a",
        expectedFocusRevision: 0,
        expectedWriteEpoch: 0,
        proposal: {
          lifecycle: "long_task",
          goal: "Create result",
          acceptance: ["Exact bytes"],
          checks: [
            {
              criterion: 0,
              validator: "artifact.text.exact.v1",
              artifact: "result.txt",
              expected: "RESULT",
            },
          ],
        },
      },
      async () => true,
    );
    if (admitted.kind !== "accepted") {
      throw new Error("Admission failed");
    }
    const binding = sessionTaskState.startExecution(sessionFile, admitted.binding, "attempt-a");
    if (!binding) {
      throw new Error("Execution binding missing");
    }
    if (exists) {
      fs.writeFileSync(path.join(root, "result.txt"), "RESULT");
    }
    const before = sessionTaskState.read(sessionFile);
    const contract = {
      id: "execution-v1",
      version: "1",
      kind: "execution" as const,
      requiredValidators: ["artifact.text.exact.v1"],
    };
    const commitOutcome = vi.fn();
    const publishPending = vi.fn();
    // No agentId: this tests acceptance wiring and terminal classification, not transport persistence.
    const acceptanceStatus = await replyTurnRuntime.delivery.prepareVisibleDelivery(
      {},
      {
        sessionFile,
        workspaceDir: root,
        runId: "attempt-a",
        completionBinding: binding,
        contract,
        commitOutcome,
        publishPending,
      },
    );
    expect(acceptanceStatus).toBe(exists ? "passed" : "pending");
    expect(commitOutcome).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        acceptance: { status: exists ? "passed" : "pending" },
        delivery: { status: "pending" },
        acceptanceEvidence: exists
          ? [
              expect.objectContaining({
                validatorId: "artifact.text.exact.v1",
                executionVersion: binding.deliverableVersion,
              }),
            ]
          : [],
      }),
    );
    expect(publishPending).not.toHaveBeenCalled();
    const considerContinuation = vi.fn();
    const onPendingAcceptance = vi.fn();
    const terminalCommit = vi.fn();
    const output = replyTurnRuntime.delivery.completeReplyDelivery(
      {
        kind: "visible",
        taskBound: true,
        payloads: [{ text: "RESULT" }],
        acceptanceStatus,
      },
      {
        runId: "attempt-a",
        language: "en",
        readContract: () => contract,
        commitOutcome: terminalCommit,
        recordEmptyGap: vi.fn(),
        considerContinuation,
        onPendingAcceptance,
        finalize: (payload) => payload,
      },
    );
    expect(considerContinuation).not.toHaveBeenCalled();
    expect(terminalCommit).not.toHaveBeenCalled();
    expect(onPendingAcceptance).toHaveBeenCalledTimes(exists ? 0 : 1);
    expect(output).toEqual({
      text: exists ? "RESULT" : expect.stringContaining("task acceptance is still pending"),
    });
    expect(sessionTaskState.read(sessionFile)).toEqual(before);
  },
);
