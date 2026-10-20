/**
 * Platform-model connection gate shared by enterprise reads and employee runtime.
 *
 * Success matches the platform pool: a live probe status of "ok", or gateway-catalog
 * membership when the model is not explicitly configured (catalog_verified).
 * An explicit config without a successful probe is not connected. A provider model
 * list (GET /models HTTP 200) is not a connection. Any recorded probe other than
 * "ok" — including auth failures — wins over catalog membership. Enterprise-supplied
 * ids (`ent/…`) are not platform models and are never dropped by this gate.
 */

export function isEnterpriseSuppliedModelId(modelId: string): boolean {
  return modelId.trim().startsWith("ent/");
}

export function isPlatformModelConnectionSuccessful(input: {
  probeStatus?: string | null;
  inGatewayCatalog: boolean;
  explicitlyConfigured: boolean;
}): boolean {
  const status = input.probeStatus?.trim() ?? "";
  if (status === "ok") {
    return true;
  }
  if (status) {
    return false;
  }
  if (input.explicitlyConfigured) {
    return false;
  }
  return input.inGatewayCatalog;
}

/**
 * Connection success is not pool membership. A stale probe of "ok", or a gateway
 * catalog hit, must not keep a model that was removed from the live platform pool
 * (configured provider models, or an allowlist entry whose provider is still configured).
 * Enterprise-supplied ids are not passed through this helper.
 */
export function retainPlatformPoolMembers(
  connectedPlatformModelIds: ReadonlySet<string>,
  platformPoolModelIds: ReadonlySet<string>,
): Set<string> {
  const visible = new Set<string>();
  for (const raw of connectedPlatformModelIds) {
    const id = raw.trim();
    if (id && platformPoolModelIds.has(id)) {
      visible.add(id);
    }
  }
  return visible;
}

export function partitionPlatformModelIds(
  modelIds: readonly string[],
  connectedPlatformModelIds: ReadonlySet<string>,
): { visible: string[]; suppressed: string[] } {
  const visible: string[] = [];
  const suppressed: string[] = [];
  const seen = new Set<string>();
  for (const raw of modelIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (isEnterpriseSuppliedModelId(id) || connectedPlatformModelIds.has(id)) {
      visible.push(id);
      continue;
    }
    suppressed.push(id);
  }
  return { visible, suppressed };
}
