import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { ensureEvolutionControlPlaneStarted } from "../evolution-control/bootstrap.js";
import { logEvolutionLoop } from "../evolution-control/evolution-loop-log.js";
import { writeEvolutionObservationAudit } from "../evolution-control/observation-audit.js";
import { resolveEvolutionIngestAccess } from "../evolution-control/runtime-ingest-access.js";
import {
  approvePatternCandidate,
  getPatternCandidate,
  ingestPatternSample,
  listPatternCandidates,
  publishPatternCandidateAsDraftSkill,
  rejectPatternCandidate,
} from "../pattern-detection/index.js";
import { proposeWorkingDnaFromObservation } from "../pattern-detection/working-dna-proposal.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  assertClientMayAccessAgentDetailed,
  assertClientMayAccessCandidate,
  requireAuthenticatedOperatorPrincipal,
} from "./operator-access.js";
import { optionalString, requiredString } from "./request-params.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function optionalStringArray(params: Record<string, unknown>, key: string): string[] | null {
  const value = params[key];
  if (!Array.isArray(value)) {
    return null;
  }
  const items = [
    ...new Set(
      value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
    ),
  ].slice(0, 32);
  return items.length > 0 ? items : null;
}

/**
 * Resolve agent id from agentId or sessionKey (agent:<id>:…).
 * Does NOT use global listAgentIds — object ACL (membership ∩ ownership) is authoritative.
 */
function resolveAgentScope(params: Record<string, unknown>, respond: RespondFn): string | null {
  const direct = optionalString(params, "agentId");
  if (direct) {
    const id = normalizeAgentId(direct);
    if (id) {
      return id;
    }
  }
  const sessionKey = optionalString(params, "sessionKey");
  if (sessionKey?.startsWith("agent:")) {
    const parts = sessionKey.split(":");
    const fromSession = parts[1]?.trim();
    if (fromSession) {
      const id = normalizeAgentId(fromSession);
      if (id) {
        return id;
      }
    }
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, "agentId (or agent: sessionKey) is required"),
  );
  return null;
}

export const patternDetectionHandlers: GatewayRequestHandlers = {
  "pattern-detection.ingest-sample": async ({ params, respond, client }) => {
    const agentIdRaw = requiredString(params, "agentId", respond);
    const inputStructureHash = requiredString(params, "inputStructureHash", respond);
    const outputStructureHash = requiredString(params, "outputStructureHash", respond);
    if (!agentIdRaw || !inputStructureHash || !outputStructureHash) {
      return;
    }
    const runId = optionalString(params, "runId");
    const sessionKey = optionalString(params, "sessionKey");
    const access = await resolveEvolutionIngestAccess({
      client,
      claimedAgentId: agentIdRaw,
      runId,
      sessionKey,
      ownershipProof: optionalString(params, "ownershipProof"),
      claimedTenantId: optionalString(params, "tenantId"),
      respond,
    });
    if (!access) {
      return;
    }
    if (!runId) {
      logEvolutionLoop("evolution.observation.unavailable", {
        runId: null,
        agentId: access.agentId,
        tenantId: access.tenantId,
        surfaceId: "pattern-detection.sample",
        reason: "missing_run_id",
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId is required for production observation"),
      );
      return;
    }
    if (!access.tenantId) {
      logEvolutionLoop("evolution.observation.unavailable", {
        runId,
        agentId: access.agentId,
        tenantId: null,
        surfaceId: "pattern-detection.sample",
        reason: "missing_tenant",
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant attribution required for observation"),
      );
      return;
    }
    try {
      const result = ingestPatternSample({
        agentId: access.agentId,
        // Authoritative enterprise id from membership; null only for in-process client=null.
        tenantId: access.tenantId,
        operatorUserId: access.userId,
        runId,
        taskId: optionalString(params, "taskId"),
        sessionKey,
        inputStructureHash,
        outputStructureHash,
        toolTraceHash: optionalString(params, "toolTraceHash"),
        toolsUsed: optionalStringArray(params, "toolsUsed"),
        success: typeof params.success === "boolean" ? params.success : null,
        humanEdited: typeof params.humanEdited === "boolean" ? params.humanEdited : null,
        suggestedNameHint: optionalString(params, "suggestedNameHint") ?? undefined,
        suggestedSummaryHint: optionalString(params, "suggestedSummaryHint") ?? undefined,
      });
      const observation = writeEvolutionObservationAudit({
        runId,
        agentId: access.agentId,
        tenantId: access.tenantId,
        surfaceId: "pattern-detection.sample",
        source: "pattern-detection.ingest-sample",
        ownershipProof: access.binding
          ? `binding:${access.binding.runId}:v${access.binding.proofVersion}`
          : access.proofSource,
        attributionSource: access.proofSource,
        idempotencyKey: optionalString(params, "idempotencyKey"),
        inputStructureHash,
        outputStructureHash,
      });
      respond(true, { ...result, observation }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  "pattern-detection.list-candidates": async ({ params, respond, client }) => {
    // Require agent scope — never dump all tenants' candidates.
    const agentIdRaw = resolveAgentScope(params, respond);
    if (!agentIdRaw) {
      return;
    }
    // Shared agents may cover multiple tenants: filter by membership tenant.
    const access = await assertClientMayAccessAgentDetailed(client, agentIdRaw, respond);
    if (!access) {
      return;
    }
    const status =
      params.status === "candidate" ||
      params.status === "rejected" ||
      params.status === "approved" ||
      params.status === "published"
        ? params.status
        : undefined;
    respond(
      true,
      {
        candidates: listPatternCandidates({
          agentId: access.agentId,
          // Authenticated: only this tenant's candidates. In-process client=null: no tenant filter.
          tenantId: client ? access.tenantId : undefined,
          status,
        }),
      },
      undefined,
    );
  },

  "pattern-detection.get-candidate": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    const agentIdRaw = requiredString(params, "agentId", respond);
    if (!candidateId || !agentIdRaw) {
      return;
    }
    const candidate = getPatternCandidate(candidateId);
    if (!candidate || candidate.agentId !== agentIdRaw.trim()) {
      // Uniform not-found (do not leak cross-tenant existence).
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
      return;
    }
    const access = await assertClientMayAccessCandidate(client, candidate, respond);
    if (!access) {
      return;
    }
    respond(true, { candidate }, undefined);
  },

  "pattern-detection.approve": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    const agentIdRaw = requiredString(params, "agentId", respond);
    if (!candidateId || !agentIdRaw) {
      return;
    }
    try {
      const existing = getPatternCandidate(candidateId);
      if (!existing || existing.agentId !== agentIdRaw.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
        return;
      }
      const access = await assertClientMayAccessCandidate(client, existing, respond);
      if (!access) {
        return;
      }
      // Principal from auth context only — ignore client-supplied approvedBy.
      const approvedBy = requireAuthenticatedOperatorPrincipal(client, respond);
      if (!approvedBy) {
        return;
      }
      const autoInstallIntent =
        (params as { autoInstallIntent?: unknown }).autoInstallIntent === true;
      respond(
        true,
        {
          candidate: approvePatternCandidate(candidateId, {
            approvedBy,
            autoInstallIntent,
          }),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  "pattern-detection.reject": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    const agentIdRaw = requiredString(params, "agentId", respond);
    if (!candidateId || !agentIdRaw) {
      return;
    }
    try {
      const existing = getPatternCandidate(candidateId);
      if (!existing || existing.agentId !== agentIdRaw.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
        return;
      }
      const access = await assertClientMayAccessCandidate(client, existing, respond);
      if (!access) {
        return;
      }
      respond(true, { candidate: rejectPatternCandidate(candidateId) }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  /**
   * Human-gated: create draft executable skill from approved candidate (not auto-installed).
   */
  "pattern-detection.publish-draft-skill": async ({ params, respond, client }) => {
    const candidateId = requiredString(params, "candidateId", respond);
    const agentIdRaw = requiredString(params, "agentId", respond);
    if (!candidateId || !agentIdRaw) {
      return;
    }
    try {
      const existing = getPatternCandidate(candidateId);
      if (!existing || existing.agentId !== agentIdRaw.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "candidate not found"));
        return;
      }
      const access = await assertClientMayAccessCandidate(client, existing, respond);
      if (!access) {
        return;
      }
      const result = publishPatternCandidateAsDraftSkill({
        candidateId,
        sourceAgentId: optionalString(params, "sourceAgentId") ?? access.agentId,
        ownerUserId: access.userId ?? optionalString(params, "ownerUserId"),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  /**
   * Compatibility: UI subscribe returns snapshot for a required agentId.
   * Tenant-scoped: same filter as list-candidates.
   */
  "pattern-detection.propose-working-dna": async ({ params, respond, client }) => {
    const commandId = requiredString(params, "commandId", respond);
    const agentIdRaw = requiredString(params, "agentId", respond);
    const grantId = requiredString(params, "grantId", respond);
    const runId = requiredString(params, "runId", respond);
    if (!commandId || !agentIdRaw || !grantId || !runId) {
      return;
    }
    const access = await assertClientMayAccessAgentDetailed(client, agentIdRaw, respond);
    if (!access?.tenantId) {
      return;
    }
    const evidenceRefs =
      Array.isArray(params.evidenceRefs) &&
      params.evidenceRefs.every((entry) => typeof entry === "string")
        ? params.evidenceRefs
        : [`obs:${runId}`];
    try {
      const plane = ensureEvolutionControlPlaneStarted();
      const result = await proposeWorkingDnaFromObservation({
        commandId,
        tenantId: access.tenantId,
        agentId: access.agentId,
        grantId,
        runId,
        evidenceRefs,
        candidateId: optionalString(params, "candidateId") ?? undefined,
        cfg: loadConfig(),
        plane,
      });
      if ("skipped" in result && result.skipped) {
        respond(true, { skipped: true, reason: result.reason });
        return;
      }
      respond(true, {
        proposal: result.proposal,
        candidateRef: result.candidateRef,
        proposalId: result.proposal.proposalId,
        grantRef: grantId,
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "working-dna proposal failed",
        ),
      );
    }
  },

  "pattern-detection.subscribe": async ({ params, respond, client }) => {
    // UI historically passed sessionKey as the sole scope argument.
    const agentIdRaw = resolveAgentScope(
      {
        ...params,
        sessionKey: params.sessionKey ?? params.agentId,
        agentId:
          typeof params.agentId === "string" && params.agentId.includes(":")
            ? undefined
            : params.agentId,
      },
      respond,
    );
    if (!agentIdRaw) {
      return;
    }
    const access = await assertClientMayAccessAgentDetailed(client, agentIdRaw, respond);
    if (!access) {
      return;
    }
    respond(
      true,
      {
        candidates: listPatternCandidates({
          agentId: access.agentId,
          tenantId: client ? access.tenantId : undefined,
          status: "candidate",
        }),
        mode: "snapshot",
      },
      undefined,
    );
  },
};
