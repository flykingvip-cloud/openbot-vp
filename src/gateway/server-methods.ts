import {
  deriveOperatorIdFromGatewayClient,
  withOperatorStateScope,
} from "../config/operator-state-scope.js";
import { ensureDiagnosisSchedulerStarted } from "../diagnosis/bootstrap.js";
import { withPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import { salesLeadsHandlers } from "./billing/sales-leads-handlers.js";
import { contextScopeHandlers } from "./context-scope/handlers.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "./control-plane-audit.js";
import { consumeControlPlaneWriteBudget } from "./control-plane-rate-limit.js";
import { ensureEvolutionControlPlaneStarted } from "./evolution-control/bootstrap.js";
import { ensureEvolutionGovernanceSchedulerStarted } from "./evolution-governance/index.js";
import { ADMIN_SCOPE, authorizeOperatorScopesForMethod } from "./method-scopes.js";
import { enforceEnterpriseSessionForGatewayClient } from "./platform-auth/session-context.js";
import { guardSessionDomain } from "./platform-auth/session-domain.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { isRoleAuthorizedForMethod, parseGatewayRole } from "./role-policy.js";
import { accountComputerLoginHandlers } from "./server-methods/account-computer-login.js";
import { agentGrowthHandlers } from "./server-methods/agent-growth.js";
import { agentInstallRequestHandlers } from "./server-methods/agent-install-request.js";
import { agentRuntimeHandlers } from "./server-methods/agent-runtime.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { assetIncubationSessionHandlers } from "./server-methods/asset-incubation-session.js";
import { attachmentAssetHandlers } from "./server-methods/attachment-assets.js";
import { billingHandlers } from "./server-methods/billing.js";
import { browserPreviewHandlers } from "./server-methods/browser-preview.js";
import { browserHandlers } from "./server-methods/browser.js";
import { budgetHandlers } from "./server-methods/budget.js";
import { capabilityGovernanceHandlers } from "./server-methods/capability-governance.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { cliBackendHandlers } from "./server-methods/cli-backend.js";
import { collabDispatchHandlers } from "./server-methods/collab-dispatch.js";
import { collaborationLearningHandlers } from "./server-methods/collaboration-learning.js";
import { collaborationSpaceBoundaryHandlers } from "./server-methods/collaboration-space-boundary.js";
import { commercialBillingProfileHandlers } from "./server-methods/commercial-billing-profile.js";
import { commercialCreditPacksHandlers } from "./server-methods/commercial-credit-packs.js";
import { commercialInvoicesHandlers } from "./server-methods/commercial-invoices.js";
import { commercialOrdersHandlers } from "./server-methods/commercial-orders.js";
import { commercialPaymentsHandlers } from "./server-methods/commercial-payments.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { consumptionForecastHandlers } from "./server-methods/consumption-forecast.js";
import { conversationTaskHandlers } from "./server-methods/conversation-task.js";
import { conversationHandlers } from "./server-methods/conversations.js";
import { costControlHandlers } from "./server-methods/cost-control.js";
import { cronHandlers } from "./server-methods/cron.js";
import { dataHandlers } from "./server-methods/data.js";
import { deviceHandlers } from "./server-methods/devices.js";
import {
  PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
  authorizePlatformDiagnosisApprovalCaller,
} from "./server-methods/diagnosis-approval.js";
import {
  createMemoryHealthScopeDeniedError,
  isMemoryHealthRpcMethod,
} from "./server-methods/doctor-memory-health-auth.js";
import { doctorHandlers } from "./server-methods/doctor.js";
import { employeeCapabilityHandlers } from "./server-methods/employee-capability.js";
import { employeeInstallHandlers } from "./server-methods/employee-install.js";
import { employeeModelAccessHandlers } from "./server-methods/employee-model-access.js";
import { enterpriseAllocationHandlers } from "./server-methods/enterprise-allocation.js";
import { enterpriseCapabilityHandlers } from "./server-methods/enterprise-capability.js";
import { enterpriseCustomerAttributesHandlers } from "./server-methods/enterprise-customer-attributes.js";
import { enterpriseDataHandlers } from "./server-methods/enterprise-data.js";
import { enterpriseMemoryGovernanceHandlers } from "./server-methods/enterprise-memory-governance.js";
import { enterpriseModelCatalogHandlers } from "./server-methods/enterprise-model-catalog.js";
import { enterpriseModelProviderHandlers } from "./server-methods/enterprise-model-provider.js";
import { enterpriseNoticesHandlers } from "./server-methods/enterprise-notices.js";
import { enterpriseOperationalIdentityHandlers } from "./server-methods/enterprise-operational-identity.js";
import { enterpriseOrganizationMonthlyUsageHandlers } from "./server-methods/enterprise-organization-monthly-usage.js";
import { enterpriseOrganizationHandlers } from "./server-methods/enterprise-organization.js";
import { enterpriseUsageHandlers } from "./server-methods/enterprise-usage.js";
import { evolutionGovernanceHandlers } from "./server-methods/evolution-governance.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { governanceHandlers } from "./server-methods/governance.js";
import { guidanceProgressHandlers } from "./server-methods/guidance.js";
import { healthHandlers } from "./server-methods/health.js";
import { humanAttentionHandlers } from "./server-methods/human-attention.js";
import { incubationHandlers } from "./server-methods/incubation.js";
import { knowledgeHandlers } from "./server-methods/knowledge.js";
import { lifecycleProducerHandlers } from "./server-methods/lifecycle-producer.js";
import { localFilesHandlers } from "./server-methods/local-files.js";
import { logsHandlers } from "./server-methods/logs.js";
import { managementGovernanceHandlers } from "./server-methods/management-governance.js";
import { meetingHandlers } from "./server-methods/meeting.js";
import { mentionHandlers } from "./server-methods/mention.js";
import { meshBoundaryFacadeHandlers } from "./server-methods/mesh-boundary-facade.js";
import { meshGovernanceHandlers } from "./server-methods/mesh-governance.js";
import {
  enterpriseModelGrantHandlers,
  platformModelBindingHandlers,
} from "./server-methods/model-entitlement-management.js";
import { modelsAdmissionHandlers } from "./server-methods/models-admission.js";
import { modelsManagementHandlers } from "./server-methods/models-management.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodePendingHandlers } from "./server-methods/nodes-pending.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { mergePackHandlers } from "./server-methods/pack-merge.js";
import { GATEWAY_METHOD_PACKS } from "./server-methods/packs/registry.js";
import { patternDetectionHandlers } from "./server-methods/pattern-detection.js";
import { platformAllocationHandlers } from "./server-methods/platform-allocation.js";
import { platformCapabilityHandlers } from "./server-methods/platform-capability.js";
import { platformCostVersionHandlers } from "./server-methods/platform-cost-version.js";
import { platformEconomicsHandlers } from "./server-methods/platform-economics.js";
import { platformPlanBundleHandlers } from "./server-methods/platform-plan-bundle.js";
import { platformPlansHandlers, platformPricingHandlers } from "./server-methods/platform-plans.js";
import { platformPricingCatalogHandlers } from "./server-methods/platform-pricing-catalog.js";
import { platformSubscriptionsHandlers } from "./server-methods/platform-subscriptions.js";
import { platformTenantHandlers } from "./server-methods/platform-tenant.js";
import { policyEngineHandlers } from "./server-methods/policy-engine.js";
import { progressLedgerHandlers } from "./server-methods/progress-ledger.js";
import { pushHandlers } from "./server-methods/push.js";
import { resourceCatalogHandlers } from "./server-methods/resource-catalog.js";
import { resourcesHandlers } from "./server-methods/resources.js";
import { robotWorkspaceHandlers } from "./server-methods/robot-workspace.js";
import { scheduleHandlers } from "./server-methods/schedule.js";
import { seatsHandlers } from "./server-methods/seats.js";
import { secureFormHandlers } from "./server-methods/secure-form.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillLifecycleHandlers } from "./server-methods/skill-lifecycle.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { vaultSyncHandlers } from "./server-methods/vault-sync.js";

// Production registration: durable job cursor + interval tick for evolution governance.
ensureEvolutionGovernanceSchedulerStarted();
try {
  ensureEvolutionControlPlaneStarted();
} catch {
  // Unit tests may import handlers without a writable control-plane root.
}
try {
  ensureDiagnosisSchedulerStarted();
} catch {
  // Diagnosis tick must never prevent gateway method registration.
}
import { seatRulesHandlers } from "./server-methods/seat-rules.js";
import { spacesHandlers } from "./server-methods/spaces.js";
import { subscriptionsHandlers } from "./server-methods/subscriptions.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import {
  TASK_OUTCOME_REJECT_RESULT_METHOD,
  authorizeTaskOutcomeRejectTransport,
} from "./server-methods/task-outcome-reject.js";
import { taskHandlers } from "./server-methods/task.js";
import { toolsCatalogHandlers } from "./server-methods/tools-catalog.js";
import { ttsHandlers } from "./server-methods/tts.js";
import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageIngestHandlers } from "./server-methods/usage-ingest.js";
import { usageHandlers } from "./server-methods/usage.js";
import { userModelingHandlers } from "./server-methods/user-modeling.js";
import { userOperationalIdentityHandlers } from "./server-methods/user-operational-identity.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";
import { workbenchHandlers } from "./server-methods/workbench.js";
import { workspaceHandlers } from "./server-methods/workspaces.js";

const CONTROL_PLANE_WRITE_METHODS = new Set(["config.apply", "config.patch", "update.run"]);
function authorizeGatewayMethod(method: string, client: GatewayRequestOptions["client"]) {
  if (!client?.connect) {
    return null;
  }
  if (method === "health") {
    return null;
  }
  if (method === PLATFORM_DIAGNOSIS_APPROVAL_DECIDE_METHOD) {
    return authorizePlatformDiagnosisApprovalCaller(client);
  }
  // Session domain isolation (platform-admin-login-isolation Req 5.2): reject
  // when the method declares a non-"any" requiredDomain and the session's domain
  // does not match. Sessions without a domain (header-only trusted proxy, legacy)
  // are treated as "any" so existing deployments are unaffected.
  const domainGuard = guardSessionDomain(method, client.sessionDomain ?? null);
  if (!domainGuard.allowed) {
    return errorShape(
      ErrorCodes.INVALID_REQUEST,
      `domain_mismatch: ${method} requires domain ${String(domainGuard.requiredDomain)}`,
    );
  }
  const roleRaw = client.connect.role ?? "operator";
  const role = parseGatewayRole(roleRaw);
  if (!role) {
    return isMemoryHealthRpcMethod(method)
      ? createMemoryHealthScopeDeniedError(`unauthorized role: ${String(roleRaw)}`)
      : errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${roleRaw}`);
  }
  const scopes = client.connect.scopes ?? [];
  if (isMemoryHealthRpcMethod(method)) {
    if (role !== "operator") {
      return createMemoryHealthScopeDeniedError("agent session cannot invoke memory health RPC");
    }
    if (!scopes.includes(ADMIN_SCOPE)) {
      const scopeAuth = authorizeOperatorScopesForMethod(method, scopes);
      if (!scopeAuth.allowed) {
        return createMemoryHealthScopeDeniedError(`missing scope: ${scopeAuth.missingScope}`);
      }
    }
    return null;
  }
  if (!isRoleAuthorizedForMethod(role, method)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return null;
  }
  if (method === TASK_OUTCOME_REJECT_RESULT_METHOD) {
    return authorizeTaskOutcomeRejectTransport(client);
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  const scopeAuth = authorizeOperatorScopesForMethod(method, scopes);
  if (!scopeAuth.allowed) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${scopeAuth.missingScope}`);
  }
  return null;
}

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...governanceHandlers,
  ...managementGovernanceHandlers,
  ...channelsHandlers,
  ...attachmentAssetHandlers,
  ...assetIncubationSessionHandlers,
  ...guidanceProgressHandlers,
  ...collaborationLearningHandlers,
  ...humanAttentionHandlers,
  ...chatHandlers,
  ...conversationHandlers,
  ...mentionHandlers,
  ...cronHandlers,
  ...progressLedgerHandlers,
  ...conversationTaskHandlers,
  ...deviceHandlers,
  ...doctorHandlers,
  ...agentInstallRequestHandlers,
  ...employeeCapabilityHandlers,
  ...knowledgeHandlers,
  ...contextScopeHandlers,
  ...vaultSyncHandlers,
  ...mergePackHandlers(GATEWAY_METHOD_PACKS),
  ...employeeInstallHandlers,
  ...enterpriseCapabilityHandlers,
  ...enterpriseCustomerAttributesHandlers,
  ...enterpriseDataHandlers,
  ...enterpriseMemoryGovernanceHandlers,
  ...enterpriseNoticesHandlers,
  ...enterpriseOperationalIdentityHandlers,
  ...userOperationalIdentityHandlers,
  ...userModelingHandlers,
  ...seatRulesHandlers,
  ...enterpriseOrganizationHandlers,
  ...enterpriseOrganizationMonthlyUsageHandlers,
  ...enterpriseUsageHandlers,
  ...platformPlansHandlers,
  ...platformPricingHandlers,
  ...platformPricingCatalogHandlers,
  ...subscriptionsHandlers,
  ...seatsHandlers,
  ...budgetHandlers,
  ...usageIngestHandlers,
  ...resourcesHandlers,
  ...costControlHandlers,
  ...billingHandlers,
  ...consumptionForecastHandlers,
  ...commercialOrdersHandlers,
  ...commercialPaymentsHandlers,
  ...commercialBillingProfileHandlers,
  ...commercialInvoicesHandlers,
  ...commercialCreditPacksHandlers,
  ...salesLeadsHandlers,
  ...platformCapabilityHandlers,
  ...incubationHandlers,
  ...agentRuntimeHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...modelsManagementHandlers,
  ...modelsAdmissionHandlers,
  ...platformModelBindingHandlers,
  ...platformPlanBundleHandlers,
  ...platformTenantHandlers,
  ...resourceCatalogHandlers,
  ...policyEngineHandlers,
  ...platformCostVersionHandlers,
  ...platformEconomicsHandlers,
  ...platformSubscriptionsHandlers,
  ...platformAllocationHandlers,
  ...enterpriseModelGrantHandlers,
  ...enterpriseModelProviderHandlers,
  ...enterpriseModelCatalogHandlers,
  ...enterpriseAllocationHandlers,
  ...employeeModelAccessHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...toolsCatalogHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...skillLifecycleHandlers,
  ...patternDetectionHandlers,
  ...evolutionGovernanceHandlers,
  ...capabilityGovernanceHandlers,
  ...meshGovernanceHandlers,
  ...meshBoundaryFacadeHandlers,
  ...robotWorkspaceHandlers,
  ...collaborationSpaceBoundaryHandlers,
  ...spacesHandlers,
  ...scheduleHandlers,
  ...collabDispatchHandlers,
  ...meetingHandlers,
  ...taskHandlers,
  ...lifecycleProducerHandlers,
  ...workbenchHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...localFilesHandlers,
  ...nodePendingHandlers,
  ...pushHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...agentGrowthHandlers,
  ...workspaceHandlers,
  ...dataHandlers,
  ...browserHandlers,
  ...browserPreviewHandlers,
  ...secureFormHandlers,
  ...accountComputerLoginHandlers,
  ...cliBackendHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  const sessionGate = await enforceEnterpriseSessionForGatewayClient(client);
  if (sessionGate.denied) {
    respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, sessionGate.message));
    return;
  }
  if (CONTROL_PLANE_WRITE_METHODS.has(req.method)) {
    const budget = consumeControlPlaneWriteBudget({ client });
    if (!budget.allowed) {
      const actor = resolveControlPlaneActor(client);
      context.logGateway.warn(
        `control-plane write rate-limited method=${req.method} ${formatControlPlaneActor(actor)} retryAfterMs=${budget.retryAfterMs} key=${budget.key}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `rate limit exceeded for ${req.method}; retry after ${Math.ceil(budget.retryAfterMs / 1000)}s`,
          {
            retryable: true,
            retryAfterMs: budget.retryAfterMs,
            details: {
              method: req.method,
              limit: "3 per 60s",
            },
          },
        ),
      );
      return;
    }
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  const invokeHandler = () =>
    handler({
      req,
      params: (req.params ?? {}) as Record<string, unknown>,
      client,
      isWebchatConnect,
      respond,
      context,
    });
  // All handlers run inside a request scope so that plugin runtime
  // subagent methods (e.g. context engine tools spawning sub-agents
  // during tool execution) can dispatch back into the gateway.
  // Operator state scope is derived from the authenticated client so
  // session stores / plugin stateDir resolve per operator on this turn.
  // ConnectParams has no user field; identity lives on the client record.
  const operatorId = deriveOperatorIdFromGatewayClient(
    client
      ? {
          platformUserId: client.platformUserId,
          pairedDeviceId: client.pairedDeviceId,
          user: client.user,
        }
      : null,
  );
  const runScoped = () =>
    withPluginRuntimeGatewayRequestScope({ context, isWebchatConnect }, invokeHandler);
  if (operatorId) {
    await withOperatorStateScope(operatorId, runScoped);
  } else {
    await runScoped();
  }
}
