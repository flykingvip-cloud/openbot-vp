/**
 * Capability map + knowledge graph for one robot.
 * Only named skills this robot installed, adapted, or used, such as 微信公众号成稿.
 * Primitive tools (browser, search, command) and the shared catalog are not its skills.
 * Captured deliverables stay outputs.
 * The knowledge graph is what this robot remembers: standing memory, topic notes
 * it keeps, memory claims, and knowledge bases bound to it. Daily logs,
 * generated reports, and workspace deliverables stay off the graph.
 */

import {
  resolveMyBotCapabilityDomain,
  type MyBotCapabilityDomainId,
  type MyBotDomainVector,
} from "../semantic/my-bot-read-model.ts";

export type RobotCapabilityOrigin = "installed" | "created" | "evolved" | "used";

export type RobotCapabilityNode = {
  id: string;
  name: string;
  domain: MyBotCapabilityDomainId;
  callCount: number;
  /** Installed on this robot, adapted by it, evolved, or observed in real use. */
  origin: RobotCapabilityOrigin;
  /** Evidence weight: install usage, or pattern sample count. */
  weight: number;
};

export type RobotKnowledgeNode = {
  id: string;
  label: string;
  documents: string[];
};

export type RobotOutputNode = {
  id: string;
  title: string;
};

export type RobotCapabilityAtlas = {
  agentId: string;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  capabilities: RobotCapabilityNode[];
  knowledge: RobotKnowledgeNode[];
  outputs: RobotOutputNode[];
};

type AtlasClient = {
  request: (method: string, params?: unknown) => Promise<unknown>;
};

const DOMAIN_ORDER: MyBotCapabilityDomainId[] = [
  "research",
  "content",
  "data",
  "collab",
  "tools",
  "general",
];

const atlases = new Map<string, RobotCapabilityAtlas>();
const inflight = new Map<string, Promise<void>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function capabilityDomainLabel(domain: MyBotCapabilityDomainId): string {
  switch (domain) {
    case "research":
      return "分析";
    case "content":
      return "内容";
    case "data":
      return "数据";
    case "collab":
      return "协作";
    case "tools":
      return "工具";
    default:
      return "综合";
  }
}

export function capabilityDomainOrder(): readonly MyBotCapabilityDomainId[] {
  return DOMAIN_ORDER;
}

/** Conversation captures stored as skill assets. They are outputs, not mastery. */
export function isCapturedDeliverable(skill: unknown): boolean {
  const row = asRecord(skill);
  if (!row) {
    return false;
  }
  if (asRecord(row.deliverableArtifact)) {
    return true;
  }
  const profile = asRecord(row.profile);
  const category = asString(profile?.category);
  if (category === "对话成果") {
    return true;
  }
  const assetType = asString(profile?.assetType);
  const tags = Array.isArray(profile?.tags) ? profile.tags.map((tag) => asString(tag)) : [];
  if (assetType === "knowledge" && tags.includes("saved")) {
    return true;
  }
  const input = asString(profile?.inputDescription);
  return input.startsWith("自动捕获");
}

export function partitionRobotSkills(skills: unknown[]): {
  capabilities: RobotCapabilityNode[];
  knowledge: RobotKnowledgeNode[];
  outputs: RobotOutputNode[];
} {
  const capabilities: RobotCapabilityNode[] = [];
  const knowledge: RobotKnowledgeNode[] = [];
  const outputs: RobotOutputNode[] = [];
  for (const entry of skills) {
    const row = asRecord(entry);
    if (!row) {
      continue;
    }
    const profile = asRecord(row.profile);
    const id = asString(row.id) || asString(profile?.id);
    const name = asString(profile?.name) || id;
    if (!id || !name) {
      continue;
    }
    if (isCapturedDeliverable(row)) {
      outputs.push({ id, title: name });
      continue;
    }
    const assetType = asString(profile?.assetType);
    if (assetType === "knowledge") {
      knowledge.push({ id, label: name, documents: [] });
      continue;
    }
    const runtime = asRecord(row.runtimeDefinition);
    const capabilityIds = Array.isArray(runtime?.capabilities)
      ? runtime.capabilities.map((item) => asString(item)).filter(Boolean)
      : [];
    const domain = resolveMyBotCapabilityDomain({
      name,
      description: [asString(profile?.summary), ...capabilityIds].filter(Boolean).join(" "),
      domain: domainFromCapabilityIds(capabilityIds),
    });
    const callCount =
      typeof row.usageCount === "number" && Number.isFinite(row.usageCount) ? row.usageCount : 0;
    const versionCount = typeof row.versionCount === "number" ? row.versionCount : 1;
    capabilities.push({
      id,
      name,
      domain,
      callCount,
      origin: versionCount > 1 ? "evolved" : "installed",
      weight: callCount,
    });
  }
  return { capabilities, knowledge, outputs };
}

/** Routine tools every robot can call. They are not an individual skill. */
const PRIMITIVE_TOOLS = new Set([
  "browser",
  "web_search",
  "web_fetch",
  "exec",
  "read",
  "write",
  "process",
  "memory_search",
  "memory_get",
  "conversation_send",
  "sessions_spawn",
  "message",
]);

const GENERIC_SKILL_NAMES = new Set(["", "稳定工作模式"]);

function isIndividualSkillName(name: string): boolean {
  const trimmed = name.trim();
  if (GENERIC_SKILL_NAMES.has(trimmed) || PRIMITIVE_TOOLS.has(trimmed)) {
    return false;
  }
  return !PRIMITIVE_TOOLS.has(trimmed.toLowerCase());
}

/** Skills this robot created or evolved, including patterns that are not installed yet. */
export function capabilityNodesFromEvolution(params: {
  agentId: string;
  personalSkills: unknown[];
  candidates: unknown[];
  alreadyIncludedIds: ReadonlySet<string>;
}): RobotCapabilityNode[] {
  const nodes: RobotCapabilityNode[] = [];
  for (const entry of params.personalSkills) {
    const row = asRecord(entry);
    const source = asRecord(row?.sourceRobot);
    if (asString(source?.id) !== params.agentId || isCapturedDeliverable(row)) {
      continue;
    }
    const partitioned = partitionRobotSkills([entry]);
    for (const cap of partitioned.capabilities) {
      if (params.alreadyIncludedIds.has(cap.id)) {
        continue;
      }
      nodes.push({ ...cap, origin: cap.origin === "evolved" ? "evolved" : "created" });
    }
  }
  for (const entry of params.candidates) {
    const row = asRecord(entry);
    if (!row || asString(row.agentId) !== params.agentId) {
      continue;
    }
    const status = asString(row.status);
    if (status === "rejected") {
      continue;
    }
    const publishedId = asString(row.publishedSkillId) || asString(row.skillId);
    if (publishedId && params.alreadyIncludedIds.has(publishedId)) {
      continue;
    }
    const id = asString(row.candidateId) || publishedId;
    if (!id) {
      continue;
    }
    const name = asString(row.suggestedName);
    if (!isIndividualSkillName(name)) {
      continue;
    }
    const summary = asString(row.suggestedSummary);
    const samples =
      typeof row.sampleCount === "number" && row.sampleCount > 0 ? row.sampleCount : 1;
    nodes.push({
      id,
      name,
      domain: resolveMyBotCapabilityDomain({ name, description: summary }),
      callCount: samples,
      origin: status === "published" || status === "approved" ? "evolved" : "used",
      weight: samples,
    });
  }
  return collapseCapabilities(nodes);
}

function collapseCapabilities(nodes: RobotCapabilityNode[]): RobotCapabilityNode[] {
  const merged = new Map<string, RobotCapabilityNode>();
  for (const node of nodes) {
    const key = `${node.origin}|${node.domain}|${node.name}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...node });
      continue;
    }
    existing.callCount += node.callCount;
    existing.weight += node.weight;
  }
  return [...merged.values()];
}

/** Relative strength per axis. The strongest axis reaches 1. */
export function buildCapabilityRadar(
  capabilities: readonly RobotCapabilityNode[],
): MyBotDomainVector {
  const raw: MyBotDomainVector = { research: 0, content: 0, data: 0, collab: 0, tools: 0 };
  for (const cap of capabilities) {
    if (cap.domain === "general") {
      continue;
    }
    raw[cap.domain] += cap.weight > 0 ? Math.log1p(cap.weight) : 0.45;
  }
  const max = Math.max(raw.research, raw.content, raw.data, raw.collab, raw.tools, 0);
  if (max <= 0) {
    return raw;
  }
  return {
    research: raw.research / max,
    content: raw.content / max,
    data: raw.data / max,
    collab: raw.collab / max,
    tools: raw.tools / max,
  };
}

const RUNTIME_SKILL_DOMAINS: Array<{ domain: MyBotCapabilityDomainId; pattern: RegExp }> = [
  {
    domain: "research",
    pattern: /research|market|seo|competitor|strateg|分析|调研|市场|竞品|情报/i,
  },
  {
    domain: "content",
    pattern: /content|write|doc|ppt|wiki|video|article|文案|文档|写作|报告|公众号|成稿|排版/i,
  },
  { domain: "data", pattern: /data|csv|excel|metric|analytics|统计|报表|表格/i },
  { domain: "collab", pattern: /feishu|wecom|slack|meeting|mail|协作|会议|沟通/i },
  { domain: "tools", pattern: /api|workflow|browser|automation|script|cli|工具|执行/i },
];

const ROBOT_OWNED_SOURCES = new Set(["openclaw-workspace", "openbot-lifecycle-binding"]);

/** Platform catalog and shared plugin skills are available, not this robot's mastery. */
function isRobotOwnedRuntimeSkill(row: Record<string, unknown>): boolean {
  if (row.bundled === true || row.eligible !== true || row.disabled === true) {
    return false;
  }
  const source = asString(row.source);
  if (ROBOT_OWNED_SOURCES.has(source)) {
    return true;
  }
  return source.includes("workspace") || source.includes("binding");
}

/**
 * Skills this robot actually opened or invoked.
 * Descriptions come from skills.status so the radar can place 微信公众号成稿 on 内容.
 */
export function capabilityNodesFromNamedUses(
  uses: unknown[],
  catalog: unknown[],
): RobotCapabilityNode[] {
  const descriptions = new Map<string, string>();
  for (const entry of catalog) {
    const row = asRecord(entry);
    const key = asString(row?.skillKey) || asString(row?.name);
    if (key) {
      descriptions.set(key, asString(row?.description));
    }
  }
  const nodes: RobotCapabilityNode[] = [];
  for (const entry of uses) {
    const row = asRecord(entry);
    const key = asString(row?.name);
    const count = typeof row?.count === "number" && row.count > 0 ? row.count : 0;
    if (!isIndividualSkillName(key) || count <= 0) {
      continue;
    }
    const description = descriptions.get(key) ?? "";
    const name = displaySkillName(key, description);
    nodes.push({
      id: key,
      name,
      domain: domainForRuntimeSkill(name, `${key} ${description}`),
      callCount: count,
      origin: "used",
      weight: count,
    });
  }
  return nodes;
}

function displaySkillName(name: string, description: string): string {
  if (/[\u4e00-\u9fff]/.test(name)) {
    return name;
  }
  const made = description.match(/做([\u4e00-\u9fff]{2,12})/);
  return made?.[1] ?? name;
}

/** skills.status rows installed into this robot. The shared catalog is excluded. */
export function capabilityNodesFromRuntimeSkills(skills: unknown[]): RobotCapabilityNode[] {
  const nodes: RobotCapabilityNode[] = [];
  for (const entry of skills) {
    const row = asRecord(entry);
    if (!row || !isRobotOwnedRuntimeSkill(row)) {
      continue;
    }
    const name = asString(row.name) || asString(row.skillKey);
    if (!isIndividualSkillName(name)) {
      continue;
    }
    const description = asString(row.description);
    nodes.push({
      id: asString(row.skillKey) || name,
      name,
      domain: domainForRuntimeSkill(name, description),
      callCount: 0,
      origin: "installed",
      weight: 1,
    });
  }
  return nodes;
}

function domainForRuntimeSkill(name: string, description: string): MyBotCapabilityDomainId {
  const fromText = resolveMyBotCapabilityDomain({ name, description });
  if (fromText !== "general") {
    return fromText;
  }
  const haystack = `${name} ${description}`;
  for (const rule of RUNTIME_SKILL_DOMAINS) {
    if (rule.pattern.test(haystack)) {
      return rule.domain;
    }
  }
  return "general";
}

function domainFromCapabilityIds(ids: string[]): MyBotCapabilityDomainId | null {
  for (const id of ids) {
    const head = id.split(".")[0]?.toLowerCase() ?? "";
    if (head === "research" || head === "analysis") {
      return "research";
    }
    if (head === "document" || head === "content") {
      return "content";
    }
    if (head === "data") {
      return "data";
    }
    if (head === "collab" || head === "collaboration") {
      return "collab";
    }
    if (head === "tool" || head === "tools" || head === "mcp") {
      return "tools";
    }
  }
  return null;
}

const DAILY_MEMORY = /(?:^|\/)\d{4}-\d{2}-\d{2}\.md$/i;
const GENERATED_MEMORY =
  /skill-analysis-report|competitor|daily-brief|article-|checkpoint|snapshot|price-check|price_check|\d{4}-\d{2}-\d{2}/i;
const SECRET_TEXT = /@|secret|token|password|appsecret/i;
const STANDING_TOPIC_LABELS: Record<string, string> = {
  "identity baseline": "身份",
  "user relationship": "和用户的关系",
};
const CLAIM_LABELS: Record<string, string> = {
  strategy: "策略",
  preference: "偏好",
  policy: "原则",
  failure_pattern: "失败经验",
  anti_pattern: "避开的做法",
};

/** Topic notes the robot keeps. Daily logs and generated reports are not mastery. */
export function isMasteredTopicMemoryKey(key: string): boolean {
  const normalized = key.trim().replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (!lower.startsWith("memory/") || !lower.endsWith(".md")) {
    return false;
  }
  if (DAILY_MEMORY.test(lower) || GENERATED_MEMORY.test(lower)) {
    return false;
  }
  return !normalized.split("/").includes("..");
}

export function selectMasteredTopicKeys(
  entries: readonly { key: string; updatedAtMs?: number }[],
): string[] {
  const ranked = entries
    .filter((entry) => isMasteredTopicMemoryKey(entry.key))
    .toSorted((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0) || a.key.localeCompare(b.key));
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const entry of ranked) {
    const id = entry.key.trim().toLowerCase();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    keys.push(entry.key.trim());
    if (keys.length >= 8) {
      break;
    }
  }
  return keys;
}

function cleanHeading(value: string): string {
  return value
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownHeadings(markdown: string, level: 1 | 2): string[] {
  const pattern = level === 1 ? /^#\s+(.+)$/ : /^##\s+(.+)$/;
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const title = cleanHeading(match[1]);
    if (!title || SECRET_TEXT.test(title) || /^memory\.md/i.test(title)) {
      continue;
    }
    headings.push(title.slice(0, 40));
  }
  return headings;
}

/** Standing sections in MEMORY.md. Bullet text stays out so addresses are not shown. */
export function standingMemoryTopics(markdown: string): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();
  for (const heading of markdownHeadings(markdown, 2)) {
    const label = STANDING_TOPIC_LABELS[heading.toLowerCase()] ?? heading;
    const id = label.toLowerCase();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    topics.push(label);
    if (topics.length >= 8) {
      break;
    }
  }
  return topics;
}

export function knowledgeNodesFromMastery(input: {
  standingMarkdown?: string;
  topics?: readonly { key: string; markdown: string }[];
  atoms?: readonly { id: string; summary: string; atomType?: string }[];
}): RobotKnowledgeNode[] {
  const nodes: RobotKnowledgeNode[] = [];
  const standing = standingMemoryTopics(input.standingMarkdown ?? "");
  if (standing.length > 0) {
    nodes.push({ id: "memory:standing", label: "长期记忆", documents: standing });
  }
  for (const topic of input.topics ?? []) {
    const key = topic.key.trim();
    if (!isMasteredTopicMemoryKey(key)) {
      continue;
    }
    const title = markdownHeadings(topic.markdown, 1)[0];
    const documents = markdownHeadings(topic.markdown, 2).slice(0, 4);
    const fallback = key.split("/").pop()?.replace(/\.md$/i, "") ?? key;
    nodes.push({
      id: key,
      label: title || fallback,
      documents,
    });
  }
  const claims = new Map<string, { label: string; documents: string[] }>();
  for (const atom of input.atoms ?? []) {
    const summary = atom.summary.trim();
    if (!summary || SECRET_TEXT.test(summary)) {
      continue;
    }
    const type = (atom.atomType ?? "").trim().toLowerCase();
    const label = CLAIM_LABELS[type] ?? "判断";
    const bucket = claims.get(label) ?? { label, documents: [] };
    if (bucket.documents.length < 5 && !bucket.documents.includes(summary)) {
      bucket.documents.push(summary.slice(0, 80));
    }
    claims.set(label, bucket);
  }
  for (const bucket of claims.values()) {
    if (bucket.documents.length === 0) {
      continue;
    }
    nodes.push({
      id: `claim:${bucket.label}`,
      label: bucket.label,
      documents: bucket.documents,
    });
  }
  return nodes;
}

function emptyAtlas(agentId: string, loading: boolean): RobotCapabilityAtlas {
  return {
    agentId,
    loading,
    loaded: false,
    error: null,
    capabilities: [],
    knowledge: [],
    outputs: [],
  };
}

export function peekRobotCapabilityAtlas(agentId: string): RobotCapabilityAtlas | null {
  return atlases.get(agentId) ?? null;
}

export function resetRobotCapabilityAtlasForTests(): void {
  atlases.clear();
  inflight.clear();
}

export async function ensureRobotCapabilityAtlas(
  host: { client: AtlasClient | null; connected: boolean },
  agentId: string,
  render: () => void,
): Promise<void> {
  const id = agentId.trim();
  if (!id) {
    return;
  }
  const current = atlases.get(id);
  if ((current?.loaded && !current.loading) || inflight.has(id)) {
    return;
  }
  if (!host.client || !host.connected) {
    atlases.set(id, {
      ...emptyAtlas(id, false),
      loaded: true,
      error: "未连接，暂时读不到能力与知识。",
    });
    queueMicrotask(render);
    return;
  }
  const client = host.client;
  atlases.set(id, { ...(current ?? emptyAtlas(id, true)), loading: true, error: null });
  queueMicrotask(render);
  const job = loadRobotCapabilityAtlas(client, id)
    .then((atlas) => {
      atlases.set(id, atlas);
    })
    .catch((error: unknown) => {
      atlases.set(id, {
        ...emptyAtlas(id, false),
        loaded: true,
        error: error instanceof Error ? error.message : "读取能力与知识失败。",
      });
    })
    .finally(() => {
      inflight.delete(id);
      render();
    });
  inflight.set(id, job);
  await job;
}

const ATLAS_RPC_TIMEOUT_MS = 5000;

function requestAtlasWithTimeout(
  client: AtlasClient,
  method: string,
  params?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`capability atlas rpc timeout: ${method}`));
    }, ATLAS_RPC_TIMEOUT_MS);
    client.request(method, params).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function loadRobotCapabilityAtlas(
  client: AtlasClient,
  agentId: string,
): Promise<RobotCapabilityAtlas> {
  const [
    statusResult,
    skillsResult,
    knowledgeResult,
    personalResult,
    patternResult,
    memoryResult,
    standingResult,
  ] = await Promise.allSettled([
    requestAtlasWithTimeout(client, "skills.status", { agentId }),
    requestAtlasWithTimeout(client, "robot-skills.list", { agentId }),
    requestAtlasWithTimeout(client, "knowledge.base.list", {}),
    requestAtlasWithTimeout(client, "personal-skills.list", {}),
    requestAtlasWithTimeout(client, "pattern-detection.list-candidates", { agentId }),
    requestAtlasWithTimeout(client, "data.memory.list", { agentId, statusView: "active" }),
    requestAtlasWithTimeout(client, "agents.files.get", { agentId, name: "MEMORY.md" }),
  ]);
  const statusPayload = statusResult.status === "fulfilled" ? asRecord(statusResult.value) : null;
  const runtimeSkills = Array.isArray(statusPayload?.skills) ? statusPayload.skills : [];
  const runtime = capabilityNodesFromRuntimeSkills(runtimeSkills);
  const skillsPayload = skillsResult.status === "fulfilled" ? asRecord(skillsResult.value) : null;
  const skills = Array.isArray(skillsPayload?.skills) ? skillsPayload.skills : [];
  const namedUses = Array.isArray(skillsPayload?.namedSkillUses)
    ? skillsPayload.namedSkillUses
    : [];
  const used = capabilityNodesFromNamedUses(namedUses, runtimeSkills);
  const partitioned = partitionRobotSkills(skills);
  const included = new Set([...runtime, ...used].flatMap((cap) => [cap.id, cap.name]));
  const installed = partitioned.capabilities.filter(
    (cap) => !included.has(cap.id) && !included.has(cap.name),
  );
  for (const cap of installed) {
    included.add(cap.id);
    included.add(cap.name);
  }
  const personalPayload =
    personalResult.status === "fulfilled" ? asRecord(personalResult.value) : null;
  const personalSkills = Array.isArray(personalPayload?.skills) ? personalPayload.skills : [];
  const patternPayload =
    patternResult.status === "fulfilled" ? asRecord(patternResult.value) : null;
  const candidates = Array.isArray(patternPayload?.candidates) ? patternPayload.candidates : [];
  const evolved = capabilityNodesFromEvolution({
    agentId,
    personalSkills,
    candidates,
    alreadyIncludedIds: included,
  });
  const capabilities = collapseCapabilities([...used, ...runtime, ...installed, ...evolved]);
  const knowledgePayload =
    knowledgeResult.status === "fulfilled" ? asRecord(knowledgeResult.value) : null;
  const bases = Array.isArray(knowledgePayload?.knowledgeBases)
    ? knowledgePayload.knowledgeBases
    : [];
  const bound: RobotKnowledgeNode[] = [];
  for (const entry of bases) {
    const base = asRecord(entry);
    const knowledgeBaseId = asString(base?.id);
    const robotIds = Array.isArray(base?.robotIds)
      ? base.robotIds.map((item) => asString(item))
      : [];
    if (!knowledgeBaseId || !robotIds.includes(agentId)) {
      continue;
    }
    const documents: string[] = [];
    try {
      const listed = asRecord(
        await client.request("knowledge.base.documents.list", { knowledgeBaseId }),
      );
      const rows = Array.isArray(listed?.documents) ? listed.documents : [];
      for (const documentEntry of rows.slice(0, 6)) {
        const document = asRecord(documentEntry);
        const title = asString(document?.title) || asString(document?.docId);
        if (title) {
          documents.push(title);
        }
      }
    } catch {
      // The base itself is still a knowledge node.
    }
    bound.push({
      id: knowledgeBaseId,
      label: asString(base?.title) || knowledgeBaseId,
      documents,
    });
    if (bound.length >= 4) {
      break;
    }
  }
  const memoryPayload = memoryResult.status === "fulfilled" ? asRecord(memoryResult.value) : null;
  const memoryEntries = (Array.isArray(memoryPayload?.entries) ? memoryPayload.entries : [])
    .map((entry) => {
      const row = asRecord(entry);
      return {
        key: asString(row?.key),
        updatedAtMs: typeof row?.updatedAtMs === "number" ? row.updatedAtMs : 0,
      };
    })
    .filter((entry) => entry.key);
  const topicKeys = selectMasteredTopicKeys(memoryEntries);
  const topicFiles = await Promise.all(
    topicKeys.map(async (key) => {
      try {
        const payload = asRecord(await client.request("agents.files.get", { agentId, name: key }));
        const file = asRecord(payload?.file);
        return { key, markdown: asString(file?.content) };
      } catch {
        return { key, markdown: "" };
      }
    }),
  );
  const standingPayload =
    standingResult.status === "fulfilled" ? asRecord(standingResult.value) : null;
  const standingFile = asRecord(standingPayload?.file);
  const atoms = (Array.isArray(memoryPayload?.atoms) ? memoryPayload.atoms : [])
    .map((entry) => {
      const row = asRecord(entry);
      return {
        id: asString(row?.id),
        summary: asString(row?.summary),
        atomType: asString(row?.atomType),
      };
    })
    .filter((atom) => atom.id && atom.summary);
  const mastered = knowledgeNodesFromMastery({
    standingMarkdown: asString(standingFile?.content),
    topics: topicFiles,
    atoms,
  });
  const knowledge = [
    ...mastered,
    ...bound.filter((node) => !mastered.some((item) => item.id === node.id)),
    ...partitioned.knowledge.filter(
      (node) =>
        !bound.some((item) => item.id === node.id) && !mastered.some((item) => item.id === node.id),
    ),
  ];
  const failed =
    statusResult.status === "rejected" &&
    skillsResult.status === "rejected" &&
    knowledgeResult.status === "rejected" &&
    personalResult.status === "rejected" &&
    patternResult.status === "rejected" &&
    memoryResult.status === "rejected" &&
    standingResult.status === "rejected";
  return {
    agentId,
    loading: false,
    loaded: true,
    error: failed ? "读取能力与知识失败。" : null,
    capabilities,
    knowledge,
    outputs: partitioned.outputs,
  };
}
