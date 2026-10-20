/**
 * Minimal capability-version catalog for `agent-runtime.binding.upgrade`.
 *
 * Sources, in one list:
 * - versions already stored on runtime bindings (a version that is running)
 * - governance-registry manifest versions (`active` or `approved` are eligible)
 *
 * There is no separate version history table. A target missing from both
 * sources is `version unknown`. A listed target that is not a newer
 * `major.minor.patch` semver, or whose only source is a non-runnable registry
 * lifecycle, is `incompatible`.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const ELIGIBLE_REGISTRY_LIFECYCLES = new Set(["active", "approved"]);

export const UPGRADE_REASON_UNKNOWN = "version unknown";
export const UPGRADE_REASON_SEMVER = "incompatible: version is not a comparable semver";
export const UPGRADE_REASON_ALREADY = "incompatible: already at capabilityVersion";
export const UPGRADE_REASON_NOT_NEWER = "incompatible: target is not newer";

export type CapabilityVersionSource = "binding" | "registry";

export type CapabilityVersionRegistrySource = {
  capabilityId: string;
  version: string;
  lifecycleState: string;
};

export type CapabilityVersionCatalogEntry = {
  capabilityId: string;
  version: string;
  sources: CapabilityVersionSource[];
  registryLifecycle: string | null;
  eligible: boolean;
};

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  pre: string[] | null;
};

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

/** `null` when either side is not `major.minor.patch` with an optional pre-release. */
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

export function upgradeReasonForLifecycle(lifecycle: string): string {
  return `incompatible: registry lifecycle is ${lifecycle}`;
}

type CatalogBucket = {
  capabilityId: string;
  version: string;
  sources: Set<CapabilityVersionSource>;
  registryLifecycle: string | null;
};

function bucketKey(capabilityId: string, version: string): string {
  return `${capabilityId}\0${version}`;
}

function isEligible(bucket: CatalogBucket): boolean {
  if (bucket.sources.has("binding")) {
    return true;
  }
  return (
    bucket.registryLifecycle !== null && ELIGIBLE_REGISTRY_LIFECYCLES.has(bucket.registryLifecycle)
  );
}

export function listCapabilityVersionCatalog(params: {
  bindings: ReadonlyArray<{ capabilityId: string; capabilityVersion: string }>;
  registry: ReadonlyArray<CapabilityVersionRegistrySource>;
}): CapabilityVersionCatalogEntry[] {
  const buckets = new Map<string, CatalogBucket>();
  const touch = (capabilityId: string, version: string): CatalogBucket | null => {
    const id = capabilityId.trim();
    const ver = version.trim();
    if (!id || !ver) {
      return null;
    }
    const key = bucketKey(id, ver);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { capabilityId: id, version: ver, sources: new Set(), registryLifecycle: null };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  for (const binding of params.bindings) {
    touch(binding.capabilityId, binding.capabilityVersion)?.sources.add("binding");
  }
  for (const entry of params.registry) {
    const bucket = touch(entry.capabilityId, entry.version);
    if (!bucket) {
      continue;
    }
    bucket.sources.add("registry");
    bucket.registryLifecycle = entry.lifecycleState;
  }
  return [...buckets.values()]
    .map((bucket) => ({
      capabilityId: bucket.capabilityId,
      version: bucket.version,
      sources: [...bucket.sources].toSorted(),
      registryLifecycle: bucket.registryLifecycle,
      eligible: isEligible(bucket),
    }))
    .toSorted((left, right) => {
      const id = left.capabilityId.localeCompare(right.capabilityId);
      if (id !== 0) {
        return id;
      }
      const leftSemver = compareCapabilityVersions(left.version, "0.0.0") !== null;
      const rightSemver = compareCapabilityVersions(right.version, "0.0.0") !== null;
      if (leftSemver !== rightSemver) {
        return leftSemver ? -1 : 1;
      }
      if (leftSemver && rightSemver) {
        return compareCapabilityVersions(right.version, left.version) ?? 0;
      }
      return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
    });
}

export function assessCapabilityUpgrade(params: {
  capabilityId: string;
  currentVersion: string;
  targetVersion: string;
  catalog: ReadonlyArray<CapabilityVersionCatalogEntry>;
}): { ok: true } | { ok: false; reason: string } {
  const capabilityId = params.capabilityId.trim();
  const targetVersion = params.targetVersion.trim();
  const currentVersion = params.currentVersion.trim();
  const entry = params.catalog.find(
    (item) => item.capabilityId === capabilityId && item.version === targetVersion,
  );
  if (!entry) {
    return { ok: false, reason: UPGRADE_REASON_UNKNOWN };
  }
  if (!entry.eligible) {
    return {
      ok: false,
      reason: upgradeReasonForLifecycle(entry.registryLifecycle ?? "unknown"),
    };
  }
  const order = compareCapabilityVersions(currentVersion, targetVersion);
  if (order === null) {
    return { ok: false, reason: UPGRADE_REASON_SEMVER };
  }
  if (order === 0) {
    return { ok: false, reason: UPGRADE_REASON_ALREADY };
  }
  if (order > 0) {
    return { ok: false, reason: UPGRADE_REASON_NOT_NEWER };
  }
  return { ok: true };
}
