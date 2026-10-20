/**
 * Platform Capability Handlers — 平台企业提交审核 RPC 网关方法。
 *
 * 模块定位：
 * Phase 4 平台侧企业提交审核通道，支持平台运营人员审阅经脱敏后的企业资产包。
 *
 * 方法清单：
 * 1. platform-capability.enterprise-submissions       — 列出待审企业提交
 * 2. platform-capability.review-enterprise-submission  — 获取单个提交详情
 * 3. platform-capability.publish-enterprise-capability — 发布企业能力到平台
 * 4. platform-capability.reject-enterprise-capability    — 拒绝企业提交
 */

import { recordAdminRecommendForCapability } from "../asset-incubation-adoption-store.js";
import { findProposalBySkillKey, registerCapability } from "../capability-governance-store.js";
import {
  getEnterpriseSubmission,
  getSanitizedPackage,
  listEnterpriseSubmissions,
  updateEnterpriseSubmission,
} from "../capability-install-governance-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { optionalString as stringParam } from "./request-params.js";
import type { GatewayRequestHandlers } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────
// Handlers — read from shared enterprise submission store (P0-6)
// ─────────────────────────────────────────────────────────────────────────

export const platformCapabilityHandlers: GatewayRequestHandlers = {
  "platform-capability.enterprise-submissions": ({ params, respond }) => {
    const statusFilter = stringParam(params, "status");
    const all = listEnterpriseSubmissions();
    const submissions = statusFilter ? all.filter((s) => s.status === statusFilter) : all;

    respond(
      true,
      {
        submissions: submissions.map((s) => {
          const sanitizedPackageId = s.sanitizedPackageId ?? null;
          const sanitizedPackage = sanitizedPackageId
            ? getSanitizedPackage(sanitizedPackageId)
            : null;
          return {
            submissionId: s.submissionId,
            capabilityId: s.capabilityId,
            capabilityName: s.capabilityName,
            enterpriseId: s.enterpriseId,
            enterpriseName: s.enterpriseName,
            submittedAt: s.submittedAt,
            status: s.status,
            sanitized: s.sanitized,
            sanitizationFindings: s.sanitizationFindings,
            sanitizedPackageId,
            artifactHash: sanitizedPackage?.artifact.contentHash ?? null,
          };
        }),
        total: submissions.length,
        pendingCount: all.filter((s) => s.status === "pending-review").length,
        reviewingCount: all.filter((s) => s.status === "reviewing").length,
      },
      undefined,
    );
  },

  "platform-capability.review-enterprise-submission": ({ params, respond }) => {
    const submissionId = stringParam(params, "submissionId");
    if (!submissionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "submissionId is required"));
      return;
    }

    const submission = getEnterpriseSubmission(submissionId);
    if (!submission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `submission not found: ${submissionId}`),
      );
      return;
    }

    const sanitizedPackageId = submission.sanitizedPackageId ?? null;
    const sanitizedPackage = sanitizedPackageId ? getSanitizedPackage(sanitizedPackageId) : null;

    respond(
      true,
      {
        submissionId: submission.submissionId,
        capabilityId: submission.capabilityId,
        capabilityName: submission.capabilityName,
        enterpriseId: submission.enterpriseId,
        enterpriseName: submission.enterpriseName,
        submittedAt: submission.submittedAt,
        status: submission.status,
        sanitized: submission.sanitized,
        sanitizationFindings: submission.sanitizationFindings,
        sourceProvenance: submission.sourceProvenance,
        reviewerId: submission.reviewerId,
        reviewedAt: submission.reviewedAt,
        rejectionReason: submission.rejectionReason,
        sanitizedPackageId,
        artifactHash: sanitizedPackage?.artifact.contentHash ?? null,
      },
      undefined,
    );
  },

  "platform-capability.publish-enterprise-capability": ({ params, respond }) => {
    const submissionId = stringParam(params, "submissionId");
    if (!submissionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "submissionId is required"));
      return;
    }

    const submission = getEnterpriseSubmission(submissionId);
    if (!submission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `submission not found: ${submissionId}`),
      );
      return;
    }

    if (!submission.sanitized) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "cannot publish unsanitized enterprise submission"),
      );
      return;
    }

    const now = Date.now();
    const reviewerId =
      typeof params.reviewerId === "string" ? params.reviewerId : "platform-reviewer";
    updateEnterpriseSubmission(submissionId, {
      status: "published",
      reviewerId,
      reviewedAt: now,
      publishedAt: now,
    });

    // P1-5: register capability in governance registry
    const proposal = findProposalBySkillKey(submission.capabilityId);
    registerCapability(
      {
        id: submission.capabilityId,
        kind: "skill",
        version: "1.0.0",
        skillKey: submission.capabilityId,
        name: submission.capabilityName,
        description: `企业资产 "${submission.capabilityName}" 经平台审核后发布`,
        source: {
          kind: "enterprise-submission",
          origin: submission.enterpriseId,
          trustTier: "enterprise-certified",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      proposal?.proposalId,
      {
        // Default stays the submitting tenant. Expanding to other tenants is an
        // explicit distribution step, not a side effect of publish.
        distributionScope: { tenantIds: [submission.enterpriseId] },
        defaultEnabled: true,
        employeeVisibilityMode: "enterprise_review_required",
        updatedBy: reviewerId,
      },
    );

    recordAdminRecommendForCapability({
      capabilityId: submission.capabilityId,
      recommenderId: reviewerId,
      ownerKey: "platform",
    });

    respond(
      true,
      {
        submissionId: submission.submissionId,
        capabilityId: submission.capabilityId,
        status: "published",
        publishedAt: now,
        message: "企业能力已通过审核并发布到平台市场",
      },
      undefined,
    );
  },

  "platform-capability.reject-enterprise-capability": ({ params, respond }) => {
    const submissionId = stringParam(params, "submissionId");
    const rejectionReason = stringParam(params, "rejectionReason");
    if (!submissionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "submissionId is required"));
      return;
    }

    const submission = getEnterpriseSubmission(submissionId);
    if (!submission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `submission not found: ${submissionId}`),
      );
      return;
    }

    const now = Date.now();
    const reviewerId =
      typeof params.reviewerId === "string" ? params.reviewerId : "platform-reviewer";
    updateEnterpriseSubmission(submissionId, {
      status: "rejected",
      reviewerId,
      reviewedAt: now,
      rejectionReason: rejectionReason ?? "不符合平台发布标准",
    });

    respond(
      true,
      {
        submissionId: submission.submissionId,
        capabilityId: submission.capabilityId,
        status: "rejected",
        rejectedAt: now,
        rejectionReason: rejectionReason ?? "不符合平台发布标准",
        message: "企业提交已被拒绝",
      },
      undefined,
    );
  },

  "platform-capability.return-for-modification": ({ params, respond }) => {
    const submissionId = stringParam(params, "submissionId");
    const returnNotes = stringParam(params, "returnNotes");
    if (!submissionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "submissionId is required"));
      return;
    }

    const submission = getEnterpriseSubmission(submissionId);
    if (!submission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `submission not found: ${submissionId}`),
      );
      return;
    }

    const now = Date.now();
    const reviewerId =
      typeof params.reviewerId === "string" ? params.reviewerId : "platform-reviewer";
    updateEnterpriseSubmission(submissionId, {
      status: "returned-for-modification",
      reviewerId,
      reviewedAt: now,
      returnNotes: returnNotes ?? "需要修改后重新提交",
    });

    respond(
      true,
      {
        submissionId: submission.submissionId,
        capabilityId: submission.capabilityId,
        status: "returned-for-modification",
        returnedAt: now,
        returnNotes: returnNotes ?? "需要修改后重新提交",
        message: "企业提交已退回修改",
      },
      undefined,
    );
  },

  "platform-capability.approve-enterprise-only": ({ params, respond }) => {
    const submissionId = stringParam(params, "submissionId");
    if (!submissionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "submissionId is required"));
      return;
    }

    const submission = getEnterpriseSubmission(submissionId);
    if (!submission) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `submission not found: ${submissionId}`),
      );
      return;
    }

    const now = Date.now();
    const reviewerId =
      typeof params.reviewerId === "string" ? params.reviewerId : "platform-reviewer";
    updateEnterpriseSubmission(submissionId, {
      status: "enterprise-only",
      reviewerId,
      reviewedAt: now,
      publishedAt: now,
    });

    // Register capability as enterprise-only (not platform-wide)
    const proposal = findProposalBySkillKey(submission.capabilityId);
    registerCapability(
      {
        id: submission.capabilityId,
        kind: "skill",
        version: "1.0.0",
        skillKey: submission.capabilityId,
        name: submission.capabilityName,
        description: `企业资产 "${submission.capabilityName}" 经平台审核后仅限企业内部使用`,
        source: {
          kind: "enterprise-submission",
          origin: submission.enterpriseId,
          trustTier: "enterprise-only",
        },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
      },
      proposal?.proposalId,
      {
        distributionScope: { tenantIds: [submission.enterpriseId] },
        defaultEnabled: false,
        employeeVisibilityMode: "enterprise_only",
        updatedBy: reviewerId,
      },
    );

    recordAdminRecommendForCapability({
      capabilityId: submission.capabilityId,
      recommenderId: reviewerId,
      ownerKey: "platform",
    });

    respond(
      true,
      {
        submissionId: submission.submissionId,
        capabilityId: submission.capabilityId,
        status: "enterprise-only",
        approvedAt: now,
        message: "企业提交已批准仅供企业内部使用",
      },
      undefined,
    );
  },
};
