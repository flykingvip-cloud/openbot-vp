import { exactMember } from "../../records.js";
import type {
  KnowledgeAgentProfile,
  KnowledgeResolveIntent,
  KnowledgeSource,
  KnowledgeTaskContext,
} from "../types.js";

const ALL_SOURCES: KnowledgeSource[] = ["personal", "enterprise", "data"];

export type KnowledgeSourceExclusionReason =
  | "general_empty"
  | "policy_disallowed"
  | "acl_disallowed"
  | "hint_narrowed"
  | "live_gated"
  | "unknown_source";

/**
 * Ceiling fields plus ACL/live intent for one resolve pass.
 * Not a separate Policy OS — callers pass the existing inbound ceiling.
 */
export type KnowledgeSourcePolicyInput = {
  liveSourcesAllowed: boolean;
  allowedSources: KnowledgeSource[];
  aclAllowedSources: KnowledgeSource[];
  hasExplicitLiveIntent?: boolean;
};

export type KnowledgeSourceSelection = {
  selected: KnowledgeSource[];
  excludedReasons: KnowledgeSourceExclusionReason[];
};

function uniqueSources(values: KnowledgeSource[]): KnowledgeSource[] {
  return [...new Set(values)];
}

function orderedSources(values: KnowledgeSource[]): KnowledgeSource[] {
  return uniqueSources(values).toSorted(
    (left, right) => ALL_SOURCES.indexOf(left) - ALL_SOURCES.indexOf(right),
  );
}

function filterByProfile(
  sources: KnowledgeSource[],
  profile: KnowledgeAgentProfile,
): KnowledgeSource[] {
  return sources.filter((source) => profile.enabledSources.includes(source));
}

function knownSource(value: string): value is KnowledgeSource {
  return exactMember(value, ALL_SOURCES) !== null;
}

export function selectKnowledgeSourcesWithPolicy(params: {
  intent: KnowledgeResolveIntent;
  taskContext: KnowledgeTaskContext;
  sourcePolicy: KnowledgeSourcePolicyInput;
}): KnowledgeSourceSelection {
  const excludedReasons: KnowledgeSourceExclusionReason[] = [];
  const intentSources = uniqueSources(params.intent.suggestedSources.filter(knownSource));
  if (params.intent.suggestedSources.some((source) => !knownSource(source))) {
    excludedReasons.push("unknown_source");
  }
  if (params.intent.intentType === "general" && intentSources.length === 0) {
    excludedReasons.push("general_empty");
  }

  const policySources = new Set(params.sourcePolicy.allowedSources.filter(knownSource));
  const aclSources = new Set(params.sourcePolicy.aclAllowedSources.filter(knownSource));
  const afterPolicy = intentSources.filter((source) => policySources.has(source));
  if (afterPolicy.length !== intentSources.length) {
    excludedReasons.push("policy_disallowed");
  }
  const afterAcl = afterPolicy.filter((source) => aclSources.has(source));
  if (afterAcl.length !== afterPolicy.length) {
    excludedReasons.push("acl_disallowed");
  }

  const hints = uniqueSources((params.taskContext.requestedSourceHints ?? []).filter(knownSource));
  let selected = afterAcl;
  if (hints.length) {
    const beforeHints = selected;
    selected = selected.filter((source) => hints.includes(source));
    if (selected.length !== beforeHints.length) {
      excludedReasons.push("hint_narrowed");
    }
  }

  if (!params.sourcePolicy.liveSourcesAllowed) {
    const beforeLive = selected;
    selected = selected.filter((source) => source !== "data");
    if (selected.length !== beforeLive.length) {
      excludedReasons.push("live_gated");
    }
  }

  return {
    selected: orderedSources(selected),
    excludedReasons: [...new Set(excludedReasons)].toSorted(),
  };
}

export function selectKnowledgeSources(params: {
  intent: KnowledgeResolveIntent;
  taskContext: KnowledgeTaskContext;
  profile: KnowledgeAgentProfile;
  sourcePolicy?: KnowledgeSourcePolicyInput;
}): KnowledgeSource[] {
  if (params.sourcePolicy) {
    return selectKnowledgeSourcesWithPolicy({
      intent: params.intent,
      taskContext: params.taskContext,
      sourcePolicy: params.sourcePolicy,
    }).selected;
  }

  const fromIntent = uniqueSources(params.intent.suggestedSources);
  const fromHints = uniqueSources(params.taskContext.requestedSourceHints ?? []);
  const fromProfile = uniqueSources(params.profile.enabledSources);

  let selected = fromHints.length ? fromHints : fromIntent;
  selected = filterByProfile(selected.length ? selected : ALL_SOURCES, params.profile);

  if (!selected.length) {
    selected = fromProfile.length ? fromProfile : ALL_SOURCES;
  }

  return selected;
}
