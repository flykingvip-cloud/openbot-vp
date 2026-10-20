/**
 * Identity-file writes (IDENTITY.md) honor the asset decision, including shadow deny.
 * personal_local (no enterprise ownership) stays unchanged.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  type AuthorizeAgentAssetResult,
  authorizeAgentAssetAccess,
  rejectAgentAssetWriteWhenDenied,
} from "../access-control/authorize.js";
import { buildOwnerBaselinePolicies } from "../access-control/policy-v2-evaluator.js";
import type { AccessSubject } from "../access-control/policy-v2-types.js";
import { resolveAgentCreateOwnershipForClient } from "../agent-registry/agent-create-ownership.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import type { GatewayClient } from "./types.js";

export async function resolveAgentIdentityWriteAccess(params: {
  client: GatewayClient | null | undefined;
  agentId: string;
  loadRegistry?: () => Promise<AgentRegistryStore>;
}): Promise<AuthorizeAgentAssetResult | undefined> {
  const ownership = await resolveAgentCreateOwnershipForClient({
    client: params.client,
    requestedTenantId: null,
    requestedOwnerUserId: null,
    requestedOwnerPositionId: null,
  });
  if (ownership.kind === "reject") {
    throw new Error(`agent asset access denied: ${ownership.code}`);
  }
  if (ownership.kind !== "enterprise") {
    return undefined;
  }
  const registry = await (params.loadRegistry ?? loadAgentRegistryStore)();
  return authorizeRegistryIdentityWrite({
    registry,
    enterpriseId: ownership.tenantId,
    agentId: params.agentId,
    actorMembershipId: ownership.actorMembershipId,
  });
}

export async function authorizeRegistryIdentityWrite(params: {
  registry: AgentRegistryStore;
  enterpriseId: string;
  agentId: string;
  actorMembershipId: string;
}): Promise<AuthorizeAgentAssetResult> {
  const resolution = resolveLegacyAgentId({
    store: params.registry,
    enterpriseId: params.enterpriseId,
    legacyAgentId: params.agentId,
  });
  if (resolution.kind !== "resolved") {
    throw new Error("agent asset access denied: asset-not-resolved");
  }
  const ref = resolution.ref;
  const nowIso = new Date().toISOString();
  const policies = buildOwnerBaselinePolicies({
    registry: params.registry,
    resource: ref,
    nowIso,
    makePolicyId: (permission) => `owner:${ref.agentAssetId}:${permission}`,
  });
  const ownerPolicy = policies[0];
  const subject: AccessSubject = ownerPolicy
    ? {
        subjectType: ownerPolicy.subjectType,
        subjectId: ownerPolicy.subjectId,
        status: "active",
      }
    : {
        subjectType: "membership",
        subjectId: params.actorMembershipId,
        status: "active",
      };
  return authorizeAgentAssetAccess({
    policies,
    registry: params.registry,
    subject,
    resource: ref,
    permission: "agent.manage",
  });
}

/** Append identity lines only after a present access decision allows the write. */
export async function appendAgentIdentityLines(params: {
  workspaceDir: string;
  identityFileName: string;
  lines: string;
  access: AuthorizeAgentAssetResult | undefined;
}): Promise<void> {
  if (params.access) {
    rejectAgentAssetWriteWhenDenied(params.access);
  }
  await fs.mkdir(params.workspaceDir, { recursive: true });
  await fs.appendFile(
    path.join(params.workspaceDir, params.identityFileName),
    params.lines,
    "utf-8",
  );
}
