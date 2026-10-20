import type { CronDataBindingKind, CronDataBindingRef } from "./personal-task-meta.js";
import { cronDataBindingMarker, normalizeCronDataBindings } from "./personal-task-meta.js";

export type LegacyCapabilityHint = {
  id: string;
  title: string;
  summary: string;
  scenarios: string[];
  accessState?: "granted" | "requestable" | "external";
};

export type LegacyPromptTokenSpec = {
  token: string;
  bindingId: string;
  kind: CronDataBindingKind;
  resourceId?: string;
  label: string;
  capabilityKeywords?: string[];
};

export const LEGACY_PROMPT_TOKEN_SPECS: LegacyPromptTokenSpec[] = [
  {
    token: "{{today}}",
    bindingId: "runtime-today",
    kind: "runtime_date",
    resourceId: "today",
    label: "今天日期",
  },
  {
    token: "{{customer_list}}",
    bindingId: "legacy-customer-list",
    kind: "capability",
    label: "客户列表",
    capabilityKeywords: ["客户", "customer", "crm", "画像"],
  },
  {
    token: "{{sales_data}}",
    bindingId: "legacy-sales-data",
    kind: "capability",
    label: "销售数据",
    capabilityKeywords: ["销售", "sales", "gmv", "订单", "成交"],
  },
];

const LEGACY_TOKEN_PATTERN = /\{\{(today|customer_list|sales_data)\}\}/g;

export function findLegacyPromptTokens(text: string): string[] {
  const matches = text.match(LEGACY_TOKEN_PATTERN) ?? [];
  return [...new Set(matches)];
}

function scoreCapabilityMatch(capability: LegacyCapabilityHint, keywords: string[]): number {
  const haystack = [
    capability.id,
    capability.title,
    capability.summary,
    capability.scenarios.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase();
    if (!normalized) {
      continue;
    }
    if (haystack.includes(normalized)) {
      score += 3;
    }
  }
  if (capability.accessState === "granted") {
    score += 2;
  }
  return score;
}

export function resolveLegacyCapabilityBinding(params: {
  spec: LegacyPromptTokenSpec;
  capabilities: LegacyCapabilityHint[];
}): CronDataBindingRef | null {
  const keywords = params.spec.capabilityKeywords ?? [];
  if (keywords.length === 0) {
    return null;
  }
  const ranked = params.capabilities
    .map((capability) => ({
      capability,
      score: scoreCapabilityMatch(capability, keywords),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score);
  const best = ranked[0]?.capability;
  if (!best) {
    return null;
  }
  return {
    bindingId: params.spec.bindingId,
    kind: "capability",
    resourceId: best.id,
    label: best.title || params.spec.label,
    ...(best.accessState ? { accessState: best.accessState } : {}),
  };
}

export type LegacyPromptMigrationResult = {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  migratedTokens: string[];
  unresolvedTokens: string[];
};

export function migrateLegacyPromptBindings(params: {
  intentText: string;
  dataBindings?: CronDataBindingRef[];
  capabilities?: LegacyCapabilityHint[];
}): LegacyPromptMigrationResult {
  const tokens = findLegacyPromptTokens(params.intentText);
  if (tokens.length === 0) {
    return {
      intentText: params.intentText,
      dataBindings: normalizeCronDataBindings(params.dataBindings),
      migratedTokens: [],
      unresolvedTokens: [],
    };
  }

  let intentText = params.intentText;
  let dataBindings = normalizeCronDataBindings(params.dataBindings);
  const migratedTokens: string[] = [];
  const unresolvedTokens: string[] = [];
  const capabilities = params.capabilities ?? [];

  for (const token of tokens) {
    const spec = LEGACY_PROMPT_TOKEN_SPECS.find((entry) => entry.token === token);
    if (!spec) {
      unresolvedTokens.push(token);
      continue;
    }

    let binding: CronDataBindingRef | null = null;
    if (spec.kind === "runtime_date" && spec.resourceId) {
      binding = {
        bindingId: spec.bindingId,
        kind: spec.kind,
        resourceId: spec.resourceId,
        label: spec.label,
      };
    } else if (spec.kind === "capability") {
      binding = resolveLegacyCapabilityBinding({ spec, capabilities });
    }

    if (!binding) {
      unresolvedTokens.push(token);
      continue;
    }

    dataBindings = normalizeCronDataBindings([
      ...dataBindings.filter((item) => item.bindingId !== binding.bindingId),
      binding,
    ]);
    intentText = intentText.split(token).join(cronDataBindingMarker(binding.bindingId));
    migratedTokens.push(token);
  }

  return { intentText, dataBindings, migratedTokens, unresolvedTokens };
}
