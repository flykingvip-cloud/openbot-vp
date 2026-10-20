export type RemoteCapabilityManifest = {
  id: string;
  kind: "skill";
  version: string;
  skillKey: string;
  name: string;
  description: string;
  descriptionZh?: string;
  categoryId?: string;
  emoji?: string;
  homepage?: string;
  author?: string;
  source: {
    kind: "github" | "npm";
    origin: string;
    trustTier: "first-party" | "external";
  };
  interface: {
    inputs: unknown[];
    outputs: unknown[];
  };
  contracts: {
    sideEffects: string[];
    idempotent: boolean;
    requiresConfirmation: boolean;
  };
  behavior: {
    costModel: string;
  };
  requirements: {
    bins: string[];
    env: string[];
    configPaths: string[];
    operatingSystems: string[];
  };
  install: unknown[];
  risk: {
    level: "low" | "medium";
    network: boolean;
    filesystem: boolean;
    subprocess: boolean;
    secrets: boolean;
  };
};

export type RemoteDiscoveredCapability = {
  sourceId: string;
  externalId: string;
  version: string;
  manifest: RemoteCapabilityManifest;
  findings: Array<{
    id: string;
    category: "missing_signature";
    severity: "low";
    message: string;
  }>;
  provenance: {
    url: string;
    fetchedAt: string;
    registryName: string;
  };
};

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
};

type GitHubSearchResult = {
  items?: Array<{
    full_name: string;
    name: string;
    description: string | null;
    html_url: string;
    default_branch: string;
    owner: { login: string };
  }>;
};

type NpmSearchResult = {
  objects?: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      author?: { name?: string } | string;
      homepage?: string;
      repository?: string | { url?: string };
    };
  }>;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  homepage?: string;
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
        return decodeURIComponent(pkgSegments[0] ?? "");
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

function parseFrontmatter(raw: string): SkillFrontmatter {
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
    description: descMatch?.[1].trim().replace(/^["']|["']$/g, ""),
    homepage: homepageMatch?.[1].trim().replace(/^["']|["']$/g, ""),
  };
}

function humanizeSkillName(skillKey: string) {
  return skillKey.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveGitHubSkillKey(
  repo: GitHubRepoRef,
  skillPath: string,
  frontmatter: SkillFrontmatter,
) {
  const explicitName = frontmatter.name?.trim();
  if (explicitName) {
    return explicitName;
  }
  const segments = skillPath.split("/").filter(Boolean);
  const folder = segments.at(-2) ?? repo.repo;
  return repo.subpath ? folder : folder.replace(/^skill-/i, "");
}

function buildGitHubPathCandidates(repo: GitHubRepoRef): string[] {
  const candidates = new Set<string>();
  const cleanedSubpath = repo.subpath?.replace(/^\/+|\/+$/g, "") ?? "";
  if (cleanedSubpath) {
    candidates.add(
      cleanedSubpath.endsWith("SKILL.md") ? cleanedSubpath : `${cleanedSubpath}/SKILL.md`,
    );
  } else {
    candidates.add("SKILL.md");
    candidates.add("skills/SKILL.md");
    candidates.add(`skills/${repo.repo.replace(/^skill-/i, "")}/SKILL.md`);
  }
  return [...candidates];
}

function decodeBase64Text(content: string): string | null {
  try {
    return Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain, application/vnd.github.raw",
        "User-Agent": "openbot-capability-import",
      },
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: URL | string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, application/vnd.github+json",
        "User-Agent": "openbot-capability-import",
      },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
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
  const data = await fetchJson<GitHubContentFile>(url);
  if (data?.type !== "file" || data.encoding !== "base64" || !data.content) {
    return null;
  }
  return decodeBase64Text(data.content);
}

function buildGitHubManifest(
  repo: GitHubRepoRef,
  skillPath: string,
  frontmatter: SkillFrontmatter,
): RemoteCapabilityManifest {
  const skillKey = deriveGitHubSkillKey(repo, skillPath, frontmatter);
  const fullName = `${repo.owner}/${repo.repo}`;
  const trustTier = repo.owner === "openclaw" ? "first-party" : "external";
  return {
    id: `urn:openclaw:skill:${skillKey}@0.0.0`,
    kind: "skill",
    version: "0.0.0",
    skillKey,
    name: humanizeSkillName(skillKey),
    description: frontmatter.description ?? `Imported from ${fullName}`,
    homepage: frontmatter.homepage ?? repo.canonicalUrl,
    author: repo.owner,
    source: {
      kind: "github",
      origin: repo.canonicalUrl,
      trustTier,
    },
    interface: { inputs: [], outputs: [] },
    contracts: {
      sideEffects: ["read_only"],
      idempotent: true,
      requiresConfirmation: false,
    },
    behavior: { costModel: "free" },
    requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
    install: [],
    risk: {
      level: trustTier === "first-party" ? "low" : "medium",
      network: true,
      filesystem: false,
      subprocess: false,
      secrets: false,
    },
  };
}

function buildGitHubFindings(repo: GitHubRepoRef): RemoteDiscoveredCapability["findings"] {
  const fullName = `${repo.owner}/${repo.repo}`;
  return repo.owner === "openclaw"
    ? []
    : [
        {
          id: `${fullName}:missing_signature`,
          category: "missing_signature",
          severity: "low",
          message: "Repository is outside the openclaw organization; provenance is not verified.",
        },
      ];
}

function buildNpmManifest(
  pkg: NonNullable<NpmSearchResult["objects"]>[number]["package"],
): RemoteCapabilityManifest {
  const skillKey = pkg.name.startsWith("@openclaw/skill-")
    ? pkg.name.slice("@openclaw/skill-".length)
    : pkg.name.replace(/^@[^/]+\//, "").replace(/^skill-/, "");
  const trustTier = pkg.name.startsWith("@openclaw/") ? "first-party" : "external";
  return {
    id: `urn:openclaw:skill:${skillKey}@${pkg.version}`,
    kind: "skill",
    version: pkg.version,
    skillKey,
    name: humanizeSkillName(skillKey),
    description: pkg.description ?? "",
    homepage:
      typeof pkg.homepage === "string"
        ? pkg.homepage
        : typeof pkg.repository === "string"
          ? pkg.repository
          : pkg.repository?.url,
    author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name,
    source: {
      kind: "npm",
      origin: pkg.name,
      trustTier,
    },
    interface: { inputs: [], outputs: [] },
    contracts: {
      sideEffects: ["read_only"],
      idempotent: true,
      requiresConfirmation: false,
    },
    behavior: { costModel: "free" },
    requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
    install: [],
    risk: {
      level: trustTier === "first-party" ? "low" : "medium",
      network: true,
      filesystem: false,
      subprocess: false,
      secrets: false,
    },
  };
}

function buildNpmFindings(name: string): RemoteDiscoveredCapability["findings"] {
  return name.startsWith("@openclaw/")
    ? []
    : [
        {
          id: `${name}:missing_signature`,
          category: "missing_signature",
          severity: "low",
          message: "Package is outside the openclaw scope; provenance is not verified.",
        },
      ];
}

async function resolveGitHubSkillCandidate(
  repo: GitHubRepoRef,
  sourceId: string,
): Promise<RemoteDiscoveredCapability | null> {
  const branches = [...new Set([repo.branch, "main", "master"].filter(Boolean) as string[])];
  const pathCandidates = buildGitHubPathCandidates(repo);
  const fullName = `${repo.owner}/${repo.repo}`;

  for (const branch of branches) {
    for (const skillPath of pathCandidates) {
      const raw =
        (await fetchGitHubSkillMdFromContents(repo, branch, skillPath)) ??
        (await fetchText(
          `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${skillPath}`,
        ));
      if (!raw) {
        continue;
      }

      const normalizedPath = skillPath.replace(/\/SKILL\.md$/i, "");
      return {
        sourceId,
        externalId:
          normalizedPath && normalizedPath !== "SKILL.md"
            ? `${fullName}:${normalizedPath}`
            : fullName,
        version: "0.0.0",
        manifest: buildGitHubManifest(repo, skillPath, parseFrontmatter(raw)),
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
    const fallbackSkillPath = pathCandidates[0] ?? "SKILL.md";
    const normalizedPath = fallbackSkillPath.replace(/\/SKILL\.md$/i, "");
    return {
      sourceId,
      externalId:
        normalizedPath && normalizedPath !== "SKILL.md"
          ? `${fullName}:${normalizedPath}`
          : fullName,
      version: "0.0.0",
      manifest: buildGitHubManifest(repo, fallbackSkillPath, {}),
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

async function searchNpmCapabilities(keyword: string): Promise<RemoteDiscoveredCapability[]> {
  const text = keyword.trim();
  if (!text) {
    return [];
  }
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.searchParams.set("text", text);
  url.searchParams.set("size", "10");
  const data = await fetchJson<NpmSearchResult>(url);
  const normalized = text.toLowerCase();
  return (data?.objects ?? [])
    .map(({ package: pkg }) => {
      const skillKey = pkg.name.startsWith("@openclaw/skill-")
        ? pkg.name.slice("@openclaw/skill-".length)
        : pkg.name.replace(/^@[^/]+\//, "").replace(/^skill-/, "");
      return {
        sourceId: "npm",
        externalId: pkg.name,
        version: pkg.version,
        manifest: buildNpmManifest(pkg),
        findings: buildNpmFindings(pkg.name),
        provenance: {
          url: pkg.homepage ?? `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
          fetchedAt: new Date().toISOString(),
          registryName: "npmjs.com",
        },
        matchKey: `${pkg.name.toLowerCase()} ${skillKey.toLowerCase()}`,
      };
    })
    .filter((candidate) => candidate.matchKey.includes(normalized))
    .slice(0, 10)
    .map(({ matchKey: _matchKey, ...candidate }) => candidate);
}

async function searchGitHubCapabilities(keyword: string): Promise<RemoteDiscoveredCapability[]> {
  const text = keyword.trim();
  if (!text) {
    return [];
  }
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `topic:openclaw-skill ${text}`);
  url.searchParams.set("per_page", "10");
  const data = await fetchJson<GitHubSearchResult>(url);
  const results: RemoteDiscoveredCapability[] = [];
  for (const repo of data?.items ?? []) {
    const candidate = await resolveGitHubSkillCandidate(
      {
        owner: repo.owner.login,
        repo: repo.name,
        branch: repo.default_branch,
        subpath: null,
        canonicalUrl: repo.html_url,
      },
      "github-topic",
    );
    if (candidate) {
      results.push(candidate);
    }
  }
  return results;
}

export async function resolveRemoteCapabilityCandidates(
  input: string,
): Promise<RemoteDiscoveredCapability[]> {
  const repo = normalizeGitHubRepo(input);
  if (repo) {
    const candidate = await resolveGitHubSkillCandidate(repo, "github-url");
    return candidate ? [candidate] : [];
  }

  const npmPackage = normalizeNpmPackage(input);
  if (npmPackage) {
    const matches = await searchNpmCapabilities(npmPackage);
    return matches.filter(
      (candidate) => candidate.externalId.toLowerCase() === npmPackage.toLowerCase(),
    );
  }

  return [...(await searchNpmCapabilities(input)), ...(await searchGitHubCapabilities(input))];
}

export const resolveRemoteCapabilityImport = resolveRemoteCapabilityCandidates;
