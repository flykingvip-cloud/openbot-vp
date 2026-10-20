/**
 * 大白管家引导卡片：写入网关聊天记录的安全投影。
 *
 * #792 把引导页留在对话区，但只缓存在本机 localStorage。这里的卡片走
 * `chat.guide.append` → 会话转写 → `chat.history`，换设备或清站点数据后仍能读回。
 * 投影只保留引导页本身，不携带 MCP / OI / OAuth / token。
 */

export const DAIBAI_GUIDE_CARD_VERSION = 1 as const;
export const DAIBAI_GUIDE_TRANSCRIPT_FIELD = "openclawDaibaiGuide" as const;

export const DAIBAI_GUIDE_WELCOME_TEXT = "我是大白管家，我来帮你创建专属你的数字员工团队。";
export const DAIBAI_GUIDE_RETAINED_TEXT =
  "这份引导会留在大白的对话里，你可以随时回看、预览，或继续从这里调整。";

const GUIDE_ROLES = ["产品经理", "销售", "研发", "运营", "人事", "财务", "客服", "市场"] as const;
const GUIDE_CATEGORIES = ["all", "office", "growth", "rd", "ops"] as const;
const GUIDE_PATHS = ["catalog", "describe", "custom"] as const;

const MAX_SELECTED = 8;
const MAX_LABEL = 40;
const MAX_TASK = 500;
const MAX_ID = 32;
const MAX_AGENT_ID = 80;

const SECRET_TEXT =
  /bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9]{8,}|api[_-]?key\s*[:=]\s*\S+|access[_-]?token\s*[:=]\s*\S+|refresh[_-]?token\s*[:=]\s*\S+|authorization\s*[:=]\s*\S+/i;

export type DaibaiGuideSlot = "welcome" | "team";
export type DaibaiGuideKind = "welcome" | "team" | "success";

export type DaibaiGuideCreatedMember = {
  catalogId: string;
  agentId: string;
  name: string;
};

export type DaibaiGuideCardState = {
  step: "page";
  path: (typeof GUIDE_PATHS)[number] | null;
  category: (typeof GUIDE_CATEGORIES)[number];
  selectedIds: string[];
  selectedLabels: string[];
  role: (typeof GUIDE_ROLES)[number] | null;
  taskText: string;
  proposedIds: string[];
  customNames: Array<{ id: string; name: string }>;
  created: DaibaiGuideCreatedMember[];
};

export type DaibaiGuideTranscriptCard = {
  v: typeof DAIBAI_GUIDE_CARD_VERSION;
  slot: DaibaiGuideSlot;
  kind: DaibaiGuideKind;
  updatedAt: number;
  state?: DaibaiGuideCardState;
};

export type DaibaiGuideAppendPlan = {
  text: string;
  card: DaibaiGuideTranscriptCard;
  idempotencyKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripControls(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    out += char;
  }
  return out;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = stripControls(value).trim().slice(0, max);
  if (!text || SECRET_TEXT.test(text)) {
    return "";
  }
  return text;
}

function cleanId(value: unknown): string {
  const text = cleanText(value, MAX_ID);
  return /^[a-z0-9_-]{1,32}$/.test(text) ? text : "";
}

function cleanAgentId(value: unknown): string {
  const text = cleanText(value, MAX_AGENT_ID);
  if (!text || /[:/?#\\\s]/.test(text)) {
    return "";
  }
  return /^[A-Za-z0-9_.@-]{1,80}$/.test(text) ? text : "";
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = cleanId(entry);
    if (!id || ids.includes(id)) {
      continue;
    }
    ids.push(id);
    if (ids.length >= MAX_SELECTED) {
      break;
    }
  }
  return ids;
}

function cleanLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const labels: string[] = [];
  for (const entry of value) {
    const label = cleanText(entry, MAX_LABEL);
    if (!label || labels.includes(label)) {
      continue;
    }
    labels.push(label);
    if (labels.length >= MAX_SELECTED) {
      break;
    }
  }
  return labels;
}

function cleanCustomNames(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: Array<{ id: string; name: string }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = cleanId(entry.id);
    const name = cleanText(entry.name, MAX_LABEL);
    if (!id || !name) {
      continue;
    }
    names.push({ id, name });
    if (names.length >= MAX_SELECTED) {
      break;
    }
  }
  return names;
}

function cleanCreated(value: unknown): DaibaiGuideCreatedMember[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const created: DaibaiGuideCreatedMember[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const catalogId = cleanId(entry.catalogId);
    const agentId = cleanAgentId(entry.agentId);
    const name = cleanText(entry.name, MAX_LABEL);
    if (!catalogId || !agentId || !name) {
      continue;
    }
    created.push({ catalogId, agentId, name });
    if (created.length >= MAX_SELECTED) {
      break;
    }
  }
  return created;
}

function cleanRole(value: unknown): DaibaiGuideCardState["role"] {
  const text = cleanText(value, 16);
  return GUIDE_ROLES.find((role) => role === text) ?? null;
}

function cleanCategory(value: unknown): DaibaiGuideCardState["category"] {
  const text = cleanText(value, 16);
  return GUIDE_CATEGORIES.find((category) => category === text) ?? "all";
}

function cleanPath(value: unknown): DaibaiGuideCardState["path"] {
  const text = cleanText(value, 16);
  return GUIDE_PATHS.find((path) => path === text) ?? null;
}

export function sanitizeDaibaiGuideState(value: unknown): DaibaiGuideCardState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.step !== "page") {
    return null;
  }
  return {
    step: "page",
    path: cleanPath(value.path),
    category: cleanCategory(value.category),
    selectedIds: uniqueIds(value.selectedIds),
    selectedLabels: cleanLabels(value.selectedLabels),
    role: cleanRole(value.role),
    taskText: cleanText(value.taskText, MAX_TASK),
    proposedIds: uniqueIds(value.proposedIds),
    customNames: cleanCustomNames(value.customNames),
    created: cleanCreated(value.created),
  };
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalState(state: DaibaiGuideCardState | undefined): string {
  if (!state) {
    return "";
  }
  return JSON.stringify(state);
}

export function daibaiGuideVisibleText(
  card: Pick<DaibaiGuideTranscriptCard, "slot" | "state">,
): string {
  if (card.slot === "welcome") {
    return DAIBAI_GUIDE_WELCOME_TEXT;
  }
  const created = card.state?.created.map((member) => member.name).filter(Boolean) ?? [];
  if (created.length > 0) {
    return `团队已就绪。大白管家已为你创建专属数字员工团队：${created.join("、")}。${DAIBAI_GUIDE_RETAINED_TEXT}`;
  }
  const selected = card.state?.selectedLabels.filter(Boolean) ?? [];
  const picking = selected.length > 0 ? `已选：${selected.join("、")}。` : "";
  return `组建数字员工团队。${picking}${DAIBAI_GUIDE_RETAINED_TEXT}`;
}

export function planDaibaiGuideAppend(input: {
  slot: DaibaiGuideSlot;
  state?: unknown;
  now?: number;
}): DaibaiGuideAppendPlan | null {
  const state = input.slot === "team" ? sanitizeDaibaiGuideState(input.state) : null;
  if (input.slot === "team" && !state) {
    return null;
  }
  const kind: DaibaiGuideKind =
    input.slot === "welcome" ? "welcome" : state && state.created.length > 0 ? "success" : "team";
  const card: DaibaiGuideTranscriptCard = {
    v: DAIBAI_GUIDE_CARD_VERSION,
    slot: input.slot,
    kind,
    updatedAt: input.now ?? 0,
    ...(state ? { state } : {}),
  };
  const idempotencyKey = `daibai-guide:${input.slot}:${stableHash(canonicalState(state ?? undefined))}`;
  return {
    text: daibaiGuideVisibleText(card),
    card,
    idempotencyKey,
  };
}

export function readDaibaiGuideCard(message: unknown): DaibaiGuideTranscriptCard | null {
  if (!isRecord(message)) {
    return null;
  }
  const raw = message[DAIBAI_GUIDE_TRANSCRIPT_FIELD];
  if (!isRecord(raw) || raw.v !== DAIBAI_GUIDE_CARD_VERSION) {
    return null;
  }
  if (raw.slot !== "welcome" && raw.slot !== "team") {
    return null;
  }
  const state = raw.slot === "team" ? sanitizeDaibaiGuideState(raw.state) : null;
  if (raw.slot === "team" && !state) {
    return null;
  }
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  const kind: DaibaiGuideKind =
    raw.slot === "welcome" ? "welcome" : state && state.created.length > 0 ? "success" : "team";
  return {
    v: DAIBAI_GUIDE_CARD_VERSION,
    slot: raw.slot,
    kind,
    updatedAt,
    ...(state ? { state } : {}),
  };
}

export function isDaibaiGuideTranscriptMessage(message: unknown): boolean {
  return readDaibaiGuideCard(message) !== null;
}

function messageTimestamp(message: unknown): number {
  if (!isRecord(message)) {
    return 0;
  }
  const timestamp = message.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
}

/** Latest retained card for a slot. History may contain older revisions. */
export function latestDaibaiGuideCard(
  messages: readonly unknown[],
  slot: DaibaiGuideSlot,
): DaibaiGuideTranscriptCard | null {
  let best: DaibaiGuideTranscriptCard | null = null;
  let bestAt = -1;
  for (const message of messages) {
    const card = readDaibaiGuideCard(message);
    if (!card || card.slot !== slot) {
      continue;
    }
    const at = Math.max(messageTimestamp(message), card.updatedAt);
    if (!best || at >= bestAt) {
      best = card;
      bestAt = at;
    }
  }
  return best;
}
