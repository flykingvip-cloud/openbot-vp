import type { MediaMonitorPluginConfig } from "./config.js";
import {
  assertTenantAccess,
  findTarget,
  newId,
  nowIso,
  pushAudit,
  withMonitorStore,
} from "./monitor-store.js";
import type { MonitorPlatform, MonitorTarget } from "./types.js";

export type AddTargetInput = {
  tenantId: string;
  agentId: string;
  platform?: MonitorPlatform;
  accountId: string;
  accountUrl: string;
  displayName?: string;
  pollIntervalSeconds?: number;
  watchedContentIds?: string[];
  notifyChannel?: string;
  notifyTo?: string;
  notifyAccountId?: string;
  enabled?: boolean;
};

export async function addMonitorTarget(params: {
  storePath: string;
  config: MediaMonitorPluginConfig;
  input: AddTargetInput;
}): Promise<MonitorTarget> {
  const accountId = params.input.accountId.trim();
  const accountUrl = params.input.accountUrl.trim();
  if (!accountId || !accountUrl) {
    throw new Error("accountId and accountUrl are required");
  }
  if (!params.input.tenantId.trim() || !params.input.agentId.trim()) {
    throw new Error("tenantId and agentId are required");
  }

  return await withMonitorStore(params.storePath, (data) => {
    const duplicate = data.targets.find(
      (target) =>
        target.tenantId === params.input.tenantId &&
        target.platform === (params.input.platform ?? params.config.defaultPlatform) &&
        target.accountId === accountId,
    );
    if (duplicate) {
      throw new Error(`target already exists: ${duplicate.id}`);
    }

    const now = Date.now();
    const target: MonitorTarget = {
      id: newId("tgt"),
      tenantId: params.input.tenantId.trim(),
      agentId: params.input.agentId.trim(),
      platform: params.input.platform ?? params.config.defaultPlatform,
      accountId,
      accountUrl,
      displayName: params.input.displayName?.trim() || accountId,
      enabled: params.input.enabled !== false,
      pollIntervalSeconds:
        params.input.pollIntervalSeconds ?? params.config.defaultPollIntervalSeconds,
      watchedContentIds: (params.input.watchedContentIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
      healthState: "ok",
      cursor: {
        baselineEstablished: false,
        consecutiveEmptyRuns: 0,
      },
      notifyChannel: params.input.notifyChannel,
      notifyTo: params.input.notifyTo,
      notifyAccountId: params.input.notifyAccountId,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    };
    data.targets.push(target);
    pushAudit(data, {
      action: "target.created",
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
      detail: { platform: target.platform, accountId: target.accountId },
    });
    return target;
  });
}

export async function listMonitorTargets(params: {
  storePath: string;
  tenantId?: string;
  agentId?: string;
}): Promise<MonitorTarget[]> {
  return await withMonitorStore(params.storePath, (data) => {
    return data.targets.filter((target) => {
      if (params.tenantId && target.tenantId !== params.tenantId) {
        return false;
      }
      if (params.agentId && target.agentId !== params.agentId) {
        return false;
      }
      return true;
    });
  });
}

export async function getMonitorTarget(params: {
  storePath: string;
  targetId: string;
  tenantId?: string;
  agentId?: string;
}): Promise<MonitorTarget | null> {
  return await withMonitorStore(params.storePath, (data) => {
    const target = findTarget(data, params.targetId);
    if (!target) {
      return null;
    }
    assertTenantAccess({
      target,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    return structuredClone(target);
  });
}

export async function updateMonitorTarget(params: {
  storePath: string;
  targetId: string;
  tenantId?: string;
  agentId?: string;
  patch: {
    enabled?: boolean;
    displayName?: string;
    pollIntervalSeconds?: number;
    watchedContentIds?: string[];
    notifyChannel?: string | null;
    notifyTo?: string | null;
    notifyAccountId?: string | null;
  };
}): Promise<MonitorTarget | null> {
  return await withMonitorStore(params.storePath, (data) => {
    const target = findTarget(data, params.targetId);
    if (!target) {
      return null;
    }
    assertTenantAccess({
      target,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    const patch = params.patch;
    if (typeof patch.enabled === "boolean") {
      target.enabled = patch.enabled;
    }
    if (typeof patch.displayName === "string" && patch.displayName.trim()) {
      target.displayName = patch.displayName.trim();
    }
    if (typeof patch.pollIntervalSeconds === "number" && patch.pollIntervalSeconds >= 60) {
      target.pollIntervalSeconds = patch.pollIntervalSeconds;
    }
    if (Array.isArray(patch.watchedContentIds)) {
      target.watchedContentIds = patch.watchedContentIds.map(String).filter(Boolean);
    }
    if (patch.notifyChannel === null) {
      delete target.notifyChannel;
    } else if (typeof patch.notifyChannel === "string") {
      target.notifyChannel = patch.notifyChannel.trim() || undefined;
    }
    if (patch.notifyTo === null) {
      delete target.notifyTo;
    } else if (typeof patch.notifyTo === "string") {
      target.notifyTo = patch.notifyTo.trim() || undefined;
    }
    if (patch.notifyAccountId === null) {
      delete target.notifyAccountId;
    } else if (typeof patch.notifyAccountId === "string") {
      target.notifyAccountId = patch.notifyAccountId.trim() || undefined;
    }
    target.updatedAt = nowIso();
    pushAudit(data, {
      action: "target.updated",
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
      detail: {
        notifyChannel: target.notifyChannel ?? null,
        notifyTo: target.notifyTo ?? null,
      },
    });
    return structuredClone(target);
  });
}

export async function deleteMonitorTarget(params: {
  storePath: string;
  targetId: string;
  tenantId?: string;
  agentId?: string;
}): Promise<boolean> {
  return await withMonitorStore(params.storePath, (data) => {
    const idx = data.targets.findIndex((target) => target.id === params.targetId);
    if (idx < 0) {
      return false;
    }
    const target = data.targets[idx]!;
    assertTenantAccess({
      target,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    data.targets.splice(idx, 1);
    data.events = data.events.filter((event) => event.targetId !== params.targetId);
    data.outbox = data.outbox.filter((row) => row.targetId !== params.targetId);
    data.leases = data.leases.filter((lease) => lease.targetId !== params.targetId);
    pushAudit(data, {
      action: "target.deleted",
      targetId: params.targetId,
      tenantId: target.tenantId,
      agentId: target.agentId,
    });
    return true;
  });
}
