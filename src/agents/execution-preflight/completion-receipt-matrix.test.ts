import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildExecutionPreflight,
  classifyExecutionFailure,
  issueValidationReceipt,
  noteDeliveryArtifactPath,
  registerTrustedValidator,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
} from "./index.js";

const frontmatter = {
  "primary-engine": "sample-engine",
  "required-artifacts": "layout.bin,data.bin",
  "required-validators": "layout-validator,data-validator",
  "delivery-blocked-until": "validator_passed",
  triggers: "sample-task",
  "allowed-tools": "read,write",
};

function build(taskId: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId: "session-matrix",
    message: "run sample-task",
    skills: [{ name: "sample-primary", frontmatter }],
    policyToolNames: ["read", "write"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function writePair(workspace: string) {
  mkdirSync(path.join(workspace, "out"), { recursive: true });
  const layout = Buffer.from("layout-v1");
  const data = Buffer.from("data-v1");
  writeFileSync(path.join(workspace, "out/layout.bin"), layout);
  writeFileSync(path.join(workspace, "out/data.bin"), data);
  return { layout, data };
}

function notePair(taskId: string, attemptNumber: number) {
  noteDeliveryArtifactPath(taskId, attemptNumber, "out/layout.bin");
  noteDeliveryArtifactPath(taskId, attemptNumber, "out/data.bin");
}

function bind(
  taskId: string,
  validatorId: string,
  artifactPath: string,
  bytes: Buffer,
  result?: "passed" | "failed",
) {
  issueValidationReceipt({
    validatorId,
    taskId,
    artifactPath,
    artifactBytes: bytes,
    ...(result ? { result } : {}),
  });
}

describe("validator and artifact matrix", () => {
  beforeEach(() => {
    resetValidationStateForTest();
    resetDeliveryArtifactsForTest();
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
  });

  it("allows delivery only when all four validator-artifact bindings match", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-matrix-"));
    const preflight = build("task-matrix");
    const { layout, data } = writePair(workspace);
    notePair(preflight.taskId, preflight.attemptNumber);
    const bindings = [
      ["layout-validator", "out/layout.bin", layout],
      ["data-validator", "out/layout.bin", layout],
      ["layout-validator", "out/data.bin", data],
      ["data-validator", "out/data.bin", data],
    ] as const;
    for (const [validatorId, artifactPath, bytes] of bindings.slice(0, 3)) {
      bind(preflight.taskId, validatorId, artifactPath, bytes);
      const partial = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
      expect(partial.allowedToDeliver).toBe(false);
      expect(partial.decisionCode).toBe("delivery_blocked");
    }
    bind(preflight.taskId, "data-validator", "out/data.bin", data);
    const allowed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(allowed.allowedToDeliver).toBe(true);
    expect(allowed.decisionCode).toBe("delivery_allowed");
    expect(allowed.gateInput.validatorReceipts).toHaveLength(4);
    expect(allowed.gateInput.validationResult).toBe("passed");
  });

  it("blocks a version mismatch, a failed receipt, a foreign task, and a foreign path", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-matrix-reject-"));
    const preflight = build("task-matrix");
    const { layout, data } = writePair(workspace);
    notePair(preflight.taskId, preflight.attemptNumber);
    bind(preflight.taskId, "layout-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "data-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "layout-validator", "out/data.bin", data);
    bind("other-task", "data-validator", "out/data.bin", data);
    const foreignTask = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(foreignTask.allowedToDeliver).toBe(false);
    expect(foreignTask.decisionCode).toBe("delivery_blocked");

    bind(preflight.taskId, "data-validator", "out/other.bin", data);
    const foreignPath = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(foreignPath.allowedToDeliver).toBe(false);

    bind(preflight.taskId, "data-validator", "out/data.bin", data, "failed");
    const failed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(failed.allowedToDeliver).toBe(false);
    expect(failed.decisionCode).toBe("delivery_blocked");
    expect(failed.gateInput.validationResult).toBe("failed");

    resetValidationStateForTest();
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
    bind(preflight.taskId, "layout-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "data-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "layout-validator", "out/data.bin", data);
    bind(preflight.taskId, "data-validator", "out/data.bin", data);
    registerTrustedValidator({ id: "layout-validator", version: "2" });
    const wrongVersion = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(wrongVersion.allowedToDeliver).toBe(false);
    expect(wrongVersion.decisionCode).toBe("delivery_blocked");
  });

  it("rejects a changed artifact and does not let one artifact's receipt cover the other", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-matrix-change-"));
    const preflight = build("task-matrix");
    const { layout, data } = writePair(workspace);
    notePair(preflight.taskId, preflight.attemptNumber);
    bind(preflight.taskId, "layout-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "data-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "layout-validator", "out/data.bin", layout);
    bind(preflight.taskId, "data-validator", "out/data.bin", layout);
    const wrongBytes = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(wrongBytes.allowedToDeliver).toBe(false);
    expect(wrongBytes.decisionCode).toBe("artifact_changed");

    resetValidationStateForTest();
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
    bind(preflight.taskId, "layout-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "data-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "layout-validator", "out/data.bin", data);
    bind(preflight.taskId, "data-validator", "out/data.bin", data);
    writeFileSync(path.join(workspace, "out/layout.bin"), Buffer.from("layout-v2"));
    const changed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(changed.allowedToDeliver).toBe(false);
    expect(changed.decisionCode).toBe("artifact_changed");
    expect(changed.gateInput.taskId).toBe("task-matrix");
  });

  it("blocks when any required artifact file is absent", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-matrix-missing-"));
    const preflight = build("task-missing-artifact");
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    const layout = Buffer.from("layout-v1");
    writeFileSync(path.join(workspace, "out/layout.bin"), layout);
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, "out/layout.bin");
    bind(preflight.taskId, "layout-validator", "out/layout.bin", layout);
    bind(preflight.taskId, "data-validator", "out/layout.bin", layout);
    const missing = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(missing.allowedToDeliver).toBe(false);
    expect(missing.decisionCode).toBe("delivery_blocked");
    expect(missing.artifactExists).toBe(false);
  });

  it("keeps task, skill, and contract identity across a provider retry", () => {
    const first = build("task-retry");
    const second = build("task-retry");
    expect(second.taskId).toBe(first.taskId);
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
    expect(second.primarySkill).toBe(first.primarySkill);
    expect(second.requiredValidators).toEqual(first.requiredValidators);
    expect(second.requiredArtifacts).toEqual(first.requiredArtifacts);
    expect(classifyExecutionFailure({ message: "gateway timeout" }).failureClass).toBe(
      "transient_transport",
    );
    expect(classifyExecutionFailure({ message: "approval denied" }).retryable).toBe(false);
  });
});
