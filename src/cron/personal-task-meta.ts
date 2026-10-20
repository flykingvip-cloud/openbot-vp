export type CronDataBindingKind = "capability" | "knowledge" | "runtime_date";

export type CronDataBindingKnowledgeScope = "personal" | "enterprise";

export type CronDataBindingRef = {
  bindingId: string;
  kind: CronDataBindingKind;
  resourceId: string;
  label: string;
  accessState?: "granted" | "requestable" | "external";
  /** kind=knowledge 时区分个人/企业知识源；缺省为 personal（兼容旧数据） */
  knowledgeScope?: CronDataBindingKnowledgeScope;
};

const META_PREFIX = "\n<!--openbot-task-meta:";
const META_SUFFIX = "-->";

export function normalizeCronDataBindings(raw: unknown): CronDataBindingRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const bindings: CronDataBindingRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Partial<CronDataBindingRef>;
    const bindingId = typeof record.bindingId === "string" ? record.bindingId.trim() : "";
    const kind = record.kind;
    const resourceId = typeof record.resourceId === "string" ? record.resourceId.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!bindingId || !resourceId || !label) {
      continue;
    }
    if (kind !== "capability" && kind !== "knowledge" && kind !== "runtime_date") {
      continue;
    }
    if (seen.has(bindingId)) {
      continue;
    }
    seen.add(bindingId);
    bindings.push({
      bindingId,
      kind,
      resourceId,
      label,
      ...(record.accessState === "granted" ||
      record.accessState === "requestable" ||
      record.accessState === "external"
        ? { accessState: record.accessState }
        : {}),
      ...(record.knowledgeScope === "personal" || record.knowledgeScope === "enterprise"
        ? { knowledgeScope: record.knowledgeScope }
        : {}),
    });
  }
  return bindings;
}

function normalizeAcceptanceRules(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parsePersonalTaskMetaFromDescription(rawDescription?: string | null): {
  visibleDescription: string;
  dataBindings: CronDataBindingRef[];
  intentText: string;
  goal: string;
  acceptanceRules: string[];
} {
  const parsed = parsePersonalCronTaskMetaRecord(rawDescription);
  if (!parsed) {
    const raw = (rawDescription ?? "").trim();
    return {
      visibleDescription: raw,
      dataBindings: [],
      intentText: "",
      goal: "",
      acceptanceRules: [],
    };
  }
  return {
    visibleDescription: parsed.visibleDescription,
    dataBindings: parsed.dataBindings,
    intentText: parsed.intentText,
    goal: parsed.goal ?? "",
    acceptanceRules: parsed.acceptanceRules ?? [],
  };
}

export type PersonalCronTaskMetaRecord = {
  visibleDescription: string;
  dataBindings: CronDataBindingRef[];
  intentText: string;
  goal?: string;
  acceptanceRules?: string[];
  notify?: {
    inApp?: boolean;
    wecom?: boolean;
    dingtalk?: boolean;
    email?: boolean;
    webhook?: boolean;
  };
  selectedGroups?: string[];
};

export function parsePersonalCronTaskMetaRecord(
  rawDescription?: string | null,
): PersonalCronTaskMetaRecord | null {
  const raw = (rawDescription ?? "").trim();
  if (!raw) {
    return null;
  }
  const start = raw.lastIndexOf(META_PREFIX);
  if (start < 0) {
    return {
      visibleDescription: raw,
      dataBindings: [],
      intentText: "",
    };
  }
  const end = raw.indexOf(META_SUFFIX, start);
  if (end < 0) {
    return {
      visibleDescription: raw.slice(0, start).trim(),
      dataBindings: [],
      intentText: "",
    };
  }
  const encoded = raw.slice(start + META_PREFIX.length, end).trim();
  const visibleDescription = raw.slice(0, start).trim();
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as {
      dataBindings?: unknown;
      intentText?: unknown;
      goal?: unknown;
      acceptanceRules?: unknown;
      notify?: {
        inApp?: unknown;
        wecom?: unknown;
        dingtalk?: unknown;
        email?: unknown;
        webhook?: unknown;
      };
      selectedGroups?: unknown;
    };
    const notifyRaw =
      parsed.notify && typeof parsed.notify === "object" ? parsed.notify : undefined;
    const selectedGroups = Array.isArray(parsed.selectedGroups)
      ? parsed.selectedGroups
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : [];
    const inApp = notifyRaw && "inApp" in notifyRaw ? notifyRaw.inApp !== false : undefined;
    const notify = notifyRaw
      ? {
          ...(inApp !== undefined ? { inApp } : {}),
          ...(notifyRaw.wecom === true ? { wecom: true } : {}),
          ...(notifyRaw.dingtalk === true ? { dingtalk: true } : {}),
          ...(notifyRaw.email === true ? { email: true } : {}),
          ...(notifyRaw.webhook === true ? { webhook: true } : {}),
        }
      : undefined;
    const goal = typeof parsed.goal === "string" ? parsed.goal.trim() : "";
    const acceptanceRules = normalizeAcceptanceRules(parsed.acceptanceRules);
    return {
      visibleDescription,
      dataBindings: normalizeCronDataBindings(parsed.dataBindings),
      intentText: typeof parsed.intentText === "string" ? parsed.intentText.trim() : "",
      ...(goal ? { goal } : {}),
      ...(acceptanceRules.length > 0 ? { acceptanceRules } : {}),
      ...(notify && Object.keys(notify).length > 0 ? { notify } : {}),
      ...(selectedGroups.length > 0 ? { selectedGroups } : {}),
    };
  } catch {
    return {
      visibleDescription,
      dataBindings: [],
      intentText: "",
    };
  }
}

export function extractRequestedCapabilityIds(bindings: CronDataBindingRef[]): string[] {
  return [
    ...new Set(
      bindings
        .filter((item) => item.kind === "capability")
        .map((item) => item.resourceId.trim())
        .filter(Boolean),
    ),
  ];
}

export function extractRequestedKnowledgeObjectIds(bindings: CronDataBindingRef[]): string[] {
  return [
    ...new Set(
      bindings
        .filter((item) => item.kind === "knowledge")
        .map((item) => item.resourceId.trim())
        .filter(Boolean),
    ),
  ];
}

export function extractRequestedKnowledgeSourceHints(
  bindings: CronDataBindingRef[],
): Array<"personal" | "enterprise"> {
  const hints = new Set<"personal" | "enterprise">();
  for (const binding of bindings) {
    if (binding.kind !== "knowledge") {
      continue;
    }
    hints.add(binding.knowledgeScope === "enterprise" ? "enterprise" : "personal");
  }
  return [...hints];
}

export function extractBindingMarkersFromIntent(text: string): string[] {
  const matches = text.matchAll(/\{\{bind:([^}]+)\}\}/g);
  return [...new Set([...matches].map((match) => match[1]?.trim() ?? "").filter(Boolean))];
}

export function cronDataBindingMarker(bindingId: string): string {
  return `{{bind:${bindingId}}}`;
}

function bindingKindLabel(binding: CronDataBindingRef): string {
  if (binding.kind === "capability") {
    return "企业数据能力";
  }
  if (binding.kind === "knowledge") {
    return binding.knowledgeScope === "enterprise" ? "企业知识" : "个人知识";
  }
  return "运行时";
}

function bindingAccessLabel(binding: CronDataBindingRef): string {
  if (binding.kind === "runtime_date") {
    return "使用任务执行当日日期";
  }
  if (binding.accessState === "granted") {
    return "已授权，可直接调用";
  }
  if (binding.accessState === "requestable") {
    return "需申请授权后调用";
  }
  if (binding.accessState === "external") {
    return "外部数据源，按连接器策略访问";
  }
  return "按任务上下文解析";
}

export function buildCronDataBindingsPromptSection(
  bindings: CronDataBindingRef[],
): string | undefined {
  if (bindings.length === 0) {
    return undefined;
  }
  const lines = bindings.map((binding, index) => {
    const access = bindingAccessLabel(binding);
    return `${index + 1}. [${bindingKindLabel(binding)}] ${binding.label}（${binding.resourceId}）— ${access}`;
  });
  return [
    "## 数据依赖",
    "执行本任务前须通过已绑定数据源获取以下信息（不得编造；缺数据时在结果中说明）：",
    ...lines,
  ].join("\n");
}

export function expandCronDataBindingMarkers(text: string, bindings: CronDataBindingRef[]): string {
  if (!text.includes("{{bind:")) {
    return text;
  }
  const byId = new Map(bindings.map((item) => [item.bindingId, item]));
  return text.replace(/\{\{bind:([^}]+)\}\}/g, (match, rawId: string) => {
    const binding = byId.get(rawId.trim());
    if (!binding) {
      return match;
    }
    if (binding.kind === "runtime_date") {
      return "【今天日期】";
    }
    return `【${binding.label}】`;
  });
}
