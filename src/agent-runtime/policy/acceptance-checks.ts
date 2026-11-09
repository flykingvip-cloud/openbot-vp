import type { TaskAcceptanceCheck } from "../contracts/quality.js";

/** Closed declarative contract. Unknown operators and executable fields fail closed. */
export function parseTaskAcceptanceChecks(
  value: unknown,
  criteriaCount: number,
): { ok: true; checks: TaskAcceptanceCheck[] } | { ok: false } {
  if (value === undefined) {
    return { ok: true, checks: [] };
  }
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !Number.isSafeInteger(criteriaCount) ||
    criteriaCount < 1
  ) {
    return { ok: false };
  }
  const checks: TaskAcceptanceCheck[] = [];
  let expectedBytes = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false };
    }
    const row = candidate as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => !["criterion", "validator", "artifact", "expected"].includes(key),
      ) ||
      typeof row.criterion !== "number" ||
      !Number.isSafeInteger(row.criterion) ||
      row.criterion < 0 ||
      row.criterion >= criteriaCount ||
      row.validator !== "artifact.text.exact.v1" ||
      typeof row.artifact !== "string" ||
      !row.artifact.trim() ||
      row.artifact.length > 4096 ||
      row.artifact.includes("\0") ||
      /^[\\/~]/u.test(row.artifact) ||
      /^[a-z]:/iu.test(row.artifact) ||
      row.artifact.split(/[\\/]/u).some((part) => part === "..") ||
      typeof row.expected !== "string"
    ) {
      return { ok: false };
    }
    expectedBytes += Buffer.byteLength(row.expected, "utf8");
    if (expectedBytes > 16384) {
      return { ok: false };
    }
    checks.push({
      criterion: row.criterion,
      validator: row.validator,
      artifact: row.artifact,
      expected: row.expected,
    });
  }
  return { ok: true, checks };
}
