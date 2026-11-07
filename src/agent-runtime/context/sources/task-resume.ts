import type { TrackedTask } from "../../contracts/task.js";
import { normalizeConstraintEntries } from "../../policy/index.js";

/** Redact absolute tenant/workspace paths before any prompt or UI copy. */
export function sanitizeTaskBoardPathForPrompt(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return value;
  }
  const tenant = value.match(
    /\/openbot-tenants\/[^/]+\/users\/[^/]+\/OpenBot\/agents\/[^/]+\/workspace\/?(.*)$/,
  );
  if (tenant) {
    const rest = (tenant[1] ?? "").replace(/^\/+/, "");
    return rest || "workspace";
  }
  if (/^\/(?:root|var|tmp)\//.test(value) || value.startsWith("/Users/")) {
    const base = value.replace(/\/+$/, "").split("/").pop();
    return base || "workspace";
  }
  return value;
}

export function buildResumePrompt(task: TrackedTask): string {
  const paths = task.stop.workspacePaths
    .filter(Boolean)
    .map((entry) => sanitizeTaskBoardPathForPrompt(entry))
    .filter(Boolean);
  const pathLine = paths.length > 0 ? `\n文件：${paths.join("、")}` : "";
  // Only currently binding constraints — superseded history stays on the board
  // but must not be presented as simultaneously valid instructions (slice3).
  const entries = normalizeConstraintEntries(task.effectiveConstraints).filter(
    (row) => !row.superseded,
  );
  const constraints = entries.map((row) => row.text);
  const hasLocalReviseAmongActive =
    entries.length > 1 && entries.some((row) => row.kind === "revise");
  const constraintHeader = hasLocalReviseAmongActive
    ? "有效约束（按登记顺序；后文修订仅覆盖与其冲突的部分，其余条目仍有效）："
    : "有效约束（按登记顺序）：";
  const constraintBlock =
    constraints.length > 0
      ? `\n${constraintHeader}\n${constraints
          .map((row, index) => `${index + 1}. ${row}`)
          .join("\n")}`
      : "";
  // Keep taskId on a machine line for the model; never echo raw ids in the
  // human-facing 「继续任务」 sentence (that line previously leaked into chat).
  // Full owner constraints live in effectiveConstraints — stop.summary is display/stop only.
  return [
    `task_id: ${task.taskId}`,
    `继续任务「${task.title}」。`,
    `停在：${task.stop.summary}${pathLine}`,
    constraintBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
