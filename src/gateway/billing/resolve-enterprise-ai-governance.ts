/**
 * Enterprise AI Governance 投影（Wave 3：审批 + 审计覆盖率 + 合规摘要）。
 */

import {
  resolveCreditsV2RolloutStage,
  resolveEffectiveCreditsV2Enabled,
  type CreditsV2RolloutStage,
} from "./credits-v2-rollout.js";
import { getOverAllocationState } from "./over-allocation-store.js";
import { resolveCommercialAuditCoverage } from "./resolve-commercial-audit-coverage.js";
import {
  resolveCreditsV2Enabled,
  type CommercialPricingEngine,
} from "./resolve-commercial-credit-cost.js";
import { resolvePendingGovernanceApprovals } from "./resolve-pending-governance-approvals.js";
import type { GovernancePendingApprovalItem } from "./resolve-pending-governance-approvals.js";
import { getActiveSubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";

export type EnterpriseComplianceStatus = "compliant" | "attention" | "action_required";

export type EnterprisePrivateModelStatus = "disabled" | "compliant" | "over_allocated";

export type EnterpriseAIGovernanceProjection = {
  enterpriseId: string;
  creditsV2Enabled: boolean;
  creditsV2RolloutStage: CreditsV2RolloutStage;
  creditsV2Effective: boolean;
  creditsPricingEngine: CommercialPricingEngine;
  auditLogEnabled: boolean;
  mfaEnabled: boolean;
  ssoEnabled: boolean;
  vpcIsolationEnabled: boolean;
  tenantAllowPrivateModels: boolean;
  privateModelsCompliant: boolean;
  privateModelsOver: number;
  privateModelStatus: EnterprisePrivateModelStatus;
  pendingApprovalsCount: number;
  pendingApprovalsByCategory: Record<string, number>;
  recentPendingApprovals: GovernancePendingApprovalItem[];
  auditCoverageRatio: number | null;
  auditCoverageGap: number;
  complianceStatus: EnterpriseComplianceStatus;
  complianceIssues: string[];
};

export type EnterpriseAIGovernanceStorePaths = {
  runtimeSnapshots?: string;
  overAllocation?: string;
  enterpriseData?: string;
  usageLedger?: string;
};

function resolvePrivateModelStatus(input: {
  tenantAllowPrivateModels: boolean;
  privateModelsOver: number;
}): EnterprisePrivateModelStatus {
  if (!input.tenantAllowPrivateModels) {
    return "disabled";
  }
  return input.privateModelsOver > 0 ? "over_allocated" : "compliant";
}

function resolveComplianceSummary(input: {
  auditLogEnabled: boolean;
  auditCoverageRatio: number | null;
  auditCoverageGap: number;
  pendingApprovalsCount: number;
  privateModelStatus: EnterprisePrivateModelStatus;
  privateModelsOver: number;
  mfaEnabled: boolean;
  ssoEnabled: boolean;
}): { status: EnterpriseComplianceStatus; issues: string[] } {
  const issues: string[] = [];
  if (input.pendingApprovalsCount > 0) {
    issues.push(`待审批治理请求 ${input.pendingApprovalsCount} 条`);
  }
  if (input.privateModelStatus === "over_allocated") {
    issues.push(`私有模型超配 ${input.privateModelsOver}`);
  }
  if (
    input.auditLogEnabled &&
    input.auditCoverageRatio !== null &&
    input.auditCoverageRatio < 0.95
  ) {
    issues.push(
      `运行审计链未闭环（authorizationDecisionId 覆盖率 ${Math.round(input.auditCoverageRatio * 100)}%）`,
    );
  }
  if (input.auditLogEnabled && input.auditCoverageGap > 0) {
    issues.push(`本周期 ${input.auditCoverageGap} 条 ledger 缺少授权决策 ID`);
  }
  if (!input.mfaEnabled && !input.ssoEnabled) {
    issues.push("建议启用 MFA 或 SSO 强化访问控制");
  }

  let status: EnterpriseComplianceStatus = "compliant";
  if (
    input.privateModelStatus === "over_allocated" ||
    input.pendingApprovalsCount > 0 ||
    (input.auditLogEnabled && input.auditCoverageRatio !== null && input.auditCoverageRatio < 0.8)
  ) {
    status = "action_required";
  } else if (issues.length > 0) {
    status = "attention";
  }
  return { status, issues };
}

export async function resolveEnterpriseAIGovernanceProjection(
  enterpriseId: string,
  storePaths?: EnterpriseAIGovernanceStorePaths,
): Promise<EnterpriseAIGovernanceProjection> {
  const runtimeSnapshot = await getActiveSubscriptionRuntimeSnapshot(
    enterpriseId,
    storePaths?.runtimeSnapshots,
  );
  const features = runtimeSnapshot?.entitlementSnapshot.features;
  const creditsV2Enabled = resolveCreditsV2Enabled(features);
  const creditsV2RolloutStage = resolveCreditsV2RolloutStage(enterpriseId);
  const creditsV2Effective = resolveEffectiveCreditsV2Enabled(enterpriseId, features);
  const overAllocation = await getOverAllocationState(enterpriseId, storePaths?.overAllocation);
  const privateModelsOver = overAllocation?.privateModelsOver ?? 0;
  const tenantAllowPrivateModels = runtimeSnapshot?.entitlementSnapshot.allowPrivateModels === true;
  const privateModelStatus = resolvePrivateModelStatus({
    tenantAllowPrivateModels,
    privateModelsOver,
  });

  const [pendingApprovals, auditCoverage] = await Promise.all([
    resolvePendingGovernanceApprovals(enterpriseId, storePaths?.enterpriseData).catch(() => ({
      totalPending: 0,
      pendingByCategory: {
        source_onboarding: 0,
        data_access: 0,
        capability_exposure: 0,
        identity_binding: 0,
        seat_capability_access: 0,
      },
      recentPending: [],
    })),
    resolveCommercialAuditCoverage(enterpriseId, {
      auditLogEnabled: features?.auditLog === true,
      usageLedger: storePaths?.usageLedger,
    }),
  ]);

  const auditCoverageGap = Math.max(
    0,
    auditCoverage.ledgerEntryCount - auditCoverage.withAuthorizationDecision,
  );
  const compliance = resolveComplianceSummary({
    auditLogEnabled: features?.auditLog === true,
    auditCoverageRatio: auditCoverage.coverageRatio,
    auditCoverageGap,
    pendingApprovalsCount: pendingApprovals.totalPending,
    privateModelStatus,
    privateModelsOver,
    mfaEnabled: features?.mfa === true,
    ssoEnabled: features?.sso === true,
  });

  return {
    enterpriseId,
    creditsV2Enabled,
    creditsV2RolloutStage,
    creditsV2Effective,
    creditsPricingEngine: creditsV2Effective ? "v2" : "v1",
    auditLogEnabled: features?.auditLog === true,
    mfaEnabled: features?.mfa === true,
    ssoEnabled: features?.sso === true,
    vpcIsolationEnabled: features?.vpcIsolation === true,
    tenantAllowPrivateModels,
    privateModelsCompliant: privateModelStatus !== "over_allocated",
    privateModelsOver,
    privateModelStatus,
    pendingApprovalsCount: pendingApprovals.totalPending,
    pendingApprovalsByCategory: pendingApprovals.pendingByCategory,
    recentPendingApprovals: pendingApprovals.recentPending,
    auditCoverageRatio: auditCoverage.coverageRatio,
    auditCoverageGap,
    complianceStatus: compliance.status,
    complianceIssues: compliance.issues,
  };
}
