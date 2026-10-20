export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

export type CoreToolSection = {
  id: string;
  label: string;
  tools: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

type CoreToolDefinition = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  profiles: ToolProfileId[];
  includeInOpenClawGroup?: boolean;
};

const CORE_TOOL_SECTION_ORDER: Array<{ id: string; label: string }> = [
  { id: "fs", label: "Files" },
  { id: "runtime", label: "Runtime" },
  { id: "web", label: "Web" },
  { id: "memory", label: "Memory" },
  { id: "knowledge", label: "Knowledge" },
  { id: "sessions", label: "Sessions" },
  { id: "ui", label: "UI" },
  { id: "messaging", label: "Messaging" },
  { id: "automation", label: "Automation" },
  { id: "nodes", label: "Nodes" },
  { id: "agents", label: "Agents" },
  { id: "media", label: "Media" },
];

const CORE_TOOL_DEFINITIONS: CoreToolDefinition[] = [
  {
    id: "read",
    label: "read",
    description: "Read file contents",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "write",
    label: "write",
    description: "Create or overwrite files",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "edit",
    label: "edit",
    description: "Make precise edits",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "apply_patch",
    label: "apply_patch",
    description: "Patch files (OpenAI)",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "exec",
    label: "exec",
    description: "Run shell commands",
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "user_operational_identity",
    label: "user_operational_identity",
    description:
      "Use a personal operational identity already granted to this agent (personal email send/reply, WeChat official). Missing grants are reported by the tool.",
    sectionId: "agents",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "process",
    label: "process",
    description: "Manage background processes",
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "web_search",
    label: "web_search",
    description: "Search the web",
    sectionId: "web",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "web_fetch",
    label: "web_fetch",
    description: "Fetch web content",
    sectionId: "web",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "site_list",
    label: "site_list",
    description: "List authorized site capability summaries",
    sectionId: "web",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "site_describe",
    label: "site_describe",
    description: "Describe one authorized site capability",
    sectionId: "web",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "site_invoke",
    label: "site_invoke",
    description: "Invoke one fixed version of an authorized site capability",
    sectionId: "web",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "memory_search",
    label: "memory_search",
    description: "Semantic search",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "memory_get",
    label: "memory_get",
    description: "Read memory files",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "knowledge_search",
    label: "knowledge_search",
    description: "Search ingested Knowledge Universe documents",
    sectionId: "knowledge",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "knowledge_get",
    label: "knowledge_get",
    description: "Read ingested Knowledge Universe document chunks",
    sectionId: "knowledge",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_list",
    label: "sessions_list",
    description: "List sessions",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_history",
    label: "sessions_history",
    description: "Session history",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_send",
    label: "sessions_send",
    description: "Send to session",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_spawn",
    label: "sessions_spawn",
    description: "Spawn sub-agent",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "subagents",
    label: "subagents",
    description: "Manage sub-agents",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "session_status",
    label: "session_status",
    description: "Session status",
    sectionId: "sessions",
    profiles: ["minimal", "coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "browser",
    label: "browser",
    description: "Control web browser",
    sectionId: "ui",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "canvas",
    label: "canvas",
    description: "Control canvases",
    sectionId: "ui",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "message",
    label: "message",
    description: "Send messages",
    sectionId: "messaging",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "cron",
    label: "cron",
    description: "Schedule tasks",
    sectionId: "automation",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "scheduled_task",
    label: "scheduled_task",
    description: "Create a system scheduled task for the signed-in owner",
    sectionId: "automation",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "gateway",
    label: "gateway",
    description: "Gateway control",
    sectionId: "automation",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "nodes",
    label: "nodes",
    description: "Nodes + devices",
    sectionId: "nodes",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "agents_list",
    label: "agents_list",
    description: "List agents",
    sectionId: "agents",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "organization_tasks",
    label: "organization_tasks",
    description: "Manage organization tasks",
    sectionId: "agents",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "collaboration_board",
    label: "collaboration_board",
    description:
      "Executor shared-board progress: propose todolist, mark in progress, submit for review (claim-contract gray groups)",
    sectionId: "agents",
    // coding + messaging: gray executors often inherit coding profile; messaging-only
    // would be ACL-stripped even after createOpenClawTools injects the tool.
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "schedule",
    label: "schedule",
    description: "Manage the signed-in user's schedule (steward)",
    sectionId: "agents",
    // Not in default profiles — granted to builtin steward via tools.alsoAllow.
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "skill_asset_save",
    label: "skill_asset_save",
    description:
      "Submit a workspace skill into 我的资产 (personal assets) for curation and enterprise reuse",
    sectionId: "agents",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "meeting",
    label: "meeting",
    description: "Convene and manage meetings for the signed-in user (steward)",
    sectionId: "agents",
    // Not in default profiles — granted to builtin steward via tools.alsoAllow.
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "knowledge_source",
    label: "knowledge_source",
    description:
      "Configure and verify API-backed active knowledge sources (steward). Not for ingested document body.",
    sectionId: "agents",
    // Not in default profiles — granted to builtin steward via tools.alsoAllow.
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "organization_memory",
    label: "organization_memory",
    description: "Manage organization memory",
    sectionId: "agents",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "data_capability",
    label: "data_capability",
    description: "List or invoke governed enterprise data capabilities for the signed-in seat",
    sectionId: "agents",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "diagnose",
    label: "diagnose",
    description:
      "READ_ONLY diagnose of a digital human or collaboration group; returns a redacted report",
    sectionId: "agents",
    // Not in default profiles — granted to builtin steward via tools.alsoAllow.
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "conversation_send",
    label: "conversation_send",
    description:
      "1:1 send to a registered digital human from the same tenant registry as agents_list",
    sectionId: "agents",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tenant_user_notify",
    label: "tenant_user_notify",
    description: "Directed notice to one real person in the same tenant workbench",
    sectionId: "agents",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "confirm_diagnose_prescription",
    label: "confirm_diagnose_prescription",
    description: "Confirm a stored diagnose prescription. Does not submit evolution candidates.",
    sectionId: "agents",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "confirm_diagnose_evolution",
    label: "confirm_diagnose_evolution",
    description: "Compatibility alias for confirm_diagnose_prescription",
    sectionId: "agents",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "evolution_perception",
    label: "evolution_perception",
    description:
      "READ_ONLY evolution timeline, weekly digest, and Da Bai intent query. Does not write Ledger or Apply.",
    sectionId: "agents",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "image",
    label: "image",
    description: "Image understanding",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tts",
    label: "tts",
    description: "Text-to-speech conversion",
    sectionId: "media",
    profiles: [],
    includeInOpenClawGroup: true,
  },
];

const CORE_TOOL_BY_ID = new Map<string, CoreToolDefinition>(
  CORE_TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);

function listCoreToolIdsForProfile(profile: ToolProfileId): string[] {
  return CORE_TOOL_DEFINITIONS.filter((tool) => tool.profiles.includes(profile)).map(
    (tool) => tool.id,
  );
}

const CORE_TOOL_PROFILES: Record<ToolProfileId, ToolProfilePolicy> = {
  minimal: {
    allow: listCoreToolIdsForProfile("minimal"),
  },
  coding: {
    allow: listCoreToolIdsForProfile("coding"),
  },
  messaging: {
    allow: listCoreToolIdsForProfile("messaging"),
  },
  full: {},
};

function buildCoreToolGroupMap() {
  const sectionToolMap = new Map<string, string[]>();
  for (const tool of CORE_TOOL_DEFINITIONS) {
    const groupId = `group:${tool.sectionId}`;
    const list = sectionToolMap.get(groupId) ?? [];
    list.push(tool.id);
    sectionToolMap.set(groupId, list);
  }
  const openclawTools = CORE_TOOL_DEFINITIONS.filter((tool) => tool.includeInOpenClawGroup).map(
    (tool) => tool.id,
  );
  return {
    "group:openclaw": openclawTools,
    ...Object.fromEntries(sectionToolMap.entries()),
  };
}

export const CORE_TOOL_GROUPS = buildCoreToolGroupMap();

export const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

export function resolveCoreToolProfilePolicy(profile?: string): ToolProfilePolicy | undefined {
  if (!profile) {
    return undefined;
  }
  const resolved = CORE_TOOL_PROFILES[profile as ToolProfileId];
  if (!resolved) {
    return undefined;
  }
  if (!resolved.allow && !resolved.deny) {
    return undefined;
  }
  return {
    allow: resolved.allow ? [...resolved.allow] : undefined,
    deny: resolved.deny ? [...resolved.deny] : undefined,
  };
}

export function listCoreToolSections(): CoreToolSection[] {
  return CORE_TOOL_SECTION_ORDER.map((section) => ({
    id: section.id,
    label: section.label,
    tools: CORE_TOOL_DEFINITIONS.filter((tool) => tool.sectionId === section.id).map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
    })),
  })).filter((section) => section.tools.length > 0);
}

export function resolveCoreToolProfiles(toolId: string): ToolProfileId[] {
  const tool = CORE_TOOL_BY_ID.get(toolId);
  if (!tool) {
    return [];
  }
  return [...tool.profiles];
}

export function isKnownCoreToolId(toolId: string): boolean {
  return CORE_TOOL_BY_ID.has(toolId);
}

export type CoreToolMode = "read" | "write";
export type CoreToolSideEffectLevel = "none" | "reversible" | "irreversible_external";

export type CoreToolCapability = {
  toolMode: CoreToolMode;
  sideEffectLevel: CoreToolSideEffectLevel;
};

/**
 * Audited capability table for inbound retrieve allowlisting.
 * Missing entries are unknown and fail closed under retrieve.
 */
const CORE_TOOL_CAPABILITIES: Record<string, CoreToolCapability> = {
  read: { toolMode: "read", sideEffectLevel: "none" },
  memory_search: { toolMode: "read", sideEffectLevel: "none" },
  memory_get: { toolMode: "read", sideEffectLevel: "none" },
  knowledge_search: { toolMode: "read", sideEffectLevel: "none" },
  knowledge_get: { toolMode: "read", sideEffectLevel: "none" },
  sessions_list: { toolMode: "read", sideEffectLevel: "none" },
  sessions_history: { toolMode: "read", sideEffectLevel: "none" },
  agents_list: { toolMode: "read", sideEffectLevel: "none" },
  web_search: { toolMode: "read", sideEffectLevel: "none" },
  web_fetch: { toolMode: "read", sideEffectLevel: "none" },
  site_list: { toolMode: "read", sideEffectLevel: "none" },
  site_describe: { toolMode: "read", sideEffectLevel: "none" },
  site_invoke: { toolMode: "write", sideEffectLevel: "reversible" },
  image: { toolMode: "read", sideEffectLevel: "none" },
  write: { toolMode: "write", sideEffectLevel: "reversible" },
  edit: { toolMode: "write", sideEffectLevel: "reversible" },
  apply_patch: { toolMode: "write", sideEffectLevel: "reversible" },
  process: { toolMode: "write", sideEffectLevel: "reversible" },
  sessions_send: { toolMode: "write", sideEffectLevel: "reversible" },
  sessions_spawn: { toolMode: "write", sideEffectLevel: "reversible" },
  subagents: { toolMode: "write", sideEffectLevel: "reversible" },
  session_status: { toolMode: "write", sideEffectLevel: "reversible" },
  canvas: { toolMode: "write", sideEffectLevel: "reversible" },
  cron: { toolMode: "write", sideEffectLevel: "reversible" },
  organization_tasks: { toolMode: "write", sideEffectLevel: "reversible" },
  collaboration_board: { toolMode: "write", sideEffectLevel: "reversible" },
  schedule: { toolMode: "write", sideEffectLevel: "reversible" },
  meeting: { toolMode: "write", sideEffectLevel: "irreversible_external" },
  knowledge_source: { toolMode: "write", sideEffectLevel: "reversible" },
  organization_memory: { toolMode: "write", sideEffectLevel: "reversible" },
  data_capability: { toolMode: "write", sideEffectLevel: "reversible" },
  diagnose: { toolMode: "write", sideEffectLevel: "reversible" },
  evolution_perception: { toolMode: "read", sideEffectLevel: "none" },
  conversation_send: { toolMode: "write", sideEffectLevel: "reversible" },
  tenant_user_notify: { toolMode: "write", sideEffectLevel: "reversible" },
  confirm_diagnose_prescription: { toolMode: "write", sideEffectLevel: "reversible" },
  confirm_diagnose_evolution: { toolMode: "write", sideEffectLevel: "reversible" },
  tts: { toolMode: "write", sideEffectLevel: "reversible" },
  exec: { toolMode: "write", sideEffectLevel: "irreversible_external" },
  message: { toolMode: "write", sideEffectLevel: "irreversible_external" },
  gateway: { toolMode: "write", sideEffectLevel: "irreversible_external" },
  skill_asset_save: { toolMode: "write", sideEffectLevel: "reversible" },
  guidance_event: { toolMode: "write", sideEffectLevel: "reversible" },
  nodes: { toolMode: "write", sideEffectLevel: "irreversible_external" },
  browser: { toolMode: "write", sideEffectLevel: "irreversible_external" },
};

const CORE_TOOL_ID_ALIASES: Record<string, string> = {
  "knowledge-source-tool": "knowledge_source",
  confirm_diagnose_evolution: "confirm_diagnose_prescription",
};

export function resolveCoreToolCatalogId(toolId: string): string {
  const normalized = toolId.trim().toLowerCase();
  return CORE_TOOL_ID_ALIASES[normalized] ?? normalized;
}

export function resolveCoreToolCapability(toolId: string): CoreToolCapability | null {
  const catalogId = resolveCoreToolCatalogId(toolId);
  return CORE_TOOL_CAPABILITIES[catalogId] ?? null;
}

export function listRetrieveReadOnlyCoreToolIds(): string[] {
  return Object.entries(CORE_TOOL_CAPABILITIES)
    .filter(
      ([, capability]) => capability.toolMode === "read" && capability.sideEffectLevel === "none",
    )
    .map(([id]) => id)
    .toSorted();
}
