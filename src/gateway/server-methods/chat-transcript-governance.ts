import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { loadCronStore } from "../../cron/store.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTenantContext } from "../tenant-context.js";
import type { GatewayClient } from "./types.js";

export type ChatTranscriptGovernance = {
  tenantId: string | null;
  ownerUserId: string | null;
  groupId: string | null;
  failClosed: boolean;
};

export async function resolveChatTranscriptGovernance(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  groupId?: string | null;
}): Promise<ChatTranscriptGovernance> {
  const profile = resolveSecurityProfile(params.cfg, process.env);
  const failClosed = profile.profile === "managed_enterprise";
  const tenantCtx =
    failClosed || isSharedTenantAddressingEnabled(params.cfg)
      ? await resolveTenantContext(params.client)
      : null;
  return {
    tenantId: tenantCtx?.tenantId ?? null,
    ownerUserId: tenantCtx?.userId ?? null,
    groupId: params.groupId ?? null,
    failClosed,
  };
}

/** Operator cron inject lacks browser tenant stamps — derive ownership from the job record. */
export async function resolveChatInjectTranscriptGovernance(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  groupId?: string | null;
  cronJobId?: string;
  cronStorePath?: string;
}): Promise<ChatTranscriptGovernance> {
  const profile = resolveSecurityProfile(params.cfg, process.env);
  const failClosed = profile.profile === "managed_enterprise";
  let base: ChatTranscriptGovernance;
  try {
    base = await resolveChatTranscriptGovernance({
      client: params.client,
      cfg: params.cfg,
      groupId: params.groupId,
    });
  } catch {
    base = {
      tenantId: null,
      ownerUserId: null,
      groupId: params.groupId ?? null,
      failClosed,
    };
  }
  if (base.tenantId || !params.cronJobId?.trim() || !params.cronStorePath?.trim()) {
    return base;
  }
  try {
    const store = await loadCronStore(params.cronStorePath);
    const job = store.jobs.find((entry) => entry.id === params.cronJobId);
    const tenantId = job?.ownership?.tenantId?.trim();
    const ownerUserId = job?.ownership?.ownerId?.trim();
    if (!tenantId && !ownerUserId) {
      return base;
    }
    return {
      ...base,
      tenantId: tenantId ?? base.tenantId,
      ownerUserId: ownerUserId ?? base.ownerUserId,
    };
  } catch {
    return base;
  }
}
