// GitHub Topic Source Adapter
//
// Queries GitHub Search API for repositories tagged with the
// `openclaw-skill` topic. Fetches SKILL.md from each repo's default
// branch and converts frontmatter into a CapabilityManifest.
//
// Rate limits: unauthenticated GitHub search allows 10 req/min.
// In production, a gateway method would proxy with a PAT for higher limits.

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

const GITHUB_API = "https://api.github.com";
const TOPIC = "openclaw-skill";
const RAW_CONTENT_BASE = "https://raw.githubusercontent.com";
const DEFAULT_LIMIT = 30;

type GitHubSearchResult = {
  total_count: number;
  items: Array<{
    full_name: string;
    name: string;
    description: string | null;
    html_url: string;
    default_branch: string;
    owner: { login: string };
    topics?: string[];
    license?: { spdx_id?: string } | null;
    updated_at?: string;
  }>;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  homepage?: string;
  metadata?: {
    openclaw?: {
      emoji?: string;
      requires?: { bins?: string[]; env?: string[] };
      install?: Array<{ id: string; kind: string; label: string; bins?: string[] }>;
    };
  };
};

function parseFrontmatter(raw: string): SkillFrontmatter | null {
  // Simple YAML frontmatter parser (between --- delimiters).
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }
  const yaml = match[1];
  // Minimal key-value extraction (no full YAML parser in browser).
  const result: SkillFrontmatter = {};
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  const descMatch = yaml.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }
  const homepageMatch = yaml.match(/^homepage:\s*(.+)$/m);
  if (homepageMatch) {
    result.homepage = homepageMatch[1].trim();
  }
  // For metadata, we'd need a real YAML parser. For now, detect bins/env via regex.
  const binsMatch = yaml.match(/"bins":\s*\[([^\]]*)\]/);
  const envMatch = yaml.match(/"env":\s*\[([^\]]*)\]/);
  const emojiMatch = yaml.match(/"emoji":\s*"([^"]+)"/);
  const bins = binsMatch
    ? binsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];
  const env = envMatch
    ? envMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];
  const emoji = emojiMatch ? emojiMatch[1] : undefined;
  if (bins.length > 0 || env.length > 0 || emoji) {
    result.metadata = { openclaw: { emoji, requires: { bins, env } } };
  }
  return result;
}

function buildSource(fullName: string): CapabilitySourceRef {
  const isOfficial = fullName.startsWith("openclaw/") || fullName.startsWith("openclaw-");
  return {
    kind: "github",
    origin: fullName,
    trustTier: isOfficial ? "first-party" : "external",
  };
}

function buildRisk(source: CapabilitySourceRef, fm: SkillFrontmatter): CapabilityRiskProfile {
  const bins = fm.metadata?.openclaw?.requires?.bins ?? [];
  const env = fm.metadata?.openclaw?.requires?.env ?? [];
  const hasSecrets = env.some((k) => /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(k));
  const hasBins = bins.length > 0;
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
    network: true,
    filesystem: hasBins,
    subprocess: hasBins,
    secrets: hasSecrets,
  };
}

function buildContracts(fm: SkillFrontmatter): CapabilityContracts {
  const hasBins = (fm.metadata?.openclaw?.requires?.bins?.length ?? 0) > 0;
  return {
    sideEffects: hasBins ? ["subprocess"] : ["read_only"],
    idempotent: !hasBins,
    requiresConfirmation: false,
  };
}

function buildRequirements(fm: SkillFrontmatter): CapabilityRequirements {
  return {
    bins: fm.metadata?.openclaw?.requires?.bins ?? [],
    env: fm.metadata?.openclaw?.requires?.env ?? [],
    configPaths: [],
    operatingSystems: [],
  };
}

function buildInstall(fm: SkillFrontmatter): readonly CapabilityInstallSpec[] {
  const specs = fm.metadata?.openclaw?.install;
  if (specs && specs.length > 0) {
    return specs.map((s) => ({
      id: s.id,
      kind: s.kind as CapabilityInstallSpec["kind"],
      label: s.label,
      bins: s.bins ?? [],
    }));
  }
  return [];
}

function scanFindings(
  repo: GitHubSearchResult["items"][number],
  source: CapabilitySourceRef,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  if (source.trustTier !== "first-party") {
    findings.push({
      id: `${repo.full_name}:missing_signature`,
      category: "missing_signature",
      severity: "low",
      message: "Repository is not in the openclaw organization; no verified provenance.",
    });
  }

  if (!repo.license || !repo.license.spdx_id || repo.license.spdx_id === "NOASSERTION") {
    findings.push({
      id: `${repo.full_name}:license`,
      category: "license",
      severity: "medium",
      message: "Repository has no declared license.",
    });
  }

  // Typosquat: repo name contains "openclaw" but isn't in the org
  if (source.trustTier !== "first-party" && repo.full_name.toLowerCase().includes("openclaw")) {
    findings.push({
      id: `${repo.full_name}:typosquat`,
      category: "typosquat",
      severity: "high",
      message: "Repository name contains 'openclaw' but is not in the official organization.",
    });
  }

  return findings;
}

function toManifest(
  repo: GitHubSearchResult["items"][number],
  fm: SkillFrontmatter | null,
): CapabilityManifest {
  const source = buildSource(repo.full_name);
  const skillKey = fm?.name ?? repo.name.replace(/^skill-/, "");
  const description = fm?.description ?? repo.description ?? "";
  const effectiveFm = fm ?? {};

  return {
    id: `urn:openclaw:skill:${skillKey}@0.0.0`,
    kind: "skill",
    version: "0.0.0",
    skillKey,
    name: skillKey.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description,
    emoji: effectiveFm.metadata?.openclaw?.emoji,
    homepage: effectiveFm.homepage ?? repo.html_url,
    author: repo.owner.login,
    source,
    interface: { inputs: [], outputs: [] },
    contracts: buildContracts(effectiveFm),
    behavior: {
      undoStrategy: undefined,
      costModel:
        (effectiveFm.metadata?.openclaw?.requires?.bins?.length ?? 0) > 0 ? "subprocess" : "free",
    },
    requirements: buildRequirements(effectiveFm),
    install: buildInstall(effectiveFm),
    risk: buildRisk(source, effectiveFm),
  };
}

async function fetchSkillMd(fullName: string, branch: string): Promise<string | null> {
  // Try common paths for SKILL.md
  const paths = ["SKILL.md", "skills/SKILL.md", `skills/${fullName.split("/")[1]}/SKILL.md`];
  for (const p of paths) {
    try {
      const url = `${RAW_CONTENT_BASE}/${fullName}/${branch}/${p}`;
      const res = await fetch(url);
      if (res.ok) {
        return await res.text();
      }
    } catch {
      // continue
    }
  }
  return null;
}

export class GitHubTopicAdapter implements SourceAdapter {
  readonly id = "github-topic";
  readonly label = "GitHub Topic (openclaw-skill)";

  async discover(filter?: DiscoveryFilter): Promise<DiscoveredCapability[]> {
    const limit = filter?.limit ?? DEFAULT_LIMIT;
    const keyword = filter?.keyword ?? "";
    const query = keyword ? `topic:${TOPIC} ${keyword} in:name,description` : `topic:${TOPIC}`;

    let searchResult: GitHubSearchResult;
    try {
      const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=updated`;
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) {
        return [];
      }
      searchResult = (await res.json()) as GitHubSearchResult;
    } catch {
      return [];
    }

    const now = new Date().toISOString();
    const results: DiscoveredCapability[] = [];

    // Fetch SKILL.md from each repo (bounded concurrency via Promise.all).
    const items = searchResult.items.slice(0, limit);
    const skillMds = await Promise.all(
      items.map((repo) => fetchSkillMd(repo.full_name, repo.default_branch)),
    );

    for (let i = 0; i < items.length; i++) {
      const repo = items[i];
      const raw = skillMds[i];
      const fm = raw ? parseFrontmatter(raw) : null;
      const manifest = toManifest(repo, fm);
      const source = buildSource(repo.full_name);
      const findings = scanFindings(repo, source);

      results.push({
        sourceId: this.id,
        externalId: repo.full_name,
        version: "0.0.0",
        manifest,
        findings,
        provenance: {
          url: repo.html_url,
          fetchedAt: now,
          registryName: "github.com",
        },
      });
    }

    return results;
  }
}

/** Singleton instance for convenience. */
export const githubTopicAdapter = new GitHubTopicAdapter();
