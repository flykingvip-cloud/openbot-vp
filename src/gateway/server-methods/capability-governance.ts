// Gateway handlers for capabilities.governance.* methods.

import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import { loadConfig } from "../../config/config.js";
import {
  ensureDisplayedSkillProposal,
  missingGovernanceProposalMessage,
  type DisplayedSkillCard,
} from "../capability-governance-displayed-proposal.js";
import {
  approveAndRegister,
  getProposal,
  listProposals,
  listRegistry,
  submitProposal,
  updateRegistryManifest,
  updateProposalStatus,
  updateRegistryDistribution,
  updateRegistryLifecycle,
  type GovernanceProposal,
} from "../capability-governance-store.js";
import { resolveRemoteCapabilityImport } from "../capability-remote-import.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { rematerializeApprovedEnterpriseSkill } from "../skill-enterprise-submission.js";
import { resolveWorkspaceLocator } from "../workspace-resolver/strict-locator.js";
import { exactMember } from "./request-params.js";
import type { GatewayRequestHandlers } from "./types.js";

function loadInstalledDisplayedSkillCards(): DisplayedSkillCard[] {
  try {
    const cfg = loadConfig();
    const located = resolveWorkspaceLocator({ cfg });
    const workspaceDir = located.ok
      ? located.handle.locator
      : resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
    return report.skills.map((skill) => ({
      skillKey: skill.skillKey,
      name: skill.name,
      description: skill.description,
      source: skill.source,
    }));
  } catch {
    return [];
  }
}

let displayedSkillCardLoader: () => DisplayedSkillCard[] = loadInstalledDisplayedSkillCards;

/** Test seam. Pass null to restore the installed-skill loader. */
export function __setDisplayedSkillCardLoaderForTest(
  loader: (() => DisplayedSkillCard[]) | null,
): void {
  displayedSkillCardLoader = loader ?? loadInstalledDisplayedSkillCards;
}

function proposalReadyForReview(proposalId: string): GovernanceProposal | null {
  return (
    getProposal(proposalId) ?? ensureDisplayedSkillProposal(proposalId, displayedSkillCardLoader())
  );
}

export const capabilityGovernanceHandlers: GatewayRequestHandlers = {
  "capabilities.governance.listProposals": ({ params, respond }) => {
    const p = (params ?? {}) as { status?: string; limit?: number; offset?: number };
    let proposals = listProposals();
    if (p.status) {
      proposals = proposals.filter((pr) => pr.status === p.status);
    }
    const offset = p.offset ?? 0;
    const limit = p.limit ?? 100;
    const slice = proposals.slice(offset, offset + limit);
    respond(true, { proposals: slice, total: proposals.length, offset, limit }, undefined);
  },

  "capabilities.governance.listRegistry": ({ params, respond }) => {
    const p = (params ?? {}) as { lifecycleState?: string; limit?: number; offset?: number };
    let entries = listRegistry();
    if (p.lifecycleState) {
      entries = entries.filter((e) => e.lifecycleState === p.lifecycleState);
    }
    const offset = p.offset ?? 0;
    const limit = p.limit ?? 100;
    const slice = entries.slice(offset, offset + limit);
    respond(true, { entries: slice, total: entries.length, offset, limit }, undefined);
  },

  "capabilities.governance.resolveRemoteImport": async ({ params, respond }) => {
    const p = (params ?? {}) as { input?: string };
    const input = p.input?.trim();
    if (!input) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "input is required"));
      return;
    }
    try {
      const items = await resolveRemoteCapabilityImport(input);
      respond(true, { items }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "remote capability import failed",
        ),
      );
    }
  },

  "capabilities.governance.submitProposal": ({ params, respond }) => {
    const p = params as {
      proposalId: string;
      manifest: Record<string, unknown>;
      findings?: Array<Record<string, unknown>>;
      submittedBy?: string;
    };
    if (!p?.proposalId || !p?.manifest) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "proposalId and manifest are required"),
      );
      return;
    }
    const proposal: GovernanceProposal = {
      proposalId: p.proposalId,
      submittedAt: new Date().toISOString(),
      submittedBy: p.submittedBy,
      status: "proposed",
      manifest: p.manifest as GovernanceProposal["manifest"],
      findings: (p.findings ?? []) as GovernanceProposal["findings"],
    };
    // Platform discovery imports only. Personal → enterprise submit must use
    // submitSkillToEnterpriseReview (employee-capability.submit-to-enterprise /
    // personal-skills.submit / skill-review.submit).
    const saved = submitProposal(proposal);
    respond(true, { proposal: saved }, undefined);
  },

  "capabilities.governance.approveProposal": ({ params, respond }) => {
    const p = params as { proposalId: string; reviewerId: string; note?: string };
    if (!p?.proposalId || !p?.reviewerId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "proposalId and reviewerId are required"),
      );
      return;
    }
    if (!getProposal(p.proposalId)) {
      ensureDisplayedSkillProposal(p.proposalId, displayedSkillCardLoader());
    }
    const result = approveAndRegister(p.proposalId, p.reviewerId, p.note);
    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, missingGovernanceProposalMessage(p.proposalId)),
      );
      return;
    }
    rematerializeApprovedEnterpriseSkill(result.proposal.manifest.skillKey);
    respond(true, result, undefined);
  },

  "capabilities.governance.rejectProposal": ({ params, respond }) => {
    const p = params as { proposalId: string; reviewerId: string; note?: string };
    if (!p?.proposalId || !p?.reviewerId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "proposalId and reviewerId are required"),
      );
      return;
    }
    if (!proposalReadyForReview(p.proposalId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, missingGovernanceProposalMessage(p.proposalId)),
      );
      return;
    }
    const updated = updateProposalStatus(p.proposalId, "rejected", {
      id: p.reviewerId,
      note: p.note,
    });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, missingGovernanceProposalMessage(p.proposalId)),
      );
      return;
    }
    respond(true, { proposal: updated }, undefined);
  },

  "capabilities.governance.updateLifecycle": ({ params, respond }) => {
    const p = params as { manifestId: string; state: string };
    if (!p?.manifestId || !p?.state) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "manifestId and state are required"),
      );
      return;
    }
    const state = exactMember(p.state, [
      "draft",
      "review",
      "approved",
      "active",
      "deprecated",
      "retired",
    ] as const);
    if (!state) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid state: ${p.state}`),
      );
      return;
    }
    const entry = updateRegistryLifecycle(p.manifestId, state);
    if (!entry) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `registry entry ${p.manifestId} not found`),
      );
      return;
    }
    respond(true, { entry }, undefined);
  },

  "capabilities.governance.updateDistribution": ({ params, respond }) => {
    const p = params as {
      manifestId: string;
      scope?: { tenantIds?: string[]; channelIds?: string[]; agentIds?: string[] };
      defaultEnabled?: boolean;
      employeeVisibilityMode?: "enterprise_review_required" | "direct_employee_visible";
      updatedBy?: string;
    };
    if (!p?.manifestId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "manifestId is required"));
      return;
    }
    const entry = updateRegistryDistribution(
      p.manifestId,
      p.scope ?? {},
      p.defaultEnabled ?? true,
      p.employeeVisibilityMode ?? "enterprise_review_required",
      p.updatedBy,
    );
    if (!entry) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `registry entry ${p.manifestId} not found`),
      );
      return;
    }
    respond(true, { entry }, undefined);
  },

  "capabilities.governance.updateManifest": ({ params, respond }) => {
    const p = params as {
      manifestId: string;
      patch?: {
        name?: string;
        description?: string;
        descriptionZh?: string;
        categoryId?: string;
      };
    };
    if (!p?.manifestId || !p?.patch) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "manifestId and patch are required"),
      );
      return;
    }
    const entry = updateRegistryManifest(p.manifestId, p.patch);
    if (!entry) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `registry entry ${p.manifestId} not found`),
      );
      return;
    }
    respond(true, { entry }, undefined);
  },
};
