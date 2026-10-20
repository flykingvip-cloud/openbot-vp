import { adaptPlatformAuthHost } from "./app-host-adapters.ts";
import type { OpenBotApp } from "./app.ts";
import { spacesCapability } from "./capability/spaces/index.ts";
import { adaptSpacesLoadCapabilityState } from "./capability/view-state.ts";
import {
  getEnterpriseHandoverDetail,
  getEnterpriseSeatDetail,
} from "./controllers/enterprise-seat-assets.ts";
import { pathForTab } from "./navigation.ts";
import {
  detectHandoverExceptionFlags,
  filterTransferableHandoverPolicyIds,
} from "./ports/enterprise/views/enterprise-handover-asset-helpers.ts";

/**
 * Enterprise handover editor orchestration pulled out of the control-ui shell.
 * Class methods on OpenBotApp remain the public surface and delegate here.
 */

export function openEnterpriseHandoverEditor(
  host: OpenBotApp,
  params: {
    handoverCaseId: string;
    seatTitle: string;
    seatId?: string | null;
    status: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
  },
) {
  host.platformAuthNotice = null;
  host.closeEnterpriseSeatOfferEditor();
  host.enterpriseHandoverEditorCaseId = params.handoverCaseId;
  host.enterpriseHandoverEditorSeatTitle = params.seatTitle;
  host.enterpriseHandoverEditorSeatId = params.seatId ?? null;
  host.enterpriseHandoverEditorStatus = params.status;
  host.enterpriseHandoverEditorReviewSummary = params.reviewSummary?.trim() ?? "";
  host.enterpriseHandoverEditorExceptionFlags = (params.exceptionFlags ?? []).join(", ");
  host.enterpriseHandoverEditorSuccessorEmail = params.incomingEmployeeUser?.trim() ?? "";
  host.enterpriseHandoverEditorSeatStatus = null;
  host.enterpriseHandoverEditorDefaultAgentIds = [];
  host.enterpriseHandoverEditorDefaultSpaceIds = [];
  host.enterpriseHandoverEditorSelectedAgentIds = [];
  host.enterpriseHandoverEditorSelectedDataKeys = ["recent_sessions", "knowledge"];
  host.enterpriseHandoverEditorSelectedSpaceIds = [];
  host.enterpriseHandoverEditorSelectedPolicyIds = [];
  host.enterpriseHandoverEditorDraftNotice = null;
  host.enterpriseHandoverEditorCurrentEmployeeEmail = null;
  host.enterpriseHandoverEditorCurrentEmployeeDisplayName = null;
  host.enterpriseHandoverEditorBindingStatus = null;
  host.enterpriseHandoverEditorEmployeePolicies = [];
  host.enterpriseHandoverEditorSeatPolicies = [];
  host.enterpriseHandoverEditorTeamLabel = null;
  host.enterpriseHandoverEditorAssetSnapshot = null;
  host.enterpriseHandoverEditorAssetQuery = "";
  host.enterpriseHandoverEditorAssetKindFilter = "all";
}

export async function openEnterpriseHandoverRoute(
  host: OpenBotApp,
  params: {
    tenantId: string;
    handoverCaseId: string;
    seatTitle?: string;
    status?: string;
    reviewSummary?: string | null;
    exceptionFlags?: string[];
    incomingEmployeeUser?: string | null;
    replace?: boolean;
  },
) {
  openEnterpriseHandoverEditor(host, {
    handoverCaseId: params.handoverCaseId,
    seatTitle: params.seatTitle ?? host.enterpriseHandoverEditorSeatTitle,
    status: params.status ?? host.enterpriseHandoverEditorStatus ?? "draft",
    reviewSummary: params.reviewSummary ?? "",
    exceptionFlags: params.exceptionFlags,
    incomingEmployeeUser: params.incomingEmployeeUser,
  });
  if (typeof window !== "undefined") {
    const href = pathForTab("enterpriseOrganization", host.basePath, {
      tenantId: params.tenantId,
      context: {
        tenantId: params.tenantId,
        handoverCaseId: params.handoverCaseId,
        sourcePort: "enterprise",
        sourcePage: "enterpriseOrganization",
      },
    });
    if (params.replace) {
      window.history.replaceState({}, "", href);
    } else {
      window.history.pushState({}, "", href);
    }
  }
  await syncEnterpriseHandoverRoute(host, {
    tenantId: params.tenantId,
    handoverCaseId: params.handoverCaseId,
    replace: true,
  });
}

export async function syncEnterpriseHandoverRoute(
  host: OpenBotApp,
  context: {
    tenantId?: string;
    handoverCaseId?: string;
    replace?: boolean;
  } | null,
) {
  const tenantId = context?.tenantId?.trim();
  const handoverCaseId = context?.handoverCaseId?.trim();
  if (!tenantId || !handoverCaseId) {
    if (host.enterpriseHandoverEditorCaseId) {
      closeEnterpriseHandoverEditor(host);
    }
    return;
  }
  const detail = await getEnterpriseHandoverDetail(
    adaptPlatformAuthHost(host),
    tenantId,
    handoverCaseId,
  );
  if (!detail?.handover) {
    return;
  }
  openEnterpriseHandoverEditor(host, {
    handoverCaseId: detail.handover.handoverCaseId,
    seatTitle:
      detail.handover.seatTitle?.trim() ||
      host.platformAuthState?.organization?.handovers.find(
        (entry) => entry.handoverCaseId === detail.handover.handoverCaseId,
      )?.seatTitle ||
      "",
    seatId: detail.handover.seatId ?? null,
    status: detail.handover.status,
    reviewSummary: detail.handover.reviewSummary ?? "",
    exceptionFlags: (() => {
      const existing = detail.handover.exceptionFlags ?? [];
      if (existing.length > 0) {
        return existing;
      }
      const snapshot = (
        detail.handover as {
          assetSnapshot?: {
            connectorCredentialReauthorizationRequired?: boolean;
            memoryScopes?: Array<{ transferClass?: string }>;
          };
        }
      ).assetSnapshot;
      return detectHandoverExceptionFlags({
        connectorCredentialReauthorizationRequired:
          snapshot?.connectorCredentialReauthorizationRequired,
        memoryScopes: snapshot?.memoryScopes,
      });
    })(),
    incomingEmployeeUser: detail.handover.incomingEmployee?.email ?? null,
  });
  const snapshot = (
    detail.handover as {
      assetSnapshot?: {
        agentIds?: string[];
        spaceIds?: string[];
        memoryScopeIds?: string[];
        memoryScopes?: Array<{ scopeId: string; transferClass: string }>;
        connectorProfiles?: Array<{
          profileId: string;
          credentialReauthorizationRequired: boolean;
        }>;
        connectorCredentialReauthorizationRequired?: boolean;
        frozenAssetBindingIds?: string[];
        rebindRequiredAssetBindingIds?: string[];
        sessionDataTransfer?: {
          recentSessions?: boolean;
          historyArchive?: boolean;
          coveredAgentIds?: string[];
          executedAt?: string;
          archivedSessionIds?: string[];
          recentSessionIds?: string[];
          archivedTranscriptCount?: number;
        };
      };
    }
  ).assetSnapshot;
  host.enterpriseHandoverEditorAssetSnapshot = snapshot
    ? {
        agentIds: [...(snapshot.agentIds ?? [])],
        spaceIds: [...(snapshot.spaceIds ?? [])],
        memoryScopeIds: [...(snapshot.memoryScopeIds ?? [])],
        memoryScopes: [...(snapshot.memoryScopes ?? [])],
        connectorProfiles: [...(snapshot.connectorProfiles ?? [])],
        connectorCredentialReauthorizationRequired: Boolean(
          snapshot.connectorCredentialReauthorizationRequired,
        ),
        frozenAssetBindingIds: [...(snapshot.frozenAssetBindingIds ?? [])],
        rebindRequiredAssetBindingIds: [...(snapshot.rebindRequiredAssetBindingIds ?? [])],
        sessionDataTransfer: snapshot.sessionDataTransfer
          ? {
              recentSessions: Boolean(snapshot.sessionDataTransfer.recentSessions),
              historyArchive: Boolean(snapshot.sessionDataTransfer.historyArchive),
              coveredAgentIds: [...(snapshot.sessionDataTransfer.coveredAgentIds ?? [])],
              ...(snapshot.sessionDataTransfer.executedAt?.trim()
                ? { executedAt: snapshot.sessionDataTransfer.executedAt.trim() }
                : {}),
              ...(snapshot.sessionDataTransfer.archivedSessionIds
                ? { archivedSessionIds: [...snapshot.sessionDataTransfer.archivedSessionIds] }
                : {}),
              ...(snapshot.sessionDataTransfer.recentSessionIds
                ? { recentSessionIds: [...snapshot.sessionDataTransfer.recentSessionIds] }
                : {}),
              ...(typeof snapshot.sessionDataTransfer.archivedTranscriptCount === "number"
                ? {
                    archivedTranscriptCount: snapshot.sessionDataTransfer.archivedTranscriptCount,
                  }
                : {}),
            }
          : null,
      }
    : null;
  const seatDetail = await getEnterpriseSeatDetail(
    adaptPlatformAuthHost(host),
    tenantId,
    detail.handover.seatId,
  );
  if (seatDetail?.detail) {
    host.enterpriseHandoverEditorSeatStatus = seatDetail.detail.seat.status;
    host.enterpriseHandoverEditorTeamLabel = seatDetail.detail.seat.teamLabel ?? null;
    host.enterpriseHandoverEditorDefaultAgentIds = [...seatDetail.detail.seat.defaultAgentIds];
    host.enterpriseHandoverEditorDefaultSpaceIds = [...seatDetail.detail.seat.defaultSpaceIds];
    host.enterpriseHandoverEditorSelectedAgentIds = [...seatDetail.detail.seat.defaultAgentIds];
    host.enterpriseHandoverEditorSelectedSpaceIds = [...seatDetail.detail.seat.defaultSpaceIds];
    host.enterpriseHandoverEditorCurrentEmployeeEmail =
      seatDetail.detail.currentEmployee?.email ?? detail.handover.outgoingEmployee?.email ?? null;
    host.enterpriseHandoverEditorCurrentEmployeeDisplayName =
      seatDetail.detail.currentEmployee?.displayName ??
      detail.handover.outgoingEmployee?.displayName ??
      null;
    host.enterpriseHandoverEditorBindingStatus = seatDetail.detail.binding?.status ?? null;
    host.enterpriseHandoverEditorEmployeePolicies = seatDetail.detail.access.employeePolicies.map(
      (policy) => ({
        policyId: policy.policyId,
        resourceType: policy.resourceType,
        resourceId: policy.resourceId,
        action: policy.action,
      }),
    );
    host.enterpriseHandoverEditorSeatPolicies = seatDetail.detail.access.seatPolicies.map(
      (policy) => ({
        policyId: policy.policyId,
        resourceType: policy.resourceType,
        resourceId: policy.resourceId,
        action: policy.action,
      }),
    );
    host.enterpriseHandoverEditorSelectedPolicyIds = filterTransferableHandoverPolicyIds(
      host.enterpriseHandoverEditorEmployeePolicies.map((policy) => policy.policyId),
      host.enterpriseHandoverEditorEmployeePolicies,
    );
  }
  if (typeof window !== "undefined" && context?.replace) {
    const href = pathForTab("enterpriseOrganization", host.basePath, {
      tenantId,
      context: {
        tenantId,
        handoverCaseId,
        sourcePort: "enterprise",
        sourcePage: "enterpriseOrganization",
      },
    });
    window.history.replaceState({}, "", href);
  }
  await spacesCapability.load(adaptSpacesLoadCapabilityState(host));
}

export function closeEnterpriseHandoverEditor(host: OpenBotApp) {
  host.enterpriseHandoverEditorCaseId = null;
  host.enterpriseHandoverEditorSeatTitle = "";
  host.enterpriseHandoverEditorSeatId = null;
  host.enterpriseHandoverEditorStatus = null;
  host.enterpriseHandoverEditorReviewSummary = "";
  host.enterpriseHandoverEditorExceptionFlags = "";
  host.enterpriseHandoverEditorSuccessorEmail = "";
  host.enterpriseHandoverEditorSeatStatus = null;
  host.enterpriseHandoverEditorDefaultAgentIds = [];
  host.enterpriseHandoverEditorDefaultSpaceIds = [];
  host.enterpriseHandoverEditorSelectedAgentIds = [];
  host.enterpriseHandoverEditorSelectedDataKeys = [];
  host.enterpriseHandoverEditorSelectedSpaceIds = [];
  host.enterpriseHandoverEditorSelectedPolicyIds = [];
  host.enterpriseHandoverEditorDraftNotice = null;
  host.enterpriseHandoverEditorCurrentEmployeeEmail = null;
  host.enterpriseHandoverEditorCurrentEmployeeDisplayName = null;
  host.enterpriseHandoverEditorBindingStatus = null;
  host.enterpriseHandoverEditorEmployeePolicies = [];
  host.enterpriseHandoverEditorSeatPolicies = [];
  host.enterpriseHandoverEditorTeamLabel = null;
  host.enterpriseHandoverEditorAssetSnapshot = null;
  host.enterpriseHandoverEditorAssetQuery = "";
  host.enterpriseHandoverEditorAssetKindFilter = "all";
  const tenantId =
    host.platformAuthState?.session?.tenantId?.trim() ??
    host.hello?.auth?.tenantId?.trim() ??
    host.bootstrapAuthSession?.tenantId?.trim() ??
    "";
  if (typeof window !== "undefined" && tenantId) {
    const href = pathForTab("enterpriseOrganization", host.basePath, {
      tenantId,
      context: {
        tenantId,
        sourcePort: "enterprise",
        sourcePage: "enterpriseOrganization",
      },
    });
    window.history.replaceState({}, "", href);
  }
}
