import { expect, it, vi } from "vitest";
import { evaluateTaskAcceptance } from "./criteria.js";
const input = {
  taskId: "task-a",
  executionAttempt: "run-a",
  deliverableVersion: "v1",
  criteria: ["The file contains exactly the requested UTF-8 bytes"],
  checks: [
    {
      criterion: 0,
      validator: "artifact.text.exact.v1" as const,
      artifact: "result.txt",
      expected: "RESULT",
    },
  ],
};
it("evaluates the captured contract even if the caller mutates its input during a read", async () => {
  const plan = { ...input, checks: input.checks.map((check) => ({ ...check })) };
  const result = await evaluateTaskAcceptance(plan, {
    readArtifact: async () => {
      plan.checks[0].expected = "CHANGED";
      return Buffer.from("CHANGED");
    },
  });
  expect(result.status).toBe("failed");
});
it("rejects an extra newline instead of accepting a model completion claim", async () => {
  const readArtifact = vi.fn(async () => Buffer.from("RESULT\n"));
  const result = await evaluateTaskAcceptance(input, { readArtifact });
  expect(result.status).toBe("failed");
  expect(result.verdicts[0]).toMatchObject({
    criterion: 0,
    status: "failed",
    reason: "bytes_mismatch",
  });
  expect(readArtifact).toHaveBeenCalledExactlyOnceWith("result.txt");
});
it("passes exact bytes and binds evidence to the original task and artifact version", async () => {
  const result = await evaluateTaskAcceptance(input, {
    readArtifact: async () => Buffer.from("RESULT"),
  });
  expect(result).toMatchObject({
    taskId: "task-a",
    executionAttempt: "run-a",
    deliverableVersion: "v1",
    status: "passed",
  });
  expect(result.criteriaHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.verdicts[0].artifactHash).toMatch(/^[a-f0-9]{64}$/);
});
it("leaves uncovered semantic criteria pending instead of waiving them", async () => {
  const result = await evaluateTaskAcceptance(
    { ...input, criteria: [...input.criteria, "Sources are authentic"] },
    { readArtifact: async () => Buffer.from("RESULT") },
  );
  expect(result.status).toBe("pending");
  expect(result.verdicts[1]).toMatchObject({
    criterion: 1,
    status: "pending",
    reason: "validator_unavailable",
  });
});
it("does not read paths outside the accepted workspace boundary", async () => {
  const readArtifact = vi.fn(async () => Buffer.from("RESULT"));
  for (const artifact of ["../secret", "/tmp/secret", "C:/secret", "folder/../../secret"]) {
    const result = await evaluateTaskAcceptance(
      { ...input, checks: [{ ...input.checks[0], artifact }] },
      { readArtifact },
    );
    expect(result.status).not.toBe("passed");
  }
  expect(readArtifact).not.toHaveBeenCalled();
});
