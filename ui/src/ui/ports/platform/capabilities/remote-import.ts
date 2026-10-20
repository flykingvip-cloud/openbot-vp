import { githubTopicAdapter } from "../../../capability/capability-governance/discovery/github-adapter.ts";
import { npmAdapter } from "../../../capability/capability-governance/discovery/npm-adapter.ts";
import type { DiscoveredCapability } from "../../../capability/capability-governance/discovery/types.ts";
import type {
  CapabilityContracts,
  CapabilityManifest,
  CapabilityRequirements,
  CapabilityRiskProfile,
  CapabilitySourceRef,
  SecurityFinding,
} from "../../../capability/capability-governance/types.ts";

type GitHubRepoRef = {
  owner: string;
  repo: string;
  branch?: string | null;
  subpath?: string | null;
  canonicalUrl: string;
};

type GitHubContentFile = {
  type?: string;
  encoding?: string;
  content?: string;
  download_url?: string | null;
};

function normalizeGitHubRepo(input: string): GitHubRepoRef | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname.includes("github.com")) {
        return null;
      }
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length < 2) {
        return null;
      }
      const branch =
        segments[2] === "tree" || segments[2] === "blob" ? (segments[3] ?? null) : null;
      const subpath =
        segments[2] === "tree" || segments[2] === "blob"
          ? segments.slice(4).join("/") || null
          : null;
      return {
        owner: segments[0],
        repo: segments[1].replace(/\.git$/i, ""),
        branch,
        subpath,
        canonicalUrl: url.toString(),
      };
    } catch {
      return null;
    }
  }
  const match = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) {
    return null;
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  return {
    owner,
    repo,
    branch: null,
    subpath: null,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

function normalizeNpmPackage(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!url.hostname.includes("npmjs.com")) {
        return null;
      }
      const segments = url.pathname.split("/").filter(Boolean);
      const packageIndex = segments.indexOf("package");
      if (packageIndex >= 0 && segments[packageIndex + 1]) {
        const pkgSegments = segments.slice(packageIndex + 1);
        if (pkgSegments.length >= 2 && pkgSegments[0]?.startsWith("@")) {
          return decodeURIComponent(`${pkgSegments[0]}/${pkgSegments[1]}`);
        }
        return decodeURIComponent(pkgSegments[0]);
      }
      return null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("@") || trimmed.startsWith("skill-")) {
    return trimmed;
  }
  return null;
}

function parseFrontmatter(raw: string): { name?: string; description?: string; homepage?: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const homepageMatch = yaml.match(/^homepage:\s*(.+)$/m);
  return {
    name: nameMatch?.[1].trim().replace(/^["']|["']$/g, ""),
    description: descMatch?.[1].trim(),
    homepage: homepageMatch?.[1].trim(),
  };
}

function humanizeSkillName(skillKey: string) {
  return skillKey.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveSkillKey(repo: GitHubRepoRef, skillPath: string, frontmatter: { name?: string }) {
  const explicitName = frontmatter.name?.trim();
  if (explicitName) {
    return explicitName;
  }
  const segments = skillPath.split("/").filter(Boolean);
  const folder = segments.at(-2) ?? repo.repo;
  return repo.subpath ? folder : folder.replace(/^skill-/i, "");
}

function buildGitHubSource(repo: GitHubRepoRef): CapabilitySourceRef {
  return {
    kind: "github",
    origin: repo.canonicalUrl,
    trustTier: repo.owner === "openclaw" ? "first-party" : "external",
  };
}

function buildGitHubRisk(source: CapabilitySourceRef): CapabilityRiskProfile {
  return {
    level: source.trustTier === "first-party" ? "low" : "medium",
    network: true,
    filesystem: false,
    subprocess: false,
    secrets: false,
  };
}

function buildGitHubContracts(): CapabilityContracts {
  return {
    sideEffects: ["read_only"],
    idempotent: true,
    requiresConfirmation: false,
  };
}

function buildGitHubRequirements(): CapabilityRequirements {
  return {
    bins: [],
    env: [],
    configPaths: [],
    operatingSystems: [],
  };
}

function buildGitHubFindings(repo: GitHubRepoRef): SecurityFinding[] {
  const fullName = `${repo.owner}/${repo.repo}`;
  const findings: SecurityFinding[] = [];
  if (repo.owner !== "openclaw") {
    findings.push({
      id: `${fullName}:missing_signature`,
      category: "missing_signature",
      severity: "low",
      message: "Repository is not in the openclaw organization; no verified provenance.",
    });
  }
  return findings;
}

function buildGitHubManifest(
  repo: GitHubRepoRef,
  skillPath: string,
  frontmatter: { name?: string; description?: string; homepage?: string },
  version = "0.0.0",
): CapabilityManifest {
  const skillKey = deriveSkillKey(repo, skillPath, frontmatter);
  const source = buildGitHubSource(repo);
  return {
    id: `urn:openclaw:skill:${skillKey}@${version}`,
    kind: "skill",
    version,
    skillKey,
    name: humanizeSkillName(skillKey),
    description: frontmatter.description ?? `Imported from ${repo.owner}/${repo.repo}`,
    homepage: frontmatter.homepage ?? repo.canonicalUrl,
    author: repo.owner,
    source,
    interface: { inputs: [], outputs: [] },
    contracts: buildGitHubContracts(),
    behavior: { costModel: "free" },
    requirements: buildGitHubRequirements(),
    install: [],
    risk: buildGitHubRisk(source),
  };
}

function buildGitHubPathCandidates(repo: GitHubRepoRef): string[] {
  const candidates = new Set<string>();
  const cleanedSubpath = repo.subpath?.replace(/^\/+|\/+$/g, "") ?? "";
  if (cleanedSubpath) {
    if (cleanedSubpath.endsWith("SKILL.md")) {
      candidates.add(cleanedSubpath);
    } else {
      candidates.add(`${cleanedSubpath}/SKILL.md`);
    }
  } else {
    candidates.add("SKILL.md");
    candidates.add("skills/SKILL.md");
    candidates.add(`skills/${repo.repo.replace(/^skill-/i, "")}/SKILL.md`);
  }
  return [...candidates];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

function decodeBase64Text(content: string): string | null {
  const normalized = content.replace(/\s+/g, "");
  try {
    if (typeof atob === "function") {
      const binary = atob(normalized);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    // Fall through to the Node-specific fallback below.
  }
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function fetchGitHubSkillMdFromContents(
  repo: GitHubRepoRef,
  branch: string,
  skillPath: string,
): Promise<string | null> {
  const encodedPath = skillPath.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as GitHubContentFile;
    if (data.type !== "file" || data.encoding !== "base64" || !data.content) {
      return null;
    }
    return decodeBase64Text(data.content);
  } catch {
    return null;
  }
}

async function resolveGitHubSkillCandidate(input: string): Promise<DiscoveredCapability | null> {
  const repo = normalizeGitHubRepo(input);
  if (!repo) {
    return null;
  }

  const branches = [...new Set([repo.branch, "main", "master"].filter(Boolean) as string[])];
  const pathCandidates = buildGitHubPathCandidates(repo);
  const fullName = `${repo.owner}/${repo.repo}`;

  for (const branch of branches) {
    for (const skillPath of pathCandidates) {
      const raw = (await fetchGitHubSkillMdFromContents(repo, branch, skillPath)) ?? null;
      const fallbackRaw =
        raw ??
        (await fetchText(
          `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${skillPath}`,
        ));
      if (!fallbackRaw) {
        continue;
      }
      const frontmatter = parseFrontmatter(fallbackRaw);
      const normalizedPath = skillPath.replace(/\/SKILL\.md$/i, "");
      return {
        sourceId: "github-url",
        externalId:
          normalizedPath && normalizedPath !== "SKILL.md"
            ? `${fullName}:${normalizedPath}`
            : fullName,
        version: "0.0.0",
        manifest: buildGitHubManifest(repo, skillPath, frontmatter),
        findings: buildGitHubFindings(repo),
        provenance: {
          url: repo.canonicalUrl,
          fetchedAt: new Date().toISOString(),
          registryName: "github.com",
        },
      };
    }
  }

  const canFallback = Boolean(repo.subpath?.trim() || repo.repo.startsWith("skill-"));
  if (canFallback) {
    const skillPath = pathCandidates[0] ?? "SKILL.md";
    const normalizedPath = skillPath.replace(/\/SKILL\.md$/i, "");
    return {
      sourceId: "github-url",
      externalId:
        normalizedPath && normalizedPath !== "SKILL.md"
          ? `${fullName}:${normalizedPath}`
          : fullName,
      version: "0.0.0",
      manifest: buildGitHubManifest(repo, skillPath, {}),
      findings: buildGitHubFindings(repo),
      provenance: {
        url: repo.canonicalUrl,
        fetchedAt: new Date().toISOString(),
        registryName: "github.com",
      },
    };
  }

  return null;
}

export async function resolveRemoteCapabilityCandidates(
  input: string,
): Promise<DiscoveredCapability[]> {
  const githubRepo = normalizeGitHubRepo(input);
  if (githubRepo) {
    const directCandidate = await resolveGitHubSkillCandidate(input);
    if (directCandidate) {
      return [directCandidate];
    }
    const candidates = await githubTopicAdapter.discover({ keyword: githubRepo.repo, limit: 20 });
    return candidates.filter(
      (candidate) =>
        candidate.externalId.toLowerCase() ===
        `${githubRepo.owner}/${githubRepo.repo}`.toLowerCase(),
    );
  }

  const npmPackage = normalizeNpmPackage(input);
  if (npmPackage) {
    const candidates = await npmAdapter.discover({ keyword: npmPackage, limit: 20 });
    return candidates.filter(
      (candidate) => candidate.externalId.toLowerCase() === npmPackage.toLowerCase(),
    );
  }

  // Generic keyword search: query both GitHub topic and npm registry
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  const [githubResults, npmResults] = await Promise.all([
    githubTopicAdapter.discover({ keyword: trimmed, limit: 15 }).catch(() => []),
    npmAdapter.discover({ keyword: trimmed, limit: 15 }).catch(() => []),
  ]);
  return [...githubResults, ...npmResults];
}
