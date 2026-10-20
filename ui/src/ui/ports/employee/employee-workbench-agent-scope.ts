import type { AgentsListResult } from "../../types.ts";

/** Grant stubs whose only label is a raw UUID are not assistants. */
export function isBareUuidLabel(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

/**
 * `agents.list` is already the position bot set. Email, user id, grant arrays,
 * browser memory, and org-directory stubs must not add or drop rows here.
 */
export function filterAgentsListForEmployeeWorkbench(
  list: AgentsListResult | null,
): AgentsListResult | null {
  return list;
}
