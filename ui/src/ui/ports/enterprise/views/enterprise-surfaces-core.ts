import { html } from "lit";
import { normalizeLegacyTab, pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { diagnosisTargetsFromEnterpriseRoster } from "../../diagnosis/diagnosis-targets.ts";
import { enterpriseEvolutionDecisionSurfaceMountEnabled } from "../evolution-decision/runtime-gate.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { renderAccessControlCenter } from "./enterprise-access-control-surface.ts";
import { renderEnterpriseCapabilityCenterSurface } from "./enterprise-capability-center-surface.ts";
import { renderEnterpriseDataGovernanceCenterSurface } from "./enterprise-data-governance-center-surface.ts";
import "./enterprise-evolution-decision-surface.ts";
import { renderMeshGovernanceSurface } from "./enterprise-mesh-governance-surface.ts";
import "../diagnosis/enterprise-diagnosis-page.ts";
import { renderEnterpriseMessageChannelsSurface } from "./enterprise-message-channels-surface.ts";
import { renderOrganizationControl } from "./enterprise-organization-surface.ts";
import { renderEnterpriseOverviewSurface } from "./enterprise-overview-surface.ts";
import {
  renderEnterpriseAuthRequiredSurface,
  renderEnterpriseDataNotice,
  renderEnterpriseSeatLimitNotice,
  renderEnterpriseTrialExpiredSurface,
  requestEnterpriseAppRerender,
} from "./enterprise-surface-shared.ts";
import { type EnterpriseSurfaceProps, isEnterpriseSurfaceTab } from "./enterprise-surface-types.ts";
import { renderEnterpriseUsageSurface } from "./enterprise-usage-surface.ts";

function withEnterpriseReadModelDefaults(
  readModel: EnterprisePortReadModel,
): EnterprisePortReadModel {
  const partial = readModel as Partial<EnterprisePortReadModel>;
  const memberUsers = partial.memberUsers ?? [];
  const memberSummaries = partial.memberSummaries ?? [];
  const runtimeHosts = partial.runtimeHosts ?? [];
  const groupIds = partial.groupIds ?? [];
  const meshUsers = partial.meshUsers ?? [];
  const meshAgents = partial.meshAgents ?? [];
  const meshGroups = partial.meshGroups ?? [];
  const meshAnomalies = partial.meshAnomalies ?? [];
  const meshSummary =
    partial.meshSummary ??
    ({
      userCount: meshUsers.length || memberUsers.length || memberSummaries.length,
      agentCount: meshAgents.length,
      groupCount: meshGroups.length || groupIds.length,
      onlineAgentCount: 0,
      activeAgentCount: 0,
      activeGroupCount: 0,
      activeAgentRate: 0,
      activeGroupRate: 0,
      totalCost: partial.totalCost ?? 0,
      totalTokens: partial.totalTokens ?? 0,
      costPerSession: 0,
      sessionCount: partial.sessionsCount ?? 0,
      inefficientAssetCount: 0,
      unattributedCostCount: 0,
      unownedAssetCount: 0,
      governanceIssueCount: meshAnomalies.length,
    } satisfies EnterprisePortReadModel["meshSummary"]);

  return {
    ...readModel,
    memberUsers,
    memberSummaries,
    seatSummaries: partial.seatSummaries ?? [],
    handoverSummaries: partial.handoverSummaries ?? [],
    offerSummaries: partial.offerSummaries ?? [],
    runtimeHosts,
    groupIds,
    channelIds: partial.channelIds ?? [],
    providerIds: partial.providerIds ?? [],
    configuredModelIds: partial.configuredModelIds ?? [],
    configIssueLabels: partial.configIssueLabels ?? [],
    resolverOptions: partial.resolverOptions ?? [],
    meshSummary,
    meshUsers,
    meshAgents,
    meshGroups,
    meshAnomalies,
  };
}

export function renderEnterpriseSurface(props: EnterpriseSurfaceProps) {
  const normalizedTab = normalizeLegacyTab(props.tab);
  const normalizedProps: EnterpriseSurfaceProps = {
    ...props,
    tab: isEnterpriseSurfaceTab(normalizedTab) ? normalizedTab : props.tab,
    readModel: withEnterpriseReadModelDefaults(props.readModel),
    ownershipTransferEditor:
      props.ownershipTransferEditor ??
      ({
        open: false,
        tenantId: null,
        subjectKind: null,
        subjectId: null,
        subjectLabel: "",
        positionId: null,
        positionLabel: "",
        currentManagerUserId: null,
        currentManagerLabel: "",
        selectedUserId: "",
        candidateMembers: [],
        busy: false,
        error: null,
        notice: null,
        onOpen: () => undefined,
        onClose: () => undefined,
        onSelectedUserChange: () => undefined,
        onSubmit: () => undefined,
      } satisfies EnterpriseSurfaceProps["ownershipTransferEditor"]),
    identityManagementEditor:
      props.identityManagementEditor ??
      ({
        open: false,
        mode: "register",
        identityId: "",
        policyId: "",
        bindingId: "",
        displayName: "",
        credentialBindingId: "",
        provider: "",
        registerStep: "provider",
        seatIds: "",
        agentIds: "",
        allowedActions: "",
        dataSourceId: "",
        bindingPurpose: "source_sync",
        busy: false,
        error: null,
        notice: null,
        eligibleCredentialBindings: [],
        eligibleDataSources: [],
        identityOptions: [],
        onOpen: () => undefined,
        onClose: () => undefined,
        onDisplayNameChange: () => undefined,
        onCredentialBindingIdChange: () => undefined,
        onRegisterProviderSelect: () => undefined,
        onRegisterProviderBack: () => undefined,
        onStartOAuth: () => undefined,
        policyPickerQuery: "",
        policyDepartmentPaths: "",
        credentialFields: {},
        credentialFieldsReady: false,
        credentialSecretsConfigured: [],
        onCredentialFieldChange: () => undefined,
        onSaveCredentialConfig: () => undefined,
        onPolicyPickerQueryChange: () => undefined,
        onPolicyDepartmentPathsChange: () => undefined,
        onIdentityIdChange: () => undefined,
        onSeatIdsChange: () => undefined,
        onAgentIdsChange: () => undefined,
        onAllowedActionsChange: () => undefined,
        onDataSourceIdChange: () => undefined,
        onBindingPurposeChange: () => undefined,
        onSubmit: () => undefined,
      } as unknown as EnterpriseSurfaceProps["identityManagementEditor"]),
  };
  const { readModel, basePath } = normalizedProps;
  const expiredSurface = renderEnterpriseTrialExpiredSurface(normalizedProps);
  if (expiredSurface) {
    // 试用到期：只渲染到期卡片自身（卡片内已包含升级 / 联系顾问操作），
    // 不再附加平台层的注册/登录面板，避免在企业 tab 内暴露平台账号入口。
    return expiredSurface;
  }
  const seatLimitNotice = renderEnterpriseSeatLimitNotice({
    authPanelProps: normalizedProps.authPanelProps,
  });
  const dataNotice = renderEnterpriseDataNotice(readModel);
  const authRequiredSurface = renderEnterpriseAuthRequiredSurface({
    basePath,
    readModel,
    authPanelProps: normalizedProps.authPanelProps,
    onSwitchToEnterpriseAdmin: normalizedProps.actions.organization.onSwitchToEnterpriseAdmin,
  });
  if (authRequiredSurface) {
    return authRequiredSurface;
  }

  switch (normalizedProps.tab) {
    case "enterpriseOverview":
      return renderEnterpriseOverviewSurface(normalizedProps, basePath);
    case "enterpriseOrganization":
      return renderOrganizationControl(normalizedProps);
    case "enterpriseDataGovernanceCenter":
      return renderEnterpriseDataGovernanceCenterSurface(normalizedProps, basePath);
    case "enterpriseCapabilityCenter":
      return renderEnterpriseCapabilityCenterSurface(normalizedProps, basePath);
    case "enterpriseMesh": {
      // Phase 4: Legacy shell absorbs Active (assets-page embed + ranking-page).
      const mesh = renderMeshGovernanceSurface(normalizedProps, basePath);
      // D3.3 mount: the enterprise Decision Surface follows the Mesh surface only
      // when the reviewed runtime gate is open. The gate is closed, so this case
      // returns the Mesh template unchanged. The element is bare on purpose: no
      // principal, snapshot source, submit context, or client is wired here, so
      // even an open gate would render and read nothing.
      return enterpriseEvolutionDecisionSurfaceMountEnabled()
        ? html`${mesh}<enterprise-evolution-decision-surface></enterprise-evolution-decision-surface>`
        : mesh;
    }
    case "enterpriseDiagnosis":
      return html`<openbot-diagnosis-panel
        .client=${normalizedProps.client ?? null}
        role="enterprise"
        .tenantId=${normalizedProps.readModel.currentTenantId}
        .targets=${diagnosisTargetsFromEnterpriseRoster({
          agents: normalizedProps.readModel.meshAgents,
          groups: normalizedProps.readModel.meshGroups,
          spaces: normalizedProps.collaborationSpacesResult?.spaces,
        })}
      ></openbot-diagnosis-panel>`;
    case "enterpriseUsage":
      return renderEnterpriseUsageSurface(normalizedProps, basePath);
    case "enterpriseChannels": {
      const editor = normalizedProps.channelCredentialsEditor;
      const tenantId = normalizedProps.readModel.currentTenantId ?? editor?.tenantId ?? null;
      return renderEnterpriseMessageChannelsSurface({
        host: normalizedProps.client ?? normalizedProps,
        props: {
          client: normalizedProps.client ?? null,
          tenantId,
          syncBusy: editor?.syncBusy,
          identityLinkHint: editor?.identityLinkHint ?? null,
          onSyncOperationalIdentity: editor?.onSyncOperationalIdentity
            ? (channelId) => {
                editor.onSelectChannel(channelId);
                editor.onSyncOperationalIdentity?.();
              }
            : undefined,
          onNavigateToIdentities: () => {
            const settingsPath = pathForTab("enterpriseSettings", normalizedProps.basePath, {
              tenantId: tenantId ?? undefined,
            });
            const href = settingsPath.endsWith("/settings")
              ? `${settingsPath}/identities`
              : `${settingsPath}/settings/identities`;
            pushAppHistoryState(href);
            requestEnterpriseAppRerender();
          },
        },
        requestUpdate: requestEnterpriseAppRerender,
      });
    }
    case "enterpriseSettings":
      return renderAccessControlCenter(normalizedProps, [seatLimitNotice, dataNotice]);
  }

  return html``;
}
