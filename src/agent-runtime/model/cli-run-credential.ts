import { resolveCredentialForRun } from "../../agents/cli-backend-credential-resolve.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveAgentRunEntitlementScope } from "../../gateway/model-entitlement/resolve-agent-run-scope.js";

/** Existing CLI credential selection, without starting a run or recording usage. */
export async function resolveCliRunCredential(input: {
  agentId?: string;
  provider: string;
  model: string;
  config: OpenBotConfig;
  fallbackUserId?: string;
}): Promise<{
  credentialEnv?: Record<string, string>;
  usageAttr?: { tenantId: string; userId: string; credentialId: string };
}> {
  try {
    const scope = await resolveAgentRunEntitlementScope({ agentId: input.agentId });
    if (!scope) {
      return {};
    }
    const resolved = await resolveCredentialForRun({
      backendId: input.provider,
      model: input.model,
      scope: { tenantId: scope.tenantId, subjectId: scope.employeeId ?? scope.seatId },
      config: input.config,
    });
    if (!resolved) {
      return {};
    }
    return {
      credentialEnv: resolved.env,
      usageAttr: {
        tenantId: scope.tenantId,
        userId: scope.employeeId ?? scope.seatId ?? input.fallbackUserId ?? "",
        credentialId: resolved.credentialId,
      },
    };
  } catch {
    // Preserve the existing all-or-nothing host-default fallback without logging secrets.
    return {};
  }
}
