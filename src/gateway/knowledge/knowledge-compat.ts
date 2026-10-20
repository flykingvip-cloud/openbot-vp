import { recordKnowledgeCompatWarning } from "./knowledge-compat-stats.js";
import { ensurePersonalInboxKnowledgeBase } from "./personal-inbox-knowledge-base.js";

export type KnowledgeCompatWarningCode =
  | "implicit_personal_inbox"
  | "source_bind_visibility_ignored";

export type KnowledgeCompatWarning = {
  code: KnowledgeCompatWarningCode;
  message: string;
};

function envFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/** Phase 3: reject personal imports / source.bind when knowledgeBaseId is omitted. */
export function isStrictKnowledgeBaseIdRequired(): boolean {
  return (
    envFlag("OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID") ||
    envFlag("OPENCLAW_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID")
  );
}

/** Phase 3: reject legacy `visibility` on knowledge.source.bind instead of warning+ignore. */
export function isSourceBindVisibilityInputRejected(): boolean {
  return (
    envFlag("OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY") ||
    envFlag("OPENCLAW_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY")
  );
}

export type KnowledgeCompatFeatureFlags = {
  requireKnowledgeBaseId: boolean;
  rejectSourceBindVisibility: boolean;
};

export function readKnowledgeCompatFeatureFlags(): KnowledgeCompatFeatureFlags {
  return {
    requireKnowledgeBaseId: isStrictKnowledgeBaseIdRequired(),
    rejectSourceBindVisibility: isSourceBindVisibilityInputRejected(),
  };
}

function trackCompatWarnings(warnings: KnowledgeCompatWarning[]): void {
  for (const warning of warnings) {
    recordKnowledgeCompatWarning(warning.code);
  }
}

export function implicitPersonalInboxWarning(knowledgeBaseId: string): KnowledgeCompatWarning {
  return {
    code: "implicit_personal_inbox",
    message: `knowledgeBaseId was omitted; routed to personal inbox ${knowledgeBaseId}. Pass knowledgeBaseId explicitly.`,
  };
}

export function sourceBindVisibilityIgnoredWarning(): KnowledgeCompatWarning {
  return {
    code: "source_bind_visibility_ignored",
    message: "visibility is ignored; source binding inherits the target knowledge base visibility.",
  };
}

export function createSourceBindVisibilityIgnoredWarning(): KnowledgeCompatWarning {
  const warning = sourceBindVisibilityIgnoredWarning();
  trackCompatWarnings([warning]);
  return warning;
}

export function appendCompatWarnings<T extends Record<string, unknown>>(
  payload: T,
  warnings: KnowledgeCompatWarning[],
): T & { compatWarnings?: KnowledgeCompatWarning[] } {
  if (warnings.length === 0) {
    return payload;
  }
  return { ...payload, compatWarnings: warnings };
}

export function resolvePersonalImportKnowledgeBase(params: {
  explicitKbId: string | undefined;
  ownerId: string | null;
  tenantId: string | null;
}): {
  knowledgeBaseId: string | undefined;
  compatWarnings: KnowledgeCompatWarning[];
  rejectedReason?: string;
} {
  if (params.explicitKbId) {
    return { knowledgeBaseId: params.explicitKbId, compatWarnings: [] };
  }
  if (!params.ownerId) {
    return { knowledgeBaseId: undefined, compatWarnings: [] };
  }
  if (isStrictKnowledgeBaseIdRequired()) {
    return {
      knowledgeBaseId: undefined,
      compatWarnings: [],
      rejectedReason: "knowledgeBaseId required",
    };
  }
  const inbox = ensurePersonalInboxKnowledgeBase({
    ownerId: params.ownerId,
    tenantId: params.tenantId,
  });
  const compatWarnings = [implicitPersonalInboxWarning(inbox.id)];
  trackCompatWarnings(compatWarnings);
  return {
    knowledgeBaseId: inbox.id,
    compatWarnings,
  };
}
