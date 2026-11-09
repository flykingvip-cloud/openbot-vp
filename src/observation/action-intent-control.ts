/** Isolated-test bridge to the existing control plane. Intent expected versions are enforced by the original adapter content CAS. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EvolutionApplication } from "@openbot/evolution-core";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import type { WorkingStyle } from "../gateway/agent-growth/genome.js";
import { readRobotWorkingStyleOrDefault } from "../gateway/agent-growth/working-style-store.js";
import type { createWorkingDnaAdapter } from "../gateway/evolution-control/adapters/working-dna.js";
import type { EvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import type {
  ActionIntent,
  ApprovalEvidence,
  ControlReceipt,
  createTestActionIntentFactory,
} from "./action-intent.js";
export function workingDnaContentDigest(style: WorkingStyle): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        style.outputFormat,
        style.reportingCadence,
        style.decisionPreference,
        style.riskPreference,
        style.communicationTone,
      ]),
    )
    .digest("hex");
}
export class IsolatedControlFailure extends Error {
  constructor(
    message: string,
    readonly intent: ActionIntent,
    readonly receipt: ControlReceipt,
    readonly application: EvolutionApplication | undefined,
  ) {
    super(message);
    this.name = "IsolatedControlFailure";
  }
}
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
export function createIsolatedWorkingDnaControl(options: {
  rootDir: string;
  cfg: OpenBotConfig;
  agentId: string;
  tenantId: string;
  proposalId: string;
  experimentId: string;
  persistDir: string;
  plane: EvolutionControlPlane;
  adapter: ReturnType<typeof createWorkingDnaAdapter>;
  intents: ReturnType<typeof createTestActionIntentFactory>;
  readApproval: () => ApprovalEvidence | null;
  now: () => number;
  readStyle?: () => Promise<WorkingStyle>;
}) {
  const root = fs.realpathSync(options.rootDir);
  const temp = fs.realpathSync(os.tmpdir());
  if (
    !within(temp, root) ||
    !within(root, fs.realpathSync(resolveAgentDir(options.cfg, options.agentId))) ||
    !within(root, fs.realpathSync(options.persistDir))
  ) {
    throw new Error("isolated_test_directories_required");
  }
  const readStyle =
    options.readStyle ?? (() => readRobotWorkingStyleOrDefault(options.cfg, options.agentId));
  const inspect = () => options.adapter.inspect({ domain: "agent", agentId: options.agentId });
  const check = (intent: ActionIntent) => {
    if (
      !options.intents.owns(intent) ||
      intent.evidence.environment !== "test" ||
      intent.evidence.provenance !== "injected" ||
      !intent.evidence.improvementEligible ||
      intent.evidence.eligibility !== "eligible"
    ) {
      throw new Error("test_evidence_required");
    }
    if (
      intent.target.controlPlane !== "evolution.working-dna" ||
      intent.target.targetId !== options.agentId ||
      intent.target.scopeRef !== options.tenantId
    ) {
      throw new Error("target_mismatch");
    }
  };
  const receipt = (
    intent: ActionIntent,
    commandId: string,
    status: ControlReceipt["status"],
    actualVersion: string | null,
    requestDigest: string,
  ): ControlReceipt => ({
    receiptId: commandId + ":" + status,
    commandId,
    idempotencyKey: commandId,
    requestDigest,
    intentRevision: intent.authorizedRevision!,
    target: intent.target,
    status,
    at: options.now(),
    actualVersion,
  });
  const transition = (
    intent: ActionIntent,
    event: Parameters<ReturnType<typeof createTestActionIntentFactory>["transition"]>[1],
  ) =>
    options.intents.transition(intent, event, {
      now: options.now(),
      expectedRevision: intent.revision,
      approval: options.readApproval(),
    });
  const validateApproval = (intent: ActionIntent) => {
    const approval = options.readApproval();
    if (
      !approval ||
      !Number.isFinite(approval.issuedAt) ||
      !Number.isFinite(approval.expiresAt) ||
      approval.source !== "user" ||
      approval.approvalId !== intent.approval?.approvalId ||
      approval.actorRef !== intent.approval?.actorRef ||
      approval.intentRevision !== intent.authorizedRevision ||
      JSON.stringify(approval.target) !== JSON.stringify(intent.target) ||
      approval.revokedAt !== null ||
      approval.issuedAt > options.now() ||
      approval.expiresAt <= options.now() ||
      !approval.actorRef
    ) {
      throw new Error("approval_invalid");
    }
    return approval;
  };
  const validateApplication = (intent: ActionIntent, application: EvolutionApplication) => {
    const stored = options.plane.getApplication(application.applicationId);
    const proposal = options.plane.getProposal(options.proposalId);
    if (
      !stored ||
      JSON.stringify(stored) !== JSON.stringify(application) ||
      application.applicationId !== "app:" + intent.command?.commandId ||
      application.proposalId !== options.proposalId ||
      application.experimentId !== options.experimentId ||
      proposal?.target.domain !== "agent" ||
      proposal.target.agentId !== options.agentId ||
      proposal.tenantScope !== options.tenantId
    ) {
      throw new Error("application_mismatch");
    }
  };
  return {
    inspect,
    async submit(intent: ActionIntent, commandId: string, scope: "canary" | "shadow" = "canary") {
      check(intent);
      if (!["authorized", "accepted", "executing"].includes(intent.state)) {
        throw new Error("authorized_intent_required");
      }
      const requestDigest = createHash("sha256")
        .update(
          JSON.stringify([
            intent.actionIntentId,
            intent.target,
            options.proposalId,
            options.experimentId,
            scope,
          ]),
        )
        .digest("hex");
      const assertApproval = () => validateApproval(intent);
      assertApproval();
      const prior = options.plane.getApplication("app:" + commandId);
      if (!prior && (await inspect()).version !== intent.target.expectedConfigVersion) {
        throw new Error("expected_version_conflict");
      }
      const proposal = options.plane.getProposal(options.proposalId);
      if (
        proposal?.target.domain !== "agent" ||
        proposal.target.agentId !== options.agentId ||
        proposal.tenantScope !== options.tenantId
      ) {
        throw new Error("proposal_target_mismatch");
      }
      assertApproval();
      if (
        prior &&
        (prior.proposalId !== options.proposalId ||
          prior.experimentId !== options.experimentId ||
          prior.scope !== scope)
      ) {
        throw new Error("command_rebind");
      }
      let application: EvolutionApplication;
      try {
        application =
          prior ??
          (await options.adapter.withExpectedVersion(
            commandId,
            intent.target.expectedConfigVersion,
            () =>
              options.plane.applyWorkingDna({
                commandId,
                proposalId: options.proposalId,
                experimentId: options.experimentId,
                principalRef: options.readApproval()!.actorRef,
                trustedTenantId: options.tenantId,
                scope,
                unattended: false,
              }),
          ));
      } catch (error) {
        const observed = options.plane.getApplication("app:" + commandId);
        const failureReceipt = receipt(
          intent,
          commandId,
          "failed",
          observed?.targetVersionAfter ?? null,
          requestDigest,
        );
        const failed = transition(intent, { type: "receipt", receipt: failureReceipt });
        throw new IsolatedControlFailure(
          error instanceof Error ? error.message : "control_failed",
          failed.intent,
          failureReceipt,
          observed,
        );
      }
      const succeeded = transition(intent, {
        type: "receipt",
        receipt: receipt(
          intent,
          commandId,
          "succeeded",
          application.targetVersionAfter,
          requestDigest,
        ),
      });
      if (!succeeded.ok) {
        return {
          status: "applied_but_unrecorded" as const,
          intent: succeeded.intent,
          application,
          receipt: receipt(
            intent,
            commandId,
            "succeeded",
            application.targetVersionAfter,
            requestDigest,
          ),
          reason: succeeded.reason,
          doNotRetry: true as const,
          limitations: [
            "content_cas_aba_possible",
            "non_transactional_receipt_persistence",
            "isolated_injected_test_only",
          ],
        };
      }
      return {
        status: "recorded" as const,
        intent: succeeded.intent,
        application,
        limitations: [
          "content_cas_aba_possible",
          "non_transactional_receipt_persistence",
          "isolated_injected_test_only",
        ],
      };
    },
    async readback(intent: ActionIntent, application: EvolutionApplication) {
      check(intent);
      if (
        application.applicationId !== "app:" + intent.command?.commandId ||
        application.proposalId !== options.proposalId ||
        application.experimentId !== options.experimentId ||
        !application.appliedToRuntime ||
        application.scope === "shadow"
      ) {
        throw new Error("runtime_application_required");
      }
      validateApplication(intent, application);
      validateApproval(intent);
      const snapshot = await inspect();
      const style = await readStyle();
      return transition(intent, {
        type: "readback",
        readback: {
          readbackId: application.applicationId + ":readback",
          controlPlane: intent.target.controlPlane,
          targetId: options.agentId,
          scopeRef: options.tenantId,
          actualVersion: snapshot.version,
          actualDiffDigest: workingDnaContentDigest(style),
          observedAt: options.now(),
        },
      });
    },
    async rollback(intent: ActionIntent, application: EvolutionApplication, commandId: string) {
      check(intent);
      const approval = validateApproval(intent);
      validateApplication(intent, application);
      if (
        !["effective", "verified"].includes(intent.state) ||
        application.scope === "shadow" ||
        !application.appliedToRuntime
      ) {
        throw new Error("rollback_authorization_required");
      }
      const beforeRollback = await inspect();
      if (beforeRollback.version !== application.targetVersionAfter) {
        throw new Error("rollback_current_version_conflict");
      }
      validateApproval(intent);
      const result = await options.plane.rollbackApplication({
        commandId,
        applicationId: application.applicationId,
        principalRef: approval.actorRef,
        trustedTenantId: options.tenantId,
      });
      if (result.application.status !== "rolled_back") {
        throw new Error("rollback_failed");
      }
      const snapshot = await inspect();
      const style = await readStyle();
      return transition(intent, {
        type: "rollback",
        receipt: receipt(
          intent,
          commandId,
          "succeeded",
          snapshot.version,
          intent.target.rollbackDiffDigest,
        ),
        readback: {
          readbackId: commandId + ":readback",
          controlPlane: intent.target.controlPlane,
          targetId: options.agentId,
          scopeRef: options.tenantId,
          actualVersion: snapshot.version,
          actualDiffDigest: workingDnaContentDigest(style),
          observedAt: options.now(),
        },
      });
    },
  };
}
