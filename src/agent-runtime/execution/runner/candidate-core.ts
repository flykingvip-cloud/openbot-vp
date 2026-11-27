import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import {
  resolveEnterpriseEmbeddedTransport,
  type EnterpriseEmbeddedProviderAuth,
  type EnterpriseEmbeddedTransport,
} from "../../../gateway/enterprise-model/embedded-transport.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { resolveAgentRunEntitlementScope } from "../../../gateway/model-entitlement/resolve-agent-run-scope.js";
import {
  rememberModelResultUsage,
  TaskBudgetExceededError,
  usageRetainedForCandidateCharge,
} from "../../../task-outcome/runtime-from-runner.js";
import { resolveCliRunCredential } from "../../model/index.js";
import { runCliAgent } from "./cli-run.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";

export type CandidateTransportFields = {
  provider: string;
  model: string;
  providerAuthOverride?: EnterpriseEmbeddedProviderAuth;
  enterpriseRuntimeModelId?: string;
};

/**
 * Resolves enterprise transport (`ent/*` → upstream provider + SecretRef) and
 * returns the spreadable candidate run fields.
 */
export async function resolveCandidateEmbeddedTransport(params: {
  provider: string;
  model: string;
  tenantId?: string;
  agentId?: string;
  resolveTenantId?: () => Promise<string | undefined>;
}): Promise<{
  transport: EnterpriseEmbeddedTransport;
  transportFields: CandidateTransportFields;
}> {
  const resolveTenantId =
    params.resolveTenantId ??
    (params.agentId
      ? async () => {
          const scope = await resolveAgentRunEntitlementScope({
            agentId: params.agentId!,
          });
          return scope?.tenantId;
        }
      : undefined);

  const transport = await resolveEnterpriseEmbeddedTransport({
    provider: params.provider,
    model: params.model,
    tenantId: params.tenantId,
    ...(resolveTenantId ? { resolveTenantId } : {}),
  });

  const transportFields: CandidateTransportFields = {
    provider: transport.provider,
    model: transport.model,
    ...(transport.providerAuthOverride
      ? { providerAuthOverride: transport.providerAuthOverride }
      : {}),
    ...(transport.enterpriseRuntimeModelId
      ? { enterpriseRuntimeModelId: transport.enterpriseRuntimeModelId }
      : {}),
  };

  return { transport, transportFields };
}

export { inheritExecutionIdentityRunFields };

/**
 * Idempotent candidate usage charger with retained-usage capture and
 * `TaskBudgetExceededError` propagation guard.
 */
export function createCandidateUsageCharger(params: {
  onCharge: (usage?: unknown) => void;
  onNonBudgetChargeError?: (err: unknown) => void;
}) {
  let charged = false;
  let notedUsage: unknown;

  const chargeOnce = (usage?: unknown) => {
    if (charged) {
      return;
    }
    charged = true;
    try {
      params.onCharge(usage);
    } catch (err) {
      if (err instanceof TaskBudgetExceededError) {
        throw err;
      }
      if (params.onNonBudgetChargeError) {
        params.onNonBudgetChargeError(err);
        return;
      }
      throw err;
    }
  };

  const noteResultUsage = (usage?: unknown) => {
    notedUsage = rememberModelResultUsage(usage);
    return notedUsage;
  };

  const chargeOnFailure = (
    err: unknown,
    options?: { retainedUsage?: unknown; skipCharge?: boolean },
  ) => {
    if (err instanceof TaskBudgetExceededError || options?.skipCharge) {
      return;
    }
    try {
      chargeOnce(options?.retainedUsage ?? usageRetainedForCandidateCharge(notedUsage, err));
    } catch (chargeErr) {
      if (chargeErr instanceof TaskBudgetExceededError) {
        throw chargeErr;
      }
    }
  };

  return {
    chargeOnce,
    noteResultUsage,
    chargeOnFailure,
    get notedUsage() {
      return notedUsage;
    },
  };
}

export type CliUsageAttribution = {
  tenantId: string;
  userId: string;
  credentialId: string;
};

export function recordCliCandidateUsageAttribution(params: {
  usageAttr?: CliUsageAttribution;
  provider: string;
  model: string;
  executionId: string;
}): void {
  if (!params.usageAttr) {
    return;
  }
  void recordCliBackendUsage({
    tenantId: params.usageAttr.tenantId,
    userId: params.usageAttr.userId,
    backendId: params.provider,
    credentialId: params.usageAttr.credentialId,
    model: params.model,
    executionId: params.executionId,
  });
}

export async function runCliCandidateWithCredential(params: {
  credentialInput: Parameters<typeof resolveCliRunCredential>[0];
  executionId: string;
  deferAttribution?: boolean;
  runParams: Omit<Parameters<typeof runCliAgent>[0], "credentialEnv">;
  passUndefinedCredentialEnv?: boolean;
}): Promise<{
  result: EmbeddedPiRunResult;
  recordAttribution: () => void;
}> {
  const { credentialEnv, usageAttr } = await resolveCliRunCredential(params.credentialInput);
  const result = await runCliAgent({
    ...params.runParams,
    ...(params.passUndefinedCredentialEnv
      ? { credentialEnv }
      : credentialEnv
        ? { credentialEnv }
        : {}),
  });
  const recordAttribution = () =>
    recordCliCandidateUsageAttribution({
      usageAttr,
      provider: params.credentialInput.provider,
      model: params.credentialInput.model,
      executionId: params.executionId,
    });
  if (!params.deferAttribution) {
    recordAttribution();
  }
  return { result, recordAttribution };
}

export function buildBootstrapWarningParams(warnings: string[]): {
  bootstrapPromptWarningSignaturesSeen: string[];
  bootstrapPromptWarningSignature: string | undefined;
} {
  return {
    bootstrapPromptWarningSignaturesSeen: warnings,
    bootstrapPromptWarningSignature: warnings[warnings.length - 1],
  };
}

export { resolveBootstrapWarningSignaturesSeen, resolveCliRunCredential, runCliAgent };
