/**
 * Evolution control-plane RPC pack.
 * Writes require a command ID and trusted tenant context.
 * Clients cannot submit verification outcomes.
 */

import type {
  EvolutionApplication,
  EvolutionExperiment,
  EvolutionProposal,
} from "@openbot/evolution-core";
import { loadConfig } from "../../config/config.js";
import { CONFIG_DIR } from "../../utils.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { createLiveEvolutionApplyAuthPorts } from "../evolution-control/apply-authorization-live.js";
import {
  decideEvolutionApplyAuthorization,
  evolutionApplyAuthPortsForTests,
  type EvolutionApplyAuthPorts,
} from "../evolution-control/apply-authorization.js";
import { approveApplicationAuthority } from "../evolution-control/approve-application.js";
import {
  authorizeShadowIntentProposal,
  projectShadowIntentOperatorHints,
  resolveAuthorizeShadowIntentInspector,
} from "../evolution-control/authorize-shadow-intent.js";
import {
  ensureEvolutionControlPlaneStarted,
  resetEvolutionControlPlaneForTests,
} from "../evolution-control/bootstrap.js";
import {
  confirmDiagnosisCandidatePreview,
  resolveDiagnosisCandidateConfirmDeps,
} from "../evolution-control/confirm-diagnosis-candidate.js";
import type { EvolutionControlPlane } from "../evolution-control/control-plane.js";
import { isDiagnosisSourced } from "../evolution-control/diagnosis-apply-gate.js";
import { persistLiveDiagnosisRecheck } from "../evolution-control/diagnosis-recheck-persist.js";
import {
  evaluatePromoteGateFromPersistedAudit,
  writeEffectVerificationAudit,
} from "../evolution-control/effect-verification-audit.js";
import { resolveEvolutionControlRoot } from "../evolution-control/persistent-store.js";
import {
  projectDiagnosisCandidateStatus,
  resolveDiagnosisCandidateStatusPorts,
} from "../evolution-control/project-diagnosis-candidate.js";
import { applyEvolutionRpcTestIdentity } from "../evolution-control/rpc-test-identity.js";
import { resolveEvolutionIngestAccess } from "../evolution-control/runtime-ingest-access.js";
import { alignDiagnosisExperimentFreeze } from "../evolution-control/submit-diagnosis-candidate.js";
import {
  listRegisteredEvolutionSurfaces,
  resolveEvolutionSurface,
} from "../evolution-control/surface-registry.js";
import {
  verifyWorkingDnaReadAfterWrite,
  WORKING_DNA_RAW_VERIFIER_ID,
} from "../evolution-control/verifiers/working-dna-raw.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import { optionalString, requiredString } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const FORBIDDEN_CLIENT_WRITE_KEYS = [
  "verified",
  "outcome",
  "primaryEffect",
  "verification",
  "unattended",
  "candidate",
  "evaluation",
  "decision",
] as const;

let testPlane: EvolutionControlPlane | undefined;

export function setEvolutionControlPlaneForTests(plane?: EvolutionControlPlane): void {
  testPlane = plane;
  if (!plane) {
    resetEvolutionControlPlaneForTests();
  }
}

function resolvePlane(): EvolutionControlPlane {
  if (testPlane) {
    return testPlane;
  }
  return ensureEvolutionControlPlaneStarted();
}

function trustedTenantId(client: GatewayClient | null): string | null {
  applyEvolutionRpcTestIdentity(client);
  const enterprise = client?.sessionEnterpriseId?.trim();
  if (enterprise) {
    return enterprise;
  }
  const tenant = client?.sessionTenantId?.trim();
  return tenant || null;
}

async function resolvedTrustedTenantId(client: GatewayClient | null): Promise<string | null> {
  const direct = trustedTenantId(client);
  if (direct) {
    return direct;
  }
  const membership = await resolveAuthoritativeMembership(client);
  return membership.tenantId;
}

function visibleToCaller(proposal: EvolutionProposal, tenantId: string | null): boolean {
  if (tenantId == null) {
    return true;
  }
  return proposal.tenantScope === tenantId;
}

function requireOperatorApprovalSession(
  client: GatewayClient | null,
  params: Record<string, unknown>,
  respond: RespondFn,
): string | null {
  if (
    "principalRef" in params ||
    "tenantId" in params ||
    "role" in params ||
    "approval" in params ||
    "ownerId" in params ||
    "grantId" in params
  ) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "clients cannot declare principalRef or tenantId, role, approval, ownerId, or grantId",
      ),
    );
    return null;
  }
  applyEvolutionRpcTestIdentity(client);
  const principalRef = client?.user?.trim() ?? "";
  if (!principalRef) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "operator identity is required"),
    );
    return null;
  }
  const scopes = client?.connect?.scopes;
  if (!Array.isArray(scopes) || !scopes.includes("operator.approvals")) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals"),
    );
    return null;
  }
  if (!client?.sessionKind) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "operator session is required"),
    );
    return null;
  }
  if (!client.platformUserId?.trim()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "platform user is required"));
    return null;
  }
  if (
    (client.sessionKind === "member" || client.sessionKind === "enterprise-admin") &&
    !client.sessionMembershipId?.trim()
  ) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "membership is required"));
    return null;
  }
  return principalRef;
}

async function authorizeGovernedWrite(input: {
  client: GatewayClient | null;
  respond: RespondFn;
  proposal: EvolutionProposal;
  plane: EvolutionControlPlane;
  action: "apply" | "verify";
  scope: EvolutionApplication["scope"];
  experimentId?: string;
}): Promise<{ principalRef: string; tenantId: string | null } | null> {
  const sessionKind = input.client?.sessionKind;
  if (!sessionKind || !input.client?.platformUserId?.trim()) {
    input.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "operator session is required"),
    );
    return null;
  }
  if (
    (sessionKind === "member" || sessionKind === "enterprise-admin") &&
    !input.client.sessionMembershipId?.trim()
  ) {
    input.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "membership is required"),
    );
    return null;
  }
  const ports: EvolutionApplyAuthPorts =
    evolutionApplyAuthPortsForTests() ?? createLiveEvolutionApplyAuthPorts();
  const actor = await ports.resolveActor(input.client ?? { sessionKind });
  const object = actor ? await ports.resolveObject(input.proposal) : null;
  if (!actor || !object || actor.userId !== input.client.platformUserId.trim()) {
    input.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "apply authorization is unresolved"),
    );
    return null;
  }
  const now = new Date().toISOString();
  const grant = await ports.resolveGrant({
    actor,
    object,
    action: input.action,
    scope: input.scope,
    now,
  });
  const decision = decideEvolutionApplyAuthorization({
    action: input.action,
    scope: input.scope,
    actor,
    object,
    grant,
    now,
  });
  if (!decision.ok) {
    input.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, decision.reason));
    return null;
  }
  if (
    input.action === "apply" &&
    input.scope === "active" &&
    isDiagnosisSourced(input.proposal) &&
    input.experimentId
  ) {
    const canary = input.plane
      .listApplications({ experimentId: input.experimentId })
      .some((row) => row.scope === "canary" && row.status === "applied");
    if (!canary) {
      input.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "diagnosis active apply requires a prior canary"),
      );
      return null;
    }
  }
  return { principalRef: actor.userId, tenantId: object.tenantId };
}

function rejectForbiddenClientWrites(params: Record<string, unknown>, respond: RespondFn): boolean {
  for (const key of FORBIDDEN_CLIENT_WRITE_KEYS) {
    if (key in params) {
      const message =
        key === "unattended"
          ? "clients cannot request unattended apply"
          : key === "candidate"
            ? "clients cannot submit a candidate payload"
            : key === "evaluation" || key === "decision"
              ? "clients cannot submit experiment evaluation"
              : "clients cannot submit verification outcomes";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      return true;
    }
  }
  return false;
}

function requireCommandId(params: Record<string, unknown>, respond: RespondFn): string | null {
  return requiredString(params, "commandId", respond);
}

async function applyBySurface(
  plane: EvolutionControlPlane,
  proposal: EvolutionProposal,
  input: {
    commandId: string;
    proposalId: string;
    experimentId: string;
    principalRef: string;
    trustedTenantId: string | null;
    scope: EvolutionApplication["scope"];
  },
): Promise<EvolutionApplication> {
  const command = {
    commandId: input.commandId,
    proposalId: input.proposalId,
    experimentId: input.experimentId,
    principalRef: input.principalRef,
    trustedTenantId: input.trustedTenantId,
    scope: input.scope,
  };
  if (proposal.surfaceId === "agent.working-dna") {
    return plane.applyWorkingDna(command);
  }
  if (proposal.surfaceId === "knowledge.experience-capsule") {
    return plane.applyCapsule(command);
  }
  if (
    proposal.surfaceId === "capability.skill-spec" ||
    proposal.surfaceId === "capability.skill-installation"
  ) {
    return plane.applySkill(command);
  }
  if (proposal.surfaceId === "organization.task-routing") {
    return plane.applyOrganization(command);
  }
  if (proposal.surfaceId === "system.runtime-binding-governance") {
    return plane.applyRuntimeGovernance(command);
  }
  throw new Error(`surface does not allow apply: ${proposal.surfaceId}`);
}

function projectProposalForOperator(
  plane: EvolutionControlPlane,
  proposal: EvolutionProposal,
): EvolutionProposal & {
  triageTag: string | null;
  observeOnly: boolean;
  nextAction: "authorize" | "request_experiment" | "reject" | "observe" | null;
  nextActionHint: string | null;
  capabilityGap: {
    category: string | null;
    lifecycle: string | null;
    triageTag: string | null;
    draftSkillId: string | null;
    governanceProposalId: string | null;
    ownerUserId: string | null;
    reason: string | null;
  } | null;
} {
  const payload = plane.getCandidate(proposal.candidateRef)?.payload as
    | Record<string, unknown>
    | undefined;
  const isGap = proposal.sourceMechanismRef.startsWith("capability-gap:");
  const triageTag =
    typeof payload?.triageTag === "string" && payload.triageTag.trim()
      ? payload.triageTag.trim()
      : null;
  const shadowHints = projectShadowIntentOperatorHints(proposal);
  return {
    ...proposal,
    triageTag,
    observeOnly: shadowHints.observeOnly,
    nextAction: shadowHints.nextAction,
    nextActionHint: shadowHints.nextActionHint,
    capabilityGap: isGap
      ? {
          category: typeof payload?.category === "string" ? payload.category : null,
          lifecycle: typeof payload?.lifecycle === "string" ? payload.lifecycle : null,
          triageTag,
          draftSkillId: typeof payload?.draftSkillId === "string" ? payload.draftSkillId : null,
          governanceProposalId:
            typeof payload?.governanceProposalId === "string" ? payload.governanceProposalId : null,
          ownerUserId: typeof payload?.ownerUserId === "string" ? payload.ownerUserId : null,
          reason: typeof payload?.reason === "string" ? payload.reason : null,
        }
      : null,
  };
}

export function createEvolutionControlHandlers(resolve = resolvePlane): GatewayRequestHandlers {
  return {
    "evolution.surfaces.list": async ({ respond }) => {
      resolve();
      respond(true, { surfaces: listRegisteredEvolutionSurfaces() });
    },
    "evolution.proposals.list": async ({ params, respond, client }) => {
      const tenantId = trustedTenantId(client);
      const plane = resolve();
      const safeParams = params ?? {};
      const triageFilter = optionalString(safeParams, "triageTag")?.trim() || null;
      const sourceFilter = optionalString(safeParams, "sourceMechanismPrefix")?.trim() || null;
      let proposals = plane
        .listProposals()
        .filter((row) => visibleToCaller(row, tenantId))
        .map((row) => projectProposalForOperator(plane, row));
      if (triageFilter) {
        proposals = proposals.filter((row) => row.triageTag === triageFilter);
      }
      if (sourceFilter) {
        proposals = proposals.filter((row) => row.sourceMechanismRef.startsWith(sourceFilter));
      }
      respond(true, { proposals });
    },
    "evolution.proposals.get": async ({ params, respond, client }) => {
      const proposalId = requiredString(params, "proposalId", respond);
      if (!proposalId) {
        return;
      }
      const plane = resolve();
      const proposal = plane.getProposal(proposalId);
      if (!proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "proposal not found"));
        return;
      }
      respond(true, { proposal: projectProposalForOperator(plane, proposal) });
    },
    "evolution.proposals.transition": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const proposalId = requiredString(params, "proposalId", respond);
      const command = optionalString(params, "command");
      if (!commandId || !proposalId) {
        return;
      }
      if (command !== "reject" && command !== "promote" && command !== "hold") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "only reject, promote, or hold is allowed on this RPC",
          ),
        );
        return;
      }
      const plane = resolve();
      const existing = plane.getProposal(proposalId);
      if (!existing || !visibleToCaller(existing, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "proposal not found"));
        return;
      }
      try {
        const request = {
          commandId,
          proposalId,
          principalRef: client?.user?.trim() || "operator",
          trustedTenantId: trustedTenantId(client),
        };
        const proposal =
          command === "promote"
            ? plane.promoteProposal(request)
            : command === "hold"
              ? plane.holdProposal(request)
              : plane.rejectProposal(request);
        respond(true, { proposal, receipt: { commandId, proposalId, status: proposal.status } });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "reject failed",
          ),
        );
      }
    },
    "evolution.proposals.authorize": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const proposalId = requiredString(params, "proposalId", respond);
      const grantId = requiredString(params, "grantId", respond);
      if (!commandId || !proposalId || !grantId) {
        return;
      }
      const scopes = client?.connect?.scopes;
      if (!Array.isArray(scopes) || !scopes.includes("operator.approvals")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals"),
        );
        return;
      }
      applyEvolutionRpcTestIdentity(client);
      const principalRef = client?.user?.trim() || "";
      if (!principalRef) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "operator identity is required"),
        );
        return;
      }
      const plane = resolve();
      const result = authorizeShadowIntentProposal(plane, resolveAuthorizeShadowIntentInspector(), {
        commandId,
        proposalId,
        grantId,
        principalRef,
        trustedTenantId: trustedTenantId(client),
        confirmedByUser: true,
      });
      if (!result.ok) {
        respond(false, { code: result.code }, errorShape(ErrorCodes.INVALID_REQUEST, result.code));
        return;
      }
      respond(true, {
        proposal: projectProposalForOperator(plane, result.proposal),
        alreadyAuthorized: result.alreadyAuthorized,
        eventId: result.eventId,
        receipt: {
          commandId,
          proposalId,
          status: result.proposal.status,
        },
      });
    },
    "evolution.experiments.create": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const proposalId = requiredString(params, "proposalId", respond);
      if (!commandId || !proposalId) {
        return;
      }
      const plane = resolve();
      const proposal = plane.getProposal(proposalId);
      if (!proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "proposal not found"));
        return;
      }
      const rawFreeze =
        params.freeze && typeof params.freeze === "object"
          ? (params.freeze as EvolutionExperiment["frozen"])
          : null;
      const resuming = proposal.status === "HELD";
      const existingExperiment =
        resuming && proposal.experimentId ? plane.getExperiment(proposal.experimentId) : undefined;
      const alignedFreeze = alignDiagnosisExperimentFreeze(
        proposal,
        plane.getCandidate(proposal.candidateRef),
        rawFreeze,
      );
      if (!resuming && !alignedFreeze) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "freeze is required"));
        return;
      }
      try {
        const experiment = await plane.startExperiment({
          commandId,
          proposalId,
          now: new Date().toISOString(),
          freeze: (existingExperiment?.frozen ?? {
            ...alignedFreeze,
            tenantScope: proposal.tenantScope,
          }) as Parameters<EvolutionControlPlane["startExperiment"]>[0]["freeze"],
        });
        respond(true, {
          experiment,
          receipt: { commandId, experimentId: experiment.experimentId },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "experiment create failed",
          ),
        );
      }
    },
    "evolution.experiments.get": async ({ params, respond, client }) => {
      const experimentId = requiredString(params, "experimentId", respond);
      if (!experimentId) {
        return;
      }
      const plane = resolve();
      const experiment = plane.getExperiment(experimentId);
      const proposal = experiment ? plane.getProposal(experiment.proposalId) : undefined;
      if (!experiment || !proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "experiment not found"));
        return;
      }
      respond(true, { experiment });
    },
    "evolution.experiments.evaluate": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const experimentId = requiredString(params, "experimentId", respond);
      if (!commandId || !experimentId) {
        return;
      }
      const plane = resolve();
      const experiment = plane.getExperiment(experimentId);
      const proposal = experiment ? plane.getProposal(experiment.proposalId) : undefined;
      if (!experiment || !proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "experiment not found"));
        return;
      }
      try {
        const evaluated = await plane.evaluateExperiment(experimentId);
        respond(true, {
          experiment: evaluated.experiment,
          decision: evaluated.decision,
          recommendedFollowUp: evaluated.recommendedFollowUp,
          receipt: { commandId, experimentId },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "evaluate failed",
          ),
        );
      }
    },
    "evolution.applications.apply": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      if (!requireOperatorApprovalSession(client, params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const proposalId = requiredString(params, "proposalId", respond);
      const experimentId = requiredString(params, "experimentId", respond);
      const scope = optionalString(params, "scope");
      if (!commandId || !proposalId || !experimentId) {
        return;
      }
      if (scope !== "shadow" && scope !== "canary" && scope !== "active") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "scope is required"));
        return;
      }
      const plane = resolve();
      const proposal = plane.getProposal(proposalId);
      if (!proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "proposal not found"));
        return;
      }
      const authorized = await authorizeGovernedWrite({
        client,
        respond,
        proposal,
        plane,
        action: "apply",
        scope,
        experimentId,
      });
      if (!authorized) {
        return;
      }
      try {
        const application = await applyBySurface(plane, proposal, {
          commandId,
          proposalId,
          experimentId,
          principalRef: authorized.principalRef,
          trustedTenantId: authorized.tenantId,
          scope,
        });
        respond(true, {
          application,
          receipt: {
            commandId,
            applicationId: application.applicationId,
            rollbackRef: application.rollbackRef,
          },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "apply failed",
          ),
        );
      }
    },
    "evolution.applications.approve": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const principalRef = requireOperatorApprovalSession(client, params, respond);
      if (!principalRef) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const applicationId = requiredString(params, "applicationId", respond);
      if (!commandId || !applicationId) {
        return;
      }
      const plane = resolve();
      try {
        const result = approveApplicationAuthority(plane, {
          commandId,
          applicationId,
          principalRef,
          trustedTenantId: trustedTenantId(client),
        });
        respond(true, {
          application: result.application,
          proposal: result.proposal,
          alreadyApproved: result.alreadyApproved,
          receipt: {
            commandId,
            applicationId: result.application.applicationId,
            eventId: result.eventId,
          },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "approve failed",
          ),
        );
      }
    },
    "evolution.applications.verify": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      if (!requireOperatorApprovalSession(client, params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const applicationId = requiredString(params, "applicationId", respond);
      if (!commandId || !applicationId) {
        return;
      }
      const plane = resolve();
      const application = plane.getApplication(applicationId);
      const proposal = application ? plane.getProposal(application.proposalId) : undefined;
      if (!application || !proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "application not found"));
        return;
      }
      const authorized = await authorizeGovernedWrite({
        client,
        respond,
        proposal,
        plane,
        action: "verify",
        scope: application.scope,
      });
      if (!authorized) {
        return;
      }
      try {
        const verification = await plane.verifyApplication({
          commandId,
          applicationId,
          principalRef: authorized.principalRef,
          trustedTenantId: authorized.tenantId,
        });
        respond(true, {
          verification,
          proposal: plane.getProposal(proposal.proposalId),
          receipt: { commandId, applicationId, verificationId: verification.verificationId },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "verify failed",
          ),
        );
      }
    },
    "evolution.applications.rollback": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const applicationId = requiredString(params, "applicationId", respond);
      if (!commandId || !applicationId) {
        return;
      }
      const plane = resolve();
      const application = plane.getApplication(applicationId);
      const proposal = application ? plane.getProposal(application.proposalId) : undefined;
      if (!application || !proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "application not found"));
        return;
      }
      try {
        const rolled = await plane.rollbackApplication({
          commandId,
          applicationId,
          principalRef: client?.user?.trim() || "operator",
          trustedTenantId: await resolvedTrustedTenantId(client),
        });
        respond(true, {
          application: rolled.application,
          receipt: { commandId, applicationId, status: rolled.application.status },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "rollback failed",
          ),
        );
      }
    },
    "evolution.verifications.get": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const verificationId = requiredString(params, "verificationId", respond);
      if (!verificationId) {
        return;
      }
      const plane = resolve();
      const verification = plane.getVerification(verificationId);
      const application = verification
        ? plane.getApplication(verification.applicationId)
        : undefined;
      const proposal = application ? plane.getProposal(application.proposalId) : undefined;
      if (!verification || !proposal || !visibleToCaller(proposal, trustedTenantId(client))) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "verification not found"));
        return;
      }
      respond(true, { verification });
    },
    "evolution.ledger.query": async ({ params, respond, client }) => {
      const tenantId = trustedTenantId(client);
      const proposalId = optionalString(params, "proposalId");
      const events = resolve()
        .ledger.list(proposalId ? { proposalId } : undefined)
        .filter((event) => tenantId == null || event.tenantScope === tenantId);
      respond(true, { events });
    },
    "evolution.task-outcomes.record": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const claimedAgentId = requiredString(params, "agentId", respond);
      if (!commandId || !claimedAgentId) {
        return;
      }
      const runId = optionalString(params, "runId");
      const access = await resolveEvolutionIngestAccess({
        client,
        claimedAgentId,
        runId,
        sessionKey: optionalString(params, "sessionKey"),
        ownershipProof: optionalString(params, "ownershipProof"),
        claimedTenantId: optionalString(params, "tenantId"),
        respond,
      });
      if (!access) {
        return;
      }
      if (!access.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required for task outcome"),
        );
        return;
      }
      if (!runId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "runId is required for production observation"),
        );
        return;
      }
      const succeeded = params.succeeded;
      if (typeof succeeded !== "boolean") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "succeeded must be a boolean"),
        );
        return;
      }
      try {
        await recordRunOutcome(loadConfig(), access.agentId, {
          success: succeeded,
          runId,
          tenantId: access.tenantId,
          // RPC/canary observation. Task success stays on TaskOutcome.
          countsAsTaskJudgement: false,
          occurredAt: typeof params.occurredAt === "number" ? params.occurredAt : Date.now(),
          ...(typeof params.latencyMs === "number" ? { latencyMs: params.latencyMs } : {}),
          ...(typeof params.securityViolation === "boolean"
            ? { securityViolation: params.securityViolation }
            : {}),
          ...(typeof params.crossTenantContamination === "boolean"
            ? { crossTenantContamination: params.crossTenantContamination }
            : {}),
          ...(typeof params.humanTakeover === "boolean"
            ? { humanTakeover: params.humanTakeover }
            : {}),
          evolutionPersistDir: resolveEvolutionControlRoot(),
        });
        respond(true, {
          outcome: {
            runId,
            agentId: access.agentId,
            tenantId: access.tenantId,
            surfaceId: "task.execution",
            commandId,
          },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "outcome write failed",
          ),
        );
      }
    },
    "evolution.working-dna.verify-effect": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const claimedAgentId = requiredString(params, "agentId", respond);
      if (!commandId || !claimedAgentId) {
        return;
      }
      const runId = optionalString(params, "runId");
      const surfaceId = optionalString(params, "surfaceId") ?? "agent.working-dna";
      const surface = resolveEvolutionSurface(surfaceId);
      if (!surface || surface.externalVerificationPolicy === "unsupported") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `surface does not support external effect verification: ${surfaceId}`,
          ),
        );
        return;
      }
      const access = await resolveEvolutionIngestAccess({
        client,
        claimedAgentId,
        runId,
        sessionKey: optionalString(params, "sessionKey"),
        ownershipProof: optionalString(params, "ownershipProof"),
        claimedTenantId: optionalString(params, "tenantId"),
        respond,
      });
      if (!access) {
        return;
      }
      if (!access.tenantId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "tenant membership required for effect verification",
          ),
        );
        return;
      }
      if (!runId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "runId is required for production observation"),
        );
        return;
      }
      const field = optionalString(params, "field") ?? "riskPreference";
      const expectedValue = optionalString(params, "expectedValue");
      if (!expectedValue) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "expectedValue is required"),
        );
        return;
      }
      try {
        const observed = await verifyWorkingDnaReadAfterWrite({
          cfg: loadConfig(),
          agentId: access.agentId,
          expectedEffect: {
            kind: "working-style-field",
            field,
            expectedValue,
          },
          applicationReceiptRef: `rpc:${commandId}`,
        });
        const audit = writeEffectVerificationAudit({
          runId,
          agentId: access.agentId,
          tenantId: access.tenantId,
          surfaceId,
          target: { domain: "agent", agentId: access.agentId },
          afterState: {
            receipt: observed.observationReceiptRef,
            observedTargetVersion: observed.observedTargetVersion ?? null,
          },
          outcome: observed.outcome,
          verifierVersion: WORKING_DNA_RAW_VERIFIER_ID,
          reason: observed.observationReceiptRef,
          persistDir: resolveEvolutionControlRoot(),
        });
        respond(true, {
          verification: {
            runId,
            agentId: access.agentId,
            tenantId: access.tenantId,
            surfaceId,
            result: audit.result,
            outcome: observed.outcome,
            receipt: observed.observationReceiptRef,
            verifierId: WORKING_DNA_RAW_VERIFIER_ID,
            commandId,
          },
        });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : "effect verification failed",
          ),
        );
      }
    },
    "evolution.working-dna.evaluate-promote": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const claimedAgentId = requiredString(params, "agentId", respond);
      if (!commandId || !claimedAgentId) {
        return;
      }
      const runId = optionalString(params, "runId");
      const surfaceId = optionalString(params, "surfaceId") ?? "agent.working-dna";
      const surface = resolveEvolutionSurface(surfaceId);
      if (!surface || surface.externalVerificationPolicy === "unsupported") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `surface does not support external effect verification: ${surfaceId}`,
          ),
        );
        return;
      }
      const access = await resolveEvolutionIngestAccess({
        client,
        claimedAgentId,
        runId,
        sessionKey: optionalString(params, "sessionKey"),
        ownershipProof: optionalString(params, "ownershipProof"),
        claimedTenantId: optionalString(params, "tenantId"),
        respond,
      });
      if (!access) {
        return;
      }
      if (!access.tenantId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required for promote gate"),
        );
        return;
      }
      if (!runId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "runId is required for production observation"),
        );
        return;
      }
      const gate = evaluatePromoteGateFromPersistedAudit({
        runId,
        agentId: access.agentId,
        tenantId: access.tenantId,
        surfaceId,
        persistDir: resolveEvolutionControlRoot(),
      });
      if (!gate.ok) {
        respond(
          false,
          {
            gate: {
              ok: false,
              code: gate.code,
              reason: gate.reason,
              runId,
              agentId: access.agentId,
              tenantId: access.tenantId,
              surfaceId,
              commandId,
            },
          },
          errorShape(ErrorCodes.INVALID_REQUEST, gate.reason),
        );
        return;
      }
      respond(true, {
        gate: {
          ok: true,
          reason: gate.reason,
          verificationId: gate.verificationId,
          runId,
          agentId: access.agentId,
          tenantId: access.tenantId,
          surfaceId,
          commandId,
        },
      });
    },
    "evolution.diagnosis.recheck": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const principalRef = requireOperatorApprovalSession(client, params, respond);
      if (!principalRef) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const applicationId = requiredString(params, "applicationId", respond);
      if (!commandId || !applicationId) {
        return;
      }
      const verificationId = optionalString(params, "verificationId");
      const receiptId = optionalString(params, "receiptId");
      const tenantId = await resolvedTrustedTenantId(client);
      if (!tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenant is required"));
        return;
      }
      const plane = resolve();
      try {
        const result = await persistLiveDiagnosisRecheck({
          plane,
          persistDir: resolveEvolutionControlRoot(),
          commandId,
          applicationId,
          ...(verificationId ? { verificationId } : {}),
          ...(receiptId ? { receiptId } : {}),
          operatorId: principalRef,
          trustedTenantId: tenantId,
        });
        respond(true, {
          result: result.result,
          receipt: result.receipt,
          proposal: result.proposal,
          application: result.application,
          verification: result.verification,
          writes: {
            commandId,
            applicationId: result.application.applicationId,
            verificationId: result.verification.verificationId,
            receiptId: result.receipt.receiptId,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "diagnosis recheck failed";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      }
    },
    "evolution.diagnosis.status": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const candidateVersion = requiredString(params, "candidateVersion", respond);
      if (!candidateVersion) {
        return;
      }
      const tenantId = await resolvedTrustedTenantId(client);
      if (!tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenant is required"));
        return;
      }
      const projection = projectDiagnosisCandidateStatus({
        tenantId,
        candidateVersion,
        ports: resolveDiagnosisCandidateStatusPorts(),
      });
      respond(true, { projection });
    },
    "evolution.diagnosis.submit": async ({ params, respond, client }) => {
      if (rejectForbiddenClientWrites(params, respond)) {
        return;
      }
      const commandId = requireCommandId(params, respond);
      const grantId = requiredString(params, "grantId", respond);
      const candidateVersion = requiredString(params, "candidateVersion", respond);
      if (!commandId || !grantId || !candidateVersion) {
        return;
      }
      const tenantId = await resolvedTrustedTenantId(client);
      if (!tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenant is required"));
        return;
      }
      const result = await confirmDiagnosisCandidatePreview({
        commandId,
        grantId,
        candidateVersion,
        tenantId,
        principalRef: client?.user?.trim() || "operator",
        confirmedByUser: true,
        configDir: CONFIG_DIR,
        clientParams: params,
        deps: resolveDiagnosisCandidateConfirmDeps(CONFIG_DIR),
      });
      if (!result.ok) {
        respond(
          false,
          { code: result.code, writes: result.writes },
          errorShape(ErrorCodes.INVALID_REQUEST, result.code),
        );
        return;
      }
      respond(true, { receipt: result.receipt, writes: result.writes });
    },
  };
}

export const evolutionControlHandlers = createEvolutionControlHandlers();
