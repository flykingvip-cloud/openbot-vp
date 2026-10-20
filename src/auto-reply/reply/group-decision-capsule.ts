import type { Decision } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";

export type GroupDecisionCapsuleParams = {
  cfg: OpenBotConfig;
  sessionEntry?: SessionEntry;
  groupId?: string;
  limit?: number;
};

function resolveGroupId(params: GroupDecisionCapsuleParams): string | null {
  const direct = params.groupId?.trim();
  if (direct) {
    return direct;
  }
  const fromSession = params.sessionEntry?.groupId?.trim() || params.sessionEntry?.space?.trim();
  return fromSession || null;
}

function formatDecisionLine(decision: Decision): string {
  const selected = decision.options.find((option) => option.optionId === decision.selectedOption);
  const choice = selected?.title ?? decision.selectedOption ?? "（未记录选项）";
  const rationale = decision.rationale?.trim();
  return rationale
    ? `- ${decision.title}: ${choice} — ${rationale}`
    : `- ${decision.title}: ${choice}`;
}

/** Load finalized group decisions as a compact Active Context capsule. */
export async function buildGroupDecisionCapsule(
  params: GroupDecisionCapsuleParams,
): Promise<string> {
  const groupId = resolveGroupId(params);
  if (!groupId) {
    return "";
  }
  const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
  const decisions = await objectStorage.listObjects<Decision>(groupId, "decision");
  const finalized = decisions
    .filter((entry) => entry.status === "finalized")
    .toSorted(
      (left, right) =>
        (right.finalizedAt ?? right.updatedAt) - (left.finalizedAt ?? left.updatedAt),
    )
    .slice(0, params.limit ?? 5);
  if (finalized.length === 0) {
    return "";
  }
  return [
    "Group decisions (finalized — treat as binding constraints):",
    ...finalized.map((entry) => formatDecisionLine(entry)),
  ].join("\n");
}
