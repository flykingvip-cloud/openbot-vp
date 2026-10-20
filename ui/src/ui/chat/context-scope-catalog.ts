import {
  parseContextScopeCatalog,
  type ChatContextSourceCatalogItem,
  type ChatContextVisibility,
} from "./context-scope.ts";

const SOURCE_LIMITS = {
  knowledge: 50,
  files: 80,
  folders: 40,
  apis: 40,
} as const;

const API_KINDS = new Set(["api", "external", "capability"]);
const FOLDER_KINDS = new Set(["localFolder", "gitRepo", "cloudDrive", "mailAttachment"]);
const VISIBILITIES = new Set(["private", "team", "enterprise"]);

type GatewayRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readVisibility(value: unknown): ChatContextVisibility | undefined {
  return typeof value === "string" && VISIBILITIES.has(value)
    ? (value as ChatContextVisibility)
    : undefined;
}

export function parseKnowledgeBaseListCatalog(raw: unknown): ChatContextSourceCatalogItem[] {
  const record = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.knowledgeBases)
      ? record.knowledgeBases
      : [];
  const items: ChatContextSourceCatalogItem[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const id = readString(item, "id", "knowledgeBaseId");
    const label = readString(item, "title", "label");
    if (!id || !label) {
      continue;
    }
    const visibility = readVisibility(item.visibility);
    const hasConflict =
      item.hasConflict === true ||
      item.governanceStatus === "conflict" ||
      (typeof item.conflictCount === "number" && item.conflictCount > 0);
    items.push({
      type: "knowledge",
      id,
      label,
      ...(visibility ? { visibility } : {}),
      ...(hasConflict ? { hasConflict: true } : {}),
    });
    if (items.length >= SOURCE_LIMITS.knowledge) {
      break;
    }
  }
  return items;
}

export function parseKnowledgeBaseSourcesCatalog(
  parent: Pick<ChatContextSourceCatalogItem, "id" | "visibility">,
  raw: unknown,
): ChatContextSourceCatalogItem[] {
  const record = asRecord(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(record?.sources) ? record.sources : [];
  const items: ChatContextSourceCatalogItem[] = [];
  let files = 0;
  let folders = 0;
  let apis = 0;
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const kind = readString(item, "kind");
    const id = readString(item, "documentId", "id", "sourceDescriptorId");
    const label = readString(item, "title", "label");
    if (!id || !label) {
      continue;
    }
    const visibility = readVisibility(item.visibility) ?? parent.visibility;
    if (API_KINDS.has(kind)) {
      if (apis >= SOURCE_LIMITS.apis) {
        continue;
      }
      apis += 1;
      items.push({
        type: "api",
        id,
        label,
        parentId: parent.id,
        ...(visibility ? { visibility } : {}),
        ...(readString(item, "formatLabel") ? { subtitle: readString(item, "formatLabel") } : {}),
      });
      continue;
    }
    if (FOLDER_KINDS.has(kind)) {
      if (folders >= SOURCE_LIMITS.folders) {
        continue;
      }
      folders += 1;
      items.push({
        type: "folder",
        id,
        label,
        parentId: parent.id,
        ...(visibility ? { visibility } : {}),
      });
      continue;
    }
    if (files >= SOURCE_LIMITS.files) {
      continue;
    }
    files += 1;
    items.push({
      type: "file",
      id,
      label,
      parentId: parent.id,
      ...(visibility ? { visibility } : {}),
    });
  }
  return items;
}

async function loadAuthorizedKnowledgeCatalog(
  request: GatewayRequest,
): Promise<ChatContextSourceCatalogItem[]> {
  const listed = await request("knowledge.base.list", {});
  const bases = parseKnowledgeBaseListCatalog(listed);
  if (bases.length === 0) {
    return bases;
  }
  const nested = await Promise.all(
    bases.map(async (base) => {
      try {
        const sources = await request("knowledge.base.sources.list", {
          knowledgeBaseId: base.id,
        });
        return parseKnowledgeBaseSourcesCatalog(base, sources);
      } catch {
        return [];
      }
    }),
  );
  return [...bases, ...nested.flat()];
}

export async function loadChatContextSourceCatalog(
  request: GatewayRequest,
): Promise<ChatContextSourceCatalogItem[]> {
  try {
    const result = await request("context.scope.sources.catalog", {});
    const record = asRecord(result);
    const parsed = parseContextScopeCatalog(record?.sources ?? result);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Older gateways do not expose the catalog RPC; fall back to knowledge bases.
  }
  try {
    return await loadAuthorizedKnowledgeCatalog(request);
  } catch {
    return [];
  }
}
