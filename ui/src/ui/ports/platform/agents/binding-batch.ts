/**
 * Batch binding mutations. One gateway call, partial failure in the payload.
 * Do not loop `agent-runtime.update-binding-state`, `update-binding-strategy`,
 * or per-binding version writes.
 *
 * Upgrade targets come from `agent-runtime.capability-versions.list`.
 * That catalog is versions already stored on bindings, plus governance-registry
 * versions. The gateway rejects unknown and incompatible targets per binding.
 *
 * Semver comparison matches `src/gateway/agent-runtime-version-catalog.ts`.
 */

import type {
  LoadStrategy,
  RuntimeCapabilityBinding,
} from "../../../capability/runtime-canonical/index.ts";

export const BINDING_BATCH_SET_STATE_METHOD = "agent-runtime.binding.batch-set-state";
export const BINDING_BATCH_SET_STRATEGY_METHOD = "agent-runtime.binding.batch-set-strategy";
export const BINDING_UPGRADE_METHOD = "agent-runtime.binding.upgrade";
export const CAPABILITY_VERSIONS_LIST_METHOD = "agent-runtime.capability-versions.list";

export const BINDING_UPGRADE_EMPTY_CATALOG =
  "版本目录里没有比当前绑定更新的可用版本。目录只包含绑定上已有的版本，以及治理注册表中 active / approved 的版本。";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

type ParsedSemver = { major: number; minor: number; patch: number; pre: string[] | null };

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER.exec(version.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".").filter((part) => part.length > 0) : null,
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const delta = Number(left) - Number(right);
    return delta < 0 ? -1 : delta > 0 ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function comparePreRelease(left: string[] | null, right: string[] | null): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    const delta = compareIdentifiers(a, b);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function compareCapabilityVersions(left: string, right: string): -1 | 0 | 1 | null {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    return null;
  }
  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major < parsedRight.major ? -1 : 1;
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor < parsedRight.minor ? -1 : 1;
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch < parsedRight.patch ? -1 : 1;
  }
  const pre = comparePreRelease(parsedLeft.pre, parsedRight.pre);
  return pre < 0 ? -1 : pre > 0 ? 1 : 0;
}

export type CapabilityVersionCatalogEntry = {
  capabilityId: string;
  version: string;
  sources: Array<"binding" | "registry">;
  registryLifecycle: string | null;
  eligible: boolean;
};

function isCatalogEntry(value: unknown): value is CapabilityVersionCatalogEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as CapabilityVersionCatalogEntry;
  return (
    typeof entry.capabilityId === "string" &&
    typeof entry.version === "string" &&
    Array.isArray(entry.sources) &&
    entry.sources.every((source) => source === "binding" || source === "registry") &&
    (entry.registryLifecycle === null || typeof entry.registryLifecycle === "string") &&
    typeof entry.eligible === "boolean"
  );
}

export function parseCapabilityVersionCatalog(
  value: unknown,
): CapabilityVersionCatalogEntry[] | null {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    return null;
  }
  const entries = (value as { entries: unknown[] }).entries;
  if (!entries.every(isCatalogEntry)) {
    return null;
  }
  return entries;
}

export async function requestCapabilityVersionCatalog(
  request: <T>(method: string, body: unknown) => Promise<T>,
): Promise<{ ok: true; entries: CapabilityVersionCatalogEntry[] } | { ok: false; error: string }> {
  try {
    const payload = await request<unknown>(CAPABILITY_VERSIONS_LIST_METHOD, {});
    const entries = parseCapabilityVersionCatalog(payload);
    if (!entries) {
      return { ok: false, error: "版本目录返回与契约不一致" };
    }
    return { ok: true, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : "版本目录读取失败";
    return { ok: false, error: message };
  }
}

export function upgradeVersionChoices(params: {
  entries: CapabilityVersionCatalogEntry[];
  bindings: ReadonlyArray<{ capabilityId: string; capabilityVersion: string }>;
}): Array<{ version: string; label: string }> {
  const byCapability = new Map<string, string[]>();
  for (const binding of params.bindings) {
    const versions = byCapability.get(binding.capabilityId) ?? [];
    versions.push(binding.capabilityVersion);
    byCapability.set(binding.capabilityId, versions);
  }
  const choices = new Map<string, Set<string>>();
  for (const entry of params.entries) {
    if (!entry.eligible) {
      continue;
    }
    const currents = byCapability.get(entry.capabilityId);
    if (!currents) {
      continue;
    }
    const newer = currents.some((current) => {
      const order = compareCapabilityVersions(current, entry.version);
      return order !== null && order < 0;
    });
    if (!newer) {
      continue;
    }
    const ids = choices.get(entry.version) ?? new Set<string>();
    ids.add(entry.capabilityId);
    choices.set(entry.version, ids);
  }
  return [...choices.entries()]
    .toSorted((left, right) => {
      const order = compareCapabilityVersions(right[0], left[0]);
      if (order === null) {
        return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
      }
      return order;
    })
    .map(([version, capabilityIds]) => {
      const names = [...capabilityIds].toSorted();
      const shown = names.length === 1 ? names[0] : `${names.length} 个能力`;
      return { version, label: `${version} · ${shown}` };
    });
}

export type BindingBatchRejection = { bindingId: string; reason: string };

export type BindingBatchResult =
  | {
      ok: true;
      applied: RuntimeCapabilityBinding[];
      rejected: BindingBatchRejection[];
    }
  | { ok: false; error: string };

function isBinding(value: unknown): value is RuntimeCapabilityBinding {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { bindingId?: unknown }).bindingId === "string"
  );
}

export function describeBindingBatch(result: {
  applied: RuntimeCapabilityBinding[];
  rejected: BindingBatchRejection[];
}): string {
  const rejected = result.rejected.map((entry) => `${entry.bindingId}：${entry.reason}`).join("；");
  const summary = `已应用 ${result.applied.length} 条，拒绝 ${result.rejected.length} 条`;
  return rejected ? `${summary}。${rejected}` : `${summary}。`;
}

export async function requestBindingBatch(params: {
  request: <T>(method: string, body: unknown) => Promise<T>;
  method: string;
  bindingIds: string[];
  expect: (binding: RuntimeCapabilityBinding) => boolean;
  body: Record<string, unknown>;
}): Promise<BindingBatchResult> {
  try {
    const payload = await params.request<{
      applied?: unknown;
      rejected?: unknown;
    }>(params.method, params.body);
    if (!Array.isArray(payload?.applied) || !Array.isArray(payload?.rejected)) {
      return { ok: false, error: "网关返回与请求不一致，未记为成功" };
    }
    const requested = new Set(params.bindingIds);
    const applied: RuntimeCapabilityBinding[] = [];
    for (const entry of payload.applied) {
      if (!isBinding(entry) || !requested.has(entry.bindingId) || !params.expect(entry)) {
        return { ok: false, error: "网关返回与请求不一致，未记为成功" };
      }
      applied.push(entry);
    }
    const rejected: BindingBatchRejection[] = [];
    for (const entry of payload.rejected) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as { bindingId?: unknown }).bindingId !== "string" ||
        typeof (entry as { reason?: unknown }).reason !== "string" ||
        !requested.has((entry as { bindingId: string }).bindingId)
      ) {
        return { ok: false, error: "网关返回与请求不一致，未记为成功" };
      }
      rejected.push({
        bindingId: (entry as { bindingId: string }).bindingId,
        reason: (entry as { reason: string }).reason,
      });
    }
    return { ok: true, applied, rejected };
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量绑定变更失败";
    return { ok: false, error: message };
  }
}

export function batchSetStateBody(bindingIds: string[], bindingState: "active" | "disabled") {
  return {
    method: BINDING_BATCH_SET_STATE_METHOD,
    body: { bindingIds, bindingState },
    expect: (binding: RuntimeCapabilityBinding) => binding.bindingState === bindingState,
  };
}

export function batchSetStrategyBody(bindingIds: string[], loadStrategy: LoadStrategy) {
  return {
    method: BINDING_BATCH_SET_STRATEGY_METHOD,
    body: { bindingIds, loadStrategy },
    expect: (binding: RuntimeCapabilityBinding) => binding.loadStrategy === loadStrategy,
  };
}

export function batchUpgradeBody(bindingIds: string[], capabilityVersion: string) {
  return {
    method: BINDING_UPGRADE_METHOD,
    body: { bindingIds, capabilityVersion },
    expect: (binding: RuntimeCapabilityBinding) => binding.capabilityVersion === capabilityVersion,
  };
}
