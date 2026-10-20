// npm Source Adapter
//
// Queries the npm registry for packages matching `@openclaw/skill-*`
// and converts their package.json metadata into DiscoveredCapability
// entries. These are then fed into the proposal pipeline.
//
// Security checks performed during discovery:
// - Typosquat detection (non-@openclaw scoped packages claiming openclaw-*)
// - Missing signature (npm packages without provenance attestation)
// - Suspicious install scripts (preinstall/postinstall with curl|bash)
//
// This adapter runs in the browser (UI layer) and uses the public npm
// registry API (no auth required for read). In production, a gateway
// method would proxy this to avoid CORS and add caching.

import type {
  CapabilityContracts,
  CapabilityInstallSpec,
  CapabilityManifest,
  CapabilityRequirements,
  CapabilityRiskProfile,
  CapabilitySourceRef,
  SecurityFinding,
} from "../types.ts";
import type { DiscoveredCapability, DiscoveryFilter, SourceAdapter } from "./types.ts";

const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const SEARCH_ENDPOINT = `${NPM_REGISTRY_BASE}/-/v1/search`;
const SCOPE = "@openclaw";
const SKILL_PREFIX = "skill-";
const DEFAULT_LIMIT = 50;

type NpmSearchResult = {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      author?: { name?: string; email?: string };
      links?: { npm?: string; homepage?: string; repository?: string };
      publisher?: { username?: string };
    };
    score?: { final?: number };
  }>;
  total: number;
};

type NpmPackageManifest = {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  author?: string | { name?: string };
  homepage?: string;
  repository?: string | { url?: string };
  license?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  openclaw?: {
    emoji?: string;
    requires?: { bins?: string[]; env?: string[] };
    install?: Array<{ id: string; kind: string; label: string; bins?: string[] }>;
  };
};

function extractAuthor(pkg: NpmPackageManifest): string | undefined {
  if (typeof pkg.author === "string") {
    return pkg.author;
  }
  if (pkg.author && typeof pkg.author === "object") {
    return pkg.author.name;
  }
  return undefined;
}

function extractHomepage(pkg: NpmPackageManifest): string | undefined {
  if (pkg.homepage) {
    return pkg.homepage;
  }
  if (typeof pkg.repository === "string") {
    return pkg.repository;
  }
  if (pkg.repository && typeof pkg.repository === "object") {
    return pkg.repository.url;
  }
  return undefined;
}

function buildSource(name: string): CapabilitySourceRef {
  return {
    kind: "npm",
    origin: name,
    trustTier: name.startsWith(`${SCOPE}/`) ? "first-party" : "external",
  };
}

function buildRequirements(pkg: NpmPackageManifest): CapabilityRequirements {
  return {
    bins: pkg.openclaw?.requires?.bins ?? [],
    env: pkg.openclaw?.requires?.env ?? [],
    configPaths: [],
    operatingSystems: [],
  };
}

function buildContracts(pkg: NpmPackageManifest): CapabilityContracts {
  const hasBins = (pkg.openclaw?.requires?.bins?.length ?? 0) > 0;
  return {
    sideEffects: hasBins ? ["subprocess"] : ["read_only"],
    idempotent: !hasBins,
    requiresConfirmation: false,
  };
}

function buildRisk(source: CapabilitySourceRef, pkg: NpmPackageManifest): CapabilityRiskProfile {
  const hasSecrets = (pkg.openclaw?.requires?.env ?? []).some((k) =>
    /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(k),
  );
  const hasBins = (pkg.openclaw?.requires?.bins?.length ?? 0) > 0;
  const level =
    source.trustTier === "first-party"
      ? hasSecrets
        ? "medium"
        : "low"
      : hasSecrets
        ? "high"
        : "medium";
  return {
    level,
    network: true, // npm packages are fetched over network
    filesystem: hasBins,
    subprocess: hasBins,
    secrets: hasSecrets,
  };
}

function buildInstall(pkg: NpmPackageManifest): readonly CapabilityInstallSpec[] {
  if (pkg.openclaw?.install) {
    return pkg.openclaw.install.map((spec) => ({
      id: spec.id,
      kind: spec.kind as CapabilityInstallSpec["kind"],
      label: spec.label,
      bins: spec.bins ?? [],
    }));
  }
  // Default: install via npm
  return [
    {
      id: "npm",
      kind: "node",
      label: `npm install ${pkg.name}`,
      bins: pkg.openclaw?.requires?.bins ?? [],
    },
  ];
}

function scanFindings(pkg: NpmPackageManifest, source: CapabilitySourceRef): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Missing signature (no provenance attestation — we can't verify in browser,
  // so flag all external packages).
  if (source.trustTier !== "first-party") {
    findings.push({
      id: `${pkg.name}:missing_signature`,
      category: "missing_signature",
      severity: "low",
      message: "Package lacks verified provenance attestation.",
    });
  }

  // Suspicious install scripts
  const scripts = pkg.scripts ?? {};
  for (const [hook, cmd] of Object.entries(scripts)) {
    if (
      (hook === "preinstall" || hook === "postinstall" || hook === "install") &&
      /curl.*\|.*(?:bash|sh)/i.test(cmd)
    ) {
      findings.push({
        id: `${pkg.name}:${hook}:suspicious_install`,
        category: "suspicious_install",
        severity: "high",
        message: `Lifecycle script "${hook}" pipes a remote URL to a shell.`,
        evidence: cmd.slice(0, 200),
      });
    }
  }

  // Typosquat: non-scoped package claiming openclaw namespace
  if (!pkg.name.startsWith(`${SCOPE}/`) && pkg.name.includes("openclaw")) {
    findings.push({
      id: `${pkg.name}:typosquat`,
      category: "typosquat",
      severity: "high",
      message: "Package name contains 'openclaw' but is not in the @openclaw scope.",
    });
  }

  // License check
  if (!pkg.license || pkg.license === "UNLICENSED") {
    findings.push({
      id: `${pkg.name}:license`,
      category: "license",
      severity: "medium",
      message: "Package has no declared license or is UNLICENSED.",
    });
  }

  return findings;
}

function toManifest(pkg: NpmPackageManifest): CapabilityManifest {
  const source = buildSource(pkg.name);
  const skillKey = pkg.name.startsWith(`${SCOPE}/${SKILL_PREFIX}`)
    ? pkg.name.slice(`${SCOPE}/${SKILL_PREFIX}`.length)
    : pkg.name.replace(/^@[^/]+\//, "");

  return {
    id: `urn:openclaw:skill:${skillKey}@${pkg.version}`,
    kind: "skill",
    version: pkg.version,
    skillKey,
    name: skillKey.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: pkg.description ?? "",
    emoji: pkg.openclaw?.emoji,
    homepage: extractHomepage(pkg),
    author: extractAuthor(pkg),
    source,
    interface: { inputs: [], outputs: [] },
    contracts: buildContracts(pkg),
    behavior: {
      undoStrategy: undefined,
      costModel: (pkg.openclaw?.requires?.bins?.length ?? 0) > 0 ? "subprocess" : "free",
    },
    requirements: buildRequirements(pkg),
    install: buildInstall(pkg),
    risk: buildRisk(source, pkg),
  };
}

async function fetchPackageManifest(name: string): Promise<NpmPackageManifest | null> {
  try {
    const res = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(name)}/latest`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as NpmPackageManifest;
  } catch {
    return null;
  }
}

export class NpmSourceAdapter implements SourceAdapter {
  readonly id = "npm";
  readonly label = "npm Registry (@openclaw/skill-*)";

  async discover(filter?: DiscoveryFilter): Promise<DiscoveredCapability[]> {
    const limit = filter?.limit ?? DEFAULT_LIMIT;
    const keyword = filter?.keyword ?? "";
    const query = keyword ? `${SCOPE}/${SKILL_PREFIX}${keyword}` : `scope:openclaw skill-`;

    let searchResult: NpmSearchResult;
    try {
      const url = `${SEARCH_ENDPOINT}?text=${encodeURIComponent(query)}&size=${limit}`;
      const res = await fetch(url);
      if (!res.ok) {
        return [];
      }
      searchResult = (await res.json()) as NpmSearchResult;
    } catch {
      return [];
    }

    const now = new Date().toISOString();
    const results: DiscoveredCapability[] = [];

    // Fetch full manifests in parallel (bounded concurrency).
    const names = searchResult.objects
      .map((obj) => obj.package.name)
      .filter((name) => name.startsWith(`${SCOPE}/${SKILL_PREFIX}`));

    const manifests = await Promise.all(names.slice(0, limit).map(fetchPackageManifest));

    for (const pkg of manifests) {
      if (!pkg) {
        continue;
      }
      const manifest = toManifest(pkg);
      const findings = scanFindings(pkg, manifest.source);
      results.push({
        sourceId: this.id,
        externalId: pkg.name,
        version: pkg.version,
        manifest,
        findings,
        provenance: {
          url: `${NPM_REGISTRY_BASE}/${encodeURIComponent(pkg.name)}`,
          fetchedAt: now,
          registryName: "npmjs.com",
        },
      });
    }

    return results;
  }
}

/** Singleton instance for convenience. */
export const npmAdapter = new NpmSourceAdapter();
