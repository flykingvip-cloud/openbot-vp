/**
 * Platform-admin warnings for configured models whose latest probe failed.
 * Models that have never been probed are not reported here.
 */

export type PlatformProbeSnapshot = {
  provider?: string;
  model?: string;
  label?: string;
  status: string;
  error?: string;
};

export type UnusablePlatformModel = {
  modelId: string;
  status: string;
  label: string;
  error?: string;
};

export function platformProbeModelId(result: { provider?: string; model?: string }): string {
  const model = result.model?.trim() ?? "";
  if (!model) {
    return "";
  }
  if (model.includes("/")) {
    return model;
  }
  const provider = result.provider?.trim() ?? "";
  return provider ? `${provider}/${model}` : model;
}

export function listUnusablePlatformModels(input: {
  probes: readonly PlatformProbeSnapshot[];
  configuredModelIds: readonly string[];
}): UnusablePlatformModel[] {
  const configured = new Set(
    input.configuredModelIds.map((id) => id.trim()).filter((id) => id.length > 0),
  );
  const warnings: UnusablePlatformModel[] = [];
  const seen = new Set<string>();
  for (const probe of input.probes) {
    const modelId = platformProbeModelId(probe);
    const status = probe.status.trim();
    if (!modelId || !status || status === "ok" || !configured.has(modelId) || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    const label = probe.label?.trim() || modelId;
    warnings.push({
      modelId,
      status,
      label,
      ...(probe.error?.trim() ? { error: probe.error.trim() } : {}),
    });
  }
  return warnings.toSorted((a, b) => a.modelId.localeCompare(b.modelId));
}
