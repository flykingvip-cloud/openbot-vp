import { createHash } from "node:crypto";
import type {
  TaskAcceptanceCheck,
  TaskAcceptanceEvaluation,
  TaskCriterionVerdict,
} from "../../contracts/quality.js";

/** Closed data contract. These values are never evaluated as code or shell input. */
function validCheck(check: TaskAcceptanceCheck, criteriaCount: number): boolean {
  return Boolean(
    check &&
    Object.keys(check).every((key) =>
      ["criterion", "validator", "artifact", "expected"].includes(key),
    ) &&
    Number.isSafeInteger(check.criterion) &&
    check.criterion >= 0 &&
    check.criterion < criteriaCount &&
    check.validator === "artifact.text.exact.v1" &&
    typeof check.artifact === "string" &&
    check.artifact.trim() &&
    !check.artifact.includes("\0") &&
    !check.artifact.startsWith("/") &&
    !check.artifact.startsWith("~") &&
    !/^[a-z]:/iu.test(check.artifact) &&
    !check.artifact.split(/[\\/]/u).some((part) => part === "..") &&
    typeof check.expected === "string" &&
    Buffer.byteLength(check.expected, "utf8") <= 65536,
  );
}

/** Pure acceptance evaluation over host-authorized artifact reads; no task writes or scheduling. */
export async function evaluateTaskAcceptance(
  input: {
    taskId: string;
    executionAttempt: string;
    deliverableVersion: string;
    criteria: readonly string[];
    checks: readonly TaskAcceptanceCheck[];
  },
  ports: { readArtifact: (relativePath: string) => Promise<Buffer> },
): Promise<TaskAcceptanceEvaluation> {
  const criteria = [...input.criteria];
  const checkPlan = input.checks.map((check) => ({ ...check }));
  const criteriaHash = createHash("sha256")
    .update(JSON.stringify({ criteria: criteria, checks: checkPlan }))
    .digest("hex");
  const identity = {
    taskId: input.taskId,
    executionAttempt: input.executionAttempt,
    deliverableVersion: input.deliverableVersion,
    criteriaHash,
  };
  if (
    !input.taskId.trim() ||
    !input.executionAttempt.trim() ||
    !input.deliverableVersion.trim() ||
    criteria.length === 0 ||
    checkPlan.length > 16 ||
    checkPlan.some((check) => !validCheck(check, criteria.length))
  ) {
    return {
      ...identity,
      status: "pending",
      verdicts: criteria.map((_, criterion) => ({
        criterion,
        status: "pending",
        reason: "invalid_check_contract",
      })),
    };
  }
  const verdicts: TaskCriterionVerdict[] = [];
  for (let criterion = 0; criterion < criteria.length; criterion += 1) {
    const checks = checkPlan.filter((check) => check.criterion === criterion);
    if (checks.length === 0) {
      verdicts.push({ criterion, status: "pending", reason: "validator_unavailable" });
      continue;
    }
    for (const check of checks) {
      try {
        const bytes = await ports.readArtifact(check.artifact);
        const artifactHash = createHash("sha256").update(bytes).digest("hex");
        const passed = bytes.equals(Buffer.from(check.expected, "utf8"));
        verdicts.push({
          criterion,
          status: passed ? "passed" : "failed",
          reason: passed ? "bytes_verified" : "bytes_mismatch",
          artifactHash,
        });
      } catch {
        verdicts.push({ criterion, status: "pending", reason: "artifact_unavailable" });
      }
    }
  }
  const status = verdicts.some((verdict) => verdict.status === "failed")
    ? "failed"
    : verdicts.every((verdict) => verdict.status === "passed")
      ? "passed"
      : "pending";
  return { ...identity, status, verdicts };
}
