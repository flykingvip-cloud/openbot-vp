/**
 * Robot data tab file surface.
 * Reads workspace files, memory files, and bound knowledge documents through
 * gateway methods the running server already exposes, then opens one item inline.
 */

export type RobotDataFileLink = {
  name: string;
  label: string;
  bytes: number;
};

export type RobotDataKnowledgeLink = {
  knowledgeBaseId: string;
  documentId: string;
  title: string;
  baseTitle: string;
};

export type RobotDataAtomLink = {
  id: string;
  text: string;
};

export type RobotDataOpenState = {
  title: string;
  text: string;
  editSummary?: (fieldsJson: string) => Promise<void>;
  summaryFieldsJson?: string;
};

export type RobotDataSurface = {
  agentId: string;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  workspace: string | null;
  workspaceFiles: RobotDataFileLink[];
  memoryFiles: RobotDataFileLink[];
  atoms: RobotDataAtomLink[];
  knowledge: RobotDataKnowledgeLink[];
  open: RobotDataOpenState | null;
};

export type RobotDataOpenItem =
  | { kind: "file"; agentId: string; name: string; label: string }
  | { kind: "atom"; agentId: string; id: string; text: string }
  | {
      kind: "knowledge";
      agentId: string;
      knowledgeBaseId: string;
      documentId: string;
      title: string;
    };

type DataClient = {
  request: (method: string, params?: unknown) => Promise<unknown>;
};

const surfaces = new Map<string, RobotDataSurface>();
const inflight = new Map<string, Promise<void>>();
const fileText = new Map<string, string>();

const MEMORY_PROBE_NAMES = ["memory/task_ledger.json", "memory/artifact_ledger.json"] as const;

function emptySurface(agentId: string, loading: boolean): RobotDataSurface {
  return {
    agentId,
    loading,
    loaded: false,
    error: null,
    workspace: null,
    workspaceFiles: [],
    memoryFiles: [],
    atoms: [],
    knowledge: [],
    open: null,
  };
}

export function peekRobotDataSurface(agentId: string): RobotDataSurface | null {
  return surfaces.get(agentId) ?? null;
}

export function resetRobotDataSurfaceForTests(): void {
  surfaces.clear();
  inflight.clear();
  fileText.clear();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fileCacheKey(agentId: string, name: string): string {
  return `${agentId}\0${name}`;
}

function isMemoryName(name: string): boolean {
  const key = name.trim().replace(/^\/+/, "").toLowerCase();
  return key === "memory.md" || key.startsWith("memory/");
}

function decodePreviewText(payload: Record<string, unknown>): string {
  const text = asString(payload.text);
  if (text) {
    return text;
  }
  const base64 = asString(payload.base64);
  if (!base64 || payload.textLike === false) {
    return "";
  }
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 8000) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8000)}\n…`;
}

async function readWorkspaceFile(
  client: DataClient,
  agentId: string,
  name: string,
): Promise<{ name: string; bytes: number; text: string } | null> {
  try {
    const raw = asRecord(await client.request("agents.files.get", { agentId, name }));
    const file = asRecord(raw?.file);
    if (!file || file.missing === true) {
      return null;
    }
    const resolvedName = asString(file.name) || name;
    const text = typeof file.content === "string" ? file.content : "";
    const bytes = typeof file.size === "number" ? file.size : text.length;
    fileText.set(fileCacheKey(agentId, resolvedName), text);
    return { name: resolvedName, bytes, text };
  } catch {
    return null;
  }
}

export async function ensureRobotDataSurface(
  host: { client: DataClient | null; connected: boolean },
  agentId: string,
  render: () => void,
): Promise<void> {
  const id = agentId.trim();
  if (!id) {
    return;
  }
  const current = surfaces.get(id);
  if ((current?.loaded && !current.loading) || inflight.has(id)) {
    return;
  }
  if (!host.client || !host.connected) {
    surfaces.set(id, {
      ...emptySurface(id, false),
      loaded: true,
      error: "未连接，暂时读不到文件。",
    });
    render();
    return;
  }
  const client = host.client;
  surfaces.set(id, { ...(current ?? emptySurface(id, true)), loading: true, error: null });
  render();
  const job = loadRobotDataSurface(client, id)
    .then((surface) => {
      surfaces.set(id, surface);
    })
    .catch((error: unknown) => {
      surfaces.set(id, {
        ...emptySurface(id, false),
        loaded: true,
        error: error instanceof Error ? error.message : "读取机器人数据失败。",
      });
    })
    .finally(() => {
      inflight.delete(id);
      render();
    });
  inflight.set(id, job);
  await job;
}

async function loadRobotDataSurface(
  client: DataClient,
  agentId: string,
): Promise<RobotDataSurface> {
  const [filesResult, memoryResult, knowledgeResult] = await Promise.allSettled([
    client.request("agents.files.list", { agentId }),
    client.request("data.memory.list", { agentId, statusView: "active" }),
    client.request("knowledge.base.list", {}),
  ]);

  const filesPayload = filesResult.status === "fulfilled" ? asRecord(filesResult.value) : null;
  const listedFiles = Array.isArray(filesPayload?.files) ? filesPayload.files : [];
  const workspace = asString(filesPayload?.workspace) || null;
  const presentFiles: RobotDataFileLink[] = [];
  for (const entry of listedFiles) {
    const file = asRecord(entry);
    if (!file || file.missing === true) {
      continue;
    }
    const name = asString(file.name);
    if (!name) {
      continue;
    }
    presentFiles.push({
      name,
      label: name,
      bytes: typeof file.size === "number" ? file.size : 0,
    });
  }

  const memoryPayload = memoryResult.status === "fulfilled" ? asRecord(memoryResult.value) : null;
  const memoryFiles = new Map<string, RobotDataFileLink>();
  for (const entry of Array.isArray(memoryPayload?.entries) ? memoryPayload.entries : []) {
    const row = asRecord(entry);
    const name = asString(row?.key);
    if (!name) {
      continue;
    }
    memoryFiles.set(name, {
      name,
      label: asString(row?.label) || name,
      bytes: typeof row?.bytes === "number" ? row.bytes : 0,
    });
  }
  for (const file of presentFiles) {
    if (isMemoryName(file.name)) {
      memoryFiles.set(file.name, file);
    }
  }
  for (const name of MEMORY_PROBE_NAMES) {
    if (memoryFiles.has(name)) {
      continue;
    }
    const probed = await readWorkspaceFile(client, agentId, name);
    if (probed) {
      memoryFiles.set(probed.name, { name: probed.name, label: probed.name, bytes: probed.bytes });
    }
  }

  const atoms: RobotDataAtomLink[] = [];
  for (const entry of Array.isArray(memoryPayload?.atoms) ? memoryPayload.atoms : []) {
    const row = asRecord(entry);
    const id = asString(row?.id);
    const text = asString(row?.summary);
    if (!id || !text) {
      continue;
    }
    atoms.push({ id, text });
  }

  const knowledgePayload =
    knowledgeResult.status === "fulfilled" ? asRecord(knowledgeResult.value) : null;
  const bases = Array.isArray(knowledgePayload?.knowledgeBases)
    ? knowledgePayload.knowledgeBases
    : [];
  const knowledge: RobotDataKnowledgeLink[] = [];
  for (const entry of bases) {
    const base = asRecord(entry);
    const knowledgeBaseId = asString(base?.id);
    const robotIds = Array.isArray(base?.robotIds)
      ? base.robotIds.map((item) => asString(item))
      : [];
    if (!knowledgeBaseId || !robotIds.includes(agentId)) {
      continue;
    }
    const baseTitle = asString(base?.title) || knowledgeBaseId;
    try {
      const listed = asRecord(
        await client.request("knowledge.base.documents.list", { knowledgeBaseId }),
      );
      const documents = Array.isArray(listed?.documents) ? listed.documents : [];
      for (const documentEntry of documents.slice(0, 20)) {
        const document = asRecord(documentEntry);
        const documentId = asString(document?.docId);
        if (!documentId) {
          continue;
        }
        knowledge.push({
          knowledgeBaseId,
          documentId,
          title: asString(document?.title) || documentId,
          baseTitle,
        });
      }
    } catch {
      // A base with no readable documents stays out of the link list.
    }
  }

  const memoryNames = new Set(memoryFiles.keys());
  const failed =
    filesResult.status === "rejected" &&
    memoryResult.status === "rejected" &&
    knowledgeResult.status === "rejected";
  return {
    agentId,
    loading: false,
    loaded: true,
    error: failed ? "读取机器人数据失败。" : null,
    workspace,
    workspaceFiles: presentFiles.filter((file) => !memoryNames.has(file.name)),
    memoryFiles: [...memoryFiles.values()],
    atoms,
    knowledge,
    open: null,
  };
}

export async function openRobotDataItem(
  host: { client: DataClient | null; connected: boolean },
  item: RobotDataOpenItem,
  render: () => void,
): Promise<void> {
  const surface = surfaces.get(item.agentId);
  if (!surface) {
    return;
  }
  if (item.kind === "atom") {
    surface.open = { title: "记忆", text: item.text };
    render();
    return;
  }
  if (!host.client || !host.connected) {
    surface.open = {
      title: item.kind === "file" ? item.label : item.title,
      text: "未连接，暂时打不开。",
    };
    render();
    return;
  }
  if (item.kind === "file") {
    const cached = fileText.get(fileCacheKey(item.agentId, item.name));
    if (cached !== undefined) {
      surface.open = { title: item.label, text: clip(cached) || "文件是空的。" };
      render();
      return;
    }
    const file = await readWorkspaceFile(host.client, item.agentId, item.name);
    surface.open = {
      title: item.label,
      text: file ? clip(file.text) || "文件是空的。" : "这个文件暂时打不开。",
    };
    render();
    return;
  }
  try {
    const raw = asRecord(
      await host.client.request("knowledge.document.preview", {
        knowledgeBaseId: item.knowledgeBaseId,
        documentId: item.documentId,
      }),
    );
    const text = raw ? decodePreviewText(raw) : "";
    const summaryResponse = asRecord(
      await host.client
        .request("knowledge.document.summary", {
          knowledgeBaseId: item.knowledgeBaseId,
          documentId: item.documentId,
        })
        .catch(() => ({ summary: null })),
    );
    const summary = asRecord(summaryResponse?.summary);
    const summaryFields = asRecord(summary?.fields);
    const summaryText = typeof summaryFields?.purpose === "string" ? summaryFields.purpose : "";
    const rawStatus = typeof summary?.state === "string" ? summary.state : "pending";
    const status =
      (
        {
          pending: "待手工维护",
          processing: "待手工维护",
          ready: "可用",
          failed: "待手工维护",
          stale: "原文已更新，待复核",
        } as Record<string, string>
      )[rawStatus] ?? "待手工维护";
    surface.open = {
      title: item.title,
      summaryFieldsJson: JSON.stringify(
        summaryFields ?? { purpose: "", keyPoints: [], coverage: [], entities: [], boundaries: [] },
        null,
        2,
      ),
      editSummary: async (fieldsJson) => {
        const fields: unknown = JSON.parse(fieldsJson);
        await host.client!.request("knowledge.document.summary", {
          knowledgeBaseId: item.knowledgeBaseId,
          documentId: item.documentId,
          fields,
        });
        await openRobotDataItem(host, item, render);
      },
      text: `检索摘要来源：${summary?.method === "human" ? "人工维护" : summary?.method === "model" ? "历史模型摘要（不代表人工审核）" : "未填写"}；源版本：${typeof summary?.sourceVersionId === "string" ? summary.sourceVersionId : "未知"}\n检索摘要状态：${status}${typeof summary?.failureCode === "string" ? "（请核对原文后手工维护摘要）" : ""}\n${summaryText}\n\n${clip(text) || "这份知识暂时没有可阅读的正文。"}`,
    };
  } catch {
    surface.open = { title: item.title, text: "这份知识暂时打不开。" };
  }
  render();
}
