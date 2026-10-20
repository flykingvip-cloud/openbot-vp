import { canCallFactory } from "./session.js";
import type {
  AgentCreateRequest,
  BlueprintDraft,
  CreationReceipt,
  CreationSession,
  SkillInstallReport,
} from "./types.js";

const ADAPTER_FORBIDDEN = [
  "oauth.connect",
  "grantPermission",
  "bindExternalAccount",
  "conversationTask",
  "cron",
  "mission",
  "ledger",
] as const;

export type FactoryAdapterContract = {
  allowedWrites: readonly [
    "workspaces.create",
    "agents.create",
    "robots.bind-workspace",
    "installSkillKeys",
  ];
  forbiddenCalls: typeof ADAPTER_FORBIDDEN;
};

export const FACTORY_ADAPTER_CONTRACT: FactoryAdapterContract = {
  allowedWrites: [
    "workspaces.create",
    "agents.create",
    "robots.bind-workspace",
    "installSkillKeys",
  ],
  forbiddenCalls: ADAPTER_FORBIDDEN,
};

/**
 * Compile a confirmed draft into existing agents.create params.
 * Does not call the gateway. Does not allocate agentId.
 */
export function buildAgentCreateRequest(
  session: CreationSession,
  confirmed: BlueprintDraft,
): AgentCreateRequest {
  if (session.status !== "CONFIRMED") {
    throw new Error("buildAgentCreateRequest requires CONFIRMED session");
  }
  if (!canCallFactory(session)) {
    throw new Error("factory closed");
  }
  if (confirmed.validation.status === "invalid") {
    throw new Error("invalid draft cannot be instantiated");
  }
  if ("agentId" in confirmed) {
    throw new Error("draft must not pre-assign agentId");
  }

  const skillKeys = [
    ...new Set(
      confirmed.skillRecommendations
        .filter((entry) => entry.status === "resolved" && entry.skillKey)
        .map((entry) => entry.skillKey as string),
    ),
  ];

  const name =
    confirmed.roleResolution.kind === "published"
      ? confirmed.roleResolution.blueprintId
      : confirmed.responsibilities[0] || "digital-employee";

  const request: AgentCreateRequest = {
    name,
    skillKeys,
  };
  if (confirmed.roleResolution.kind === "published") {
    request.blueprintId = confirmed.roleResolution.blueprintId;
    request.blueprintVersion = confirmed.roleResolution.blueprintVersion;
  }
  return request;
}

/**
 * Compile a creation receipt after Factory returned an agentId.
 * Receipt is proof of how the Agent was created, not a runtime SoT.
 */
export function buildCreationReceipt(params: {
  session: CreationSession;
  draft: BlueprintDraft;
  agentId: string;
  skillInstall: SkillInstallReport;
  confirmedAt: string;
}): CreationReceipt {
  if (params.session.status !== "INSTANTIATED" && params.session.status !== "PARTIAL") {
    throw new Error("buildCreationReceipt requires INSTANTIATED or PARTIAL");
  }
  if (params.session.instantiatedAgentId && params.session.instantiatedAgentId !== params.agentId) {
    throw new Error("receipt agentId must match factory result");
  }
  const published =
    params.draft.roleResolution.kind === "published" ? params.draft.roleResolution : undefined;
  return {
    agentId: params.agentId,
    ...(published
      ? { blueprintId: published.blueprintId, blueprintVersion: published.blueprintVersion }
      : {}),
    roleRecipeIds: [...params.draft.roleRecipeIds],
    skillKeysRequested: params.draft.skillRecommendations
      .filter((entry) => entry.status === "resolved" && entry.skillKey)
      .map((entry) => entry.skillKey as string),
    skillInstall: params.skillInstall,
    policyRecommendations: params.draft.policyRecommendations.map((entry) => entry.id),
    createdByUserId: params.session.actorUserId,
    confirmedAt: params.confirmedAt,
    creationSessionId: params.session.id,
  };
}

export function adapterRequestHasForbiddenKeys(request: AgentCreateRequest): boolean {
  const record = request as unknown as Record<string, unknown>;
  return (
    "agentId" in record ||
    "accountBindings" in record ||
    "grantedPermissions" in record ||
    "oauth" in record ||
    "cronId" in record ||
    "conversationTaskId" in record
  );
}
