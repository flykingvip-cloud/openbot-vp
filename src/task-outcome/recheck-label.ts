/**
 * Display copy for one recheck observation.
 * Pure on purpose: diagnosis rows and evidence text must use the same words.
 * A missing attempt keeps the original short copy. A known attempt names which try.
 * Read failures are not "未复验".
 */
export type RecheckDisplayStatus = "not_checked" | "incomplete" | "completed" | "read_failed";

export function formatRecheckObservationLabel(
  status: string | undefined,
  attempt?: number | null,
): string {
  if (status === "read_failed") {
    return "复验记录读取失败";
  }
  const attemptPrefix =
    typeof attempt === "number" && Number.isInteger(attempt) && attempt >= 1
      ? `第${attempt}次`
      : "";
  if (status === "incomplete") {
    return attemptPrefix ? `${attemptPrefix}复验未完成` : "复验未完成";
  }
  if (status === "completed") {
    return attemptPrefix ? `${attemptPrefix}复验已记录` : "复验已记录";
  }
  return "未复验";
}
