import type { CronRunStatus } from "./types.js";

/** Tool/channel errors that mean "notify failed", not "the cron work failed". */
export function isCronDeliveryToolError(error?: string): boolean {
  const err = error?.trim().toLowerCase() ?? "";
  if (!err) {
    return false;
  }
  return (
    err.includes("delivering") ||
    err.includes("delivery") ||
    err.includes("wecom") ||
    err.includes("dingtalk") ||
    err.includes("message failed") ||
    err.includes("canvas failed") ||
    err.includes("nodes failed") ||
    err.includes("outbound") ||
    err.includes("requires target")
  );
}

/** Agent produced a summary but the run was marked error due to external channel delivery. */
export function isCronDeliveryOnlyFailure(params: {
  status?: CronRunStatus | (string & {});
  error?: string;
  summary?: string;
}): boolean {
  if (params.status !== "error") {
    return false;
  }
  const summary = params.summary?.trim();
  if (!summary || summary.length < 40) {
    return false;
  }
  return isCronDeliveryToolError(params.error);
}
