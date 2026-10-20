import {
  applyLaneModeToolPolicy,
  isDeliveryLaneEnabled,
  resolveActiveDeliveryLaneMode,
  type LaneMode,
} from "../../../gateway/delivery-lane/index.js";
import { applyInboundToolCeiling, type InboundToolCeiling } from "../../inbound-tool-policy.js";
import type { SkillPolicy } from "../../skills/skill-policy.js";
import type { AnyAgentTool } from "../../tools/common.js";
import { applyEmbeddedCustomToolPolicy } from "../tool-split.js";

export const KNOWLEDGE_SOURCE_TOOL_NAMES = ["knowledge_source", "knowledge-source-tool"] as const;

export function embeddedToolSetContainsKnowledgeSource(
  tools: ReadonlyArray<{ name?: string }>,
): boolean {
  const names = new Set(tools.map((tool) => tool.name).filter(Boolean));
  return KNOWLEDGE_SOURCE_TOOL_NAMES.some((name) => names.has(name));
}

/**
 * Tool-construction gate used by the embedded Pi attempt.
 * Chat-lane runs pass `disableTools: true` so createTools is never invoked.
 *
 * Tip B live hook: when delivery-lane is enabled and LaneMode is accept|review,
 * `applyLaneModeToolPolicy` denies Deny-column writes (after inbound ceiling).
 */
export function resolveEmbeddedAttemptToolsRaw<
  T extends { name: string; execute?: unknown },
>(params: {
  disableTools?: boolean;
  inboundToolCeiling?: InboundToolCeiling;
  skillPolicy?: SkillPolicy;
  createTools: () => T[];
  isStillAllowed?: (toolName: string) => boolean;
  /** Tip B — explicit mode override (tests / turn context). */
  laneMode?: LaneMode | null;
  /** Tip B — agent id for active-mode registry lookup after setLaneMode. */
  agentId?: string | null;
  laneId?: string | null;
  /** Tip B — override feature flag for tests. Default: isDeliveryLaneEnabled(). */
  deliveryLaneEnabled?: boolean;
}): T[] {
  if (params.disableTools) {
    return [];
  }
  const constructed = params.createTools();
  const afterCeiling = params.inboundToolCeiling
    ? (applyInboundToolCeiling({
        tools: constructed as unknown as AnyAgentTool[],
        ceiling: params.inboundToolCeiling,
        isStillAllowed: params.isStillAllowed,
      }) as unknown as T[])
    : constructed;

  const deliveryLaneEnabled =
    typeof params.deliveryLaneEnabled === "boolean"
      ? params.deliveryLaneEnabled
      : isDeliveryLaneEnabled();
  let mode: LaneMode | null | undefined = params.laneMode;
  if (deliveryLaneEnabled && (mode === undefined || mode === null)) {
    mode = resolveActiveDeliveryLaneMode({
      agentId: params.agentId,
      laneId: params.laneId,
      env: { OPENBOT_DELIVERY_LANE_ENABLED: "1" },
      readConfig: () => false,
    }).mode;
  }
  const afterLane = applyLaneModeToolPolicy({
    tools: afterCeiling as unknown as AnyAgentTool[],
    mode,
    deliveryLaneEnabled,
    channel: "agent-tool",
  }) as unknown as T[];

  if (!params.skillPolicy) {
    return afterLane;
  }
  return applyEmbeddedCustomToolPolicy(afterLane, params.skillPolicy).tools;
}
