/**
 * Evolution ingest ownership gate.
 *
 * Ordinary agent ACL is not an ownership proof. Every production sample must
 * carry one verifiable attribution path: HMAC proof, run binding, or an
 * agent-scoped sessionKey. Service aliases never invent a tenant.
 */
import { normalizeAgentId } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  assertClientMayAccessAgentDetailed,
  type AgentAccessOk,
} from "../server-methods/operator-access.js";
import type { GatewayClient, RespondFn } from "../server-methods/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { logEvolutionLoop } from "./evolution-loop-log.js";
import {
  isEvolutionServiceAlias,
  lookupRuntimeOwnershipBinding,
  resolveConcreteAgentFromSessionKey,
  verifyRuntimeOwnershipProof,
  type RuntimeOwnershipBinding,
} from "./runtime-ownership-proof.js";

export type EvolutionIngestProofSource = "token" | "binding" | "session";

export type EvolutionIngestAccess = AgentAccessOk & {
  proofSource: EvolutionIngestProofSource;
  binding: RuntimeOwnershipBinding | null;
};

function reject(
  respond: RespondFn,
  fields: {
    runId?: string | null;
    agentId?: string | null;
    tenantId?: string | null;
    surfaceId?: string | null;
    reason: string;
    message: string;
  },
): null {
  logEvolutionLoop("evolution.attribution.rejected", {
    runId: fields.runId ?? null,
    agentId: fields.agentId ?? null,
    tenantId: fields.tenantId ?? null,
    surfaceId: fields.surfaceId ?? "pattern-detection.sample",
    reason: fields.reason,
  });
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, fields.message));
  return null;
}

function concreteOrNull(agentId: string | null | undefined): string | null {
  const trimmed = agentId?.trim();
  if (!trimmed) {
    return null;
  }
  return normalizeAgentId(trimmed);
}

export async function resolveEvolutionIngestAccess(input: {
  client: GatewayClient | null | undefined;
  claimedAgentId: string;
  runId?: string | null;
  sessionKey?: string | null;
  ownershipProof?: string | null;
  claimedTenantId?: string | null;
  persistDir?: string;
  now?: number;
  secret?: string;
  respond: RespondFn;
}): Promise<EvolutionIngestAccess | null> {
  const claimed = concreteOrNull(input.claimedAgentId);
  if (!claimed) {
    return reject(input.respond, {
      runId: input.runId,
      reason: "missing_agent",
      message: "agentId is required",
    });
  }

  const claimedTenant = canonicalizeTenantId(input.claimedTenantId);
  const sessionAgent = resolveConcreteAgentFromSessionKey(input.sessionKey);
  const token = input.ownershipProof?.trim() || "";
  const runId = input.runId?.trim() || "";
  let binding: RuntimeOwnershipBinding | null = null;
  let proofSource: EvolutionIngestProofSource | null = null;
  let concreteAgent: string | null = null;

  if (token) {
    if (!token.startsWith("evop1.")) {
      return reject(input.respond, {
        runId,
        agentId: claimed,
        tenantId: claimedTenant,
        reason: "malformed_proof",
        message: `agent has no tenant ownership proof: ${claimed}`,
      });
    }
    const verified = verifyRuntimeOwnershipProof({
      token,
      runId: runId || undefined,
      expectedAgentId: isEvolutionServiceAlias(claimed) ? undefined : claimed,
      expectedTenantId: claimedTenant,
      now: input.now,
      secret: input.secret,
      persistDir: input.persistDir,
    });
    if (!verified.ok) {
      return reject(input.respond, {
        runId,
        agentId: claimed,
        tenantId: claimedTenant,
        reason: verified.reason,
        message: `agent has no tenant ownership proof: ${claimed}`,
      });
    }
    binding = verified.binding;
    proofSource = "token";
    concreteAgent = verified.binding.agentId;
  } else {
    const fromRun = lookupRuntimeOwnershipBinding(runId || null, input.persistDir, input.now);
    if (fromRun) {
      binding = fromRun;
      proofSource = "binding";
      concreteAgent = fromRun.agentId;
    } else if (sessionAgent) {
      proofSource = "session";
      concreteAgent = sessionAgent;
    } else {
      return reject(input.respond, {
        runId,
        agentId: claimed,
        tenantId: claimedTenant,
        reason: "missing_proof",
        message: `agent has no tenant ownership proof: ${claimed}`,
      });
    }
  }

  if (!concreteAgent || !proofSource) {
    return reject(input.respond, {
      runId,
      agentId: claimed,
      tenantId: claimedTenant,
      reason: "missing_proof",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }

  if (!isEvolutionServiceAlias(claimed) && claimed !== concreteAgent) {
    return reject(input.respond, {
      runId,
      agentId: claimed,
      tenantId: claimedTenant,
      reason: "agent_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }
  if (sessionAgent && sessionAgent !== concreteAgent) {
    return reject(input.respond, {
      runId,
      agentId: claimed,
      tenantId: claimedTenant,
      reason: "agent_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }
  if (binding && runId && binding.runId !== runId) {
    return reject(input.respond, {
      runId,
      agentId: concreteAgent,
      tenantId: binding.tenantId,
      reason: "run_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }

  const access = await assertClientMayAccessAgentDetailed(
    input.client,
    concreteAgent,
    input.respond,
  );
  if (!access) {
    logEvolutionLoop("evolution.attribution.rejected", {
      runId: runId || null,
      agentId: concreteAgent,
      tenantId: claimedTenant,
      surfaceId: "pattern-detection.sample",
      reason: "acl_denied",
    });
    return null;
  }

  if (access.agentId !== concreteAgent) {
    return reject(input.respond, {
      runId,
      agentId: access.agentId,
      tenantId: access.tenantId,
      reason: "agent_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }
  if (sessionAgent && sessionAgent !== access.agentId) {
    return reject(input.respond, {
      runId,
      agentId: access.agentId,
      tenantId: access.tenantId,
      reason: "agent_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }
  if (binding && binding.agentId !== access.agentId) {
    return reject(input.respond, {
      runId,
      agentId: access.agentId,
      tenantId: access.tenantId,
      reason: "agent_mismatch",
      message: `agent has no tenant ownership proof: ${claimed}`,
    });
  }
  if (binding && access.tenantId && binding.tenantId !== access.tenantId) {
    return reject(input.respond, {
      runId,
      agentId: access.agentId,
      tenantId: access.tenantId,
      reason: "cross_tenant",
      message: "resource tenant mismatch",
    });
  }
  if (claimedTenant && access.tenantId && claimedTenant !== access.tenantId) {
    return reject(input.respond, {
      runId,
      agentId: access.agentId,
      tenantId: access.tenantId,
      reason: "cross_tenant",
      message: "resource tenant mismatch",
    });
  }

  logEvolutionLoop("evolution.attribution.accepted", {
    runId: runId || null,
    agentId: access.agentId,
    tenantId: access.tenantId,
    surfaceId: "pattern-detection.sample",
    reason: proofSource,
  });
  return { ...access, proofSource, binding };
}
