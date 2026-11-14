import {
  canReadHostView,
  filterEffectivePolicyView,
  findLimitedRuleById,
  isReadToolEnabled,
  searchLimitedRules,
  wrapUntrustedMaterial,
} from "../../context/rule-adaptation/materials.js";
import type {
  RuleAdaptationHostView,
  ShadowToolJournalEntry,
  ToolDescriptor,
} from "../../contracts/rule-adaptation-shadow.js";
import {
  createControlledCandidateEntry,
  type ControlledCandidateEntry,
} from "./candidate-entry.js";

export const TOOL_SEARCH_RULES = "searchRules";
export const TOOL_GET_RULE_DEFINITION = "getRuleDefinition";
export const TOOL_GET_EFFECTIVE_POLICY = "getEffectivePolicy";
export const TOOL_SUBMIT_RULE_CANDIDATE = "submitRuleCandidate";

export const SHADOW_READONLY_TOOLS = [
  TOOL_SEARCH_RULES,
  TOOL_GET_RULE_DEFINITION,
  TOOL_GET_EFFECTIVE_POLICY,
] as const;

export const SHADOW_ALLOWED_TOOLS = [...SHADOW_READONLY_TOOLS, TOOL_SUBMIT_RULE_CANDIDATE] as const;

export const SHADOW_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    name: TOOL_SEARCH_RULES,
    description: "Structured filter and text match over the host-provided limited rule view.",
    readonly: true,
  },
  {
    name: TOOL_GET_RULE_DEFINITION,
    description: "Read one host-provided rule definition by id. Result is untrusted material.",
    readonly: true,
  },
  {
    name: TOOL_GET_EFFECTIVE_POLICY,
    description: "Read current effective values from the host-provided limited view.",
    readonly: true,
  },
  {
    name: TOOL_SUBMIT_RULE_CANDIDATE,
    description:
      "Controlled-entry design stub. P2 must refuse persistence, activation, and publication.",
    readonly: false,
  },
];

export type ShadowToolStatus =
  | "ok"
  | "unavailable"
  | "permission_denied"
  | "rejected"
  | "not_found";

export type ShadowToolExecution = {
  status: ShadowToolStatus;
  name: string;
  readonly: boolean;
  code?: string;
  path?: string;
  result?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asArgs(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

export type ShadowToolExecutor = {
  descriptors(): readonly ToolDescriptor[];
  execute(name: string, args: unknown): ShadowToolExecution;
  journal(): readonly ShadowToolJournalEntry[];
  rejected(): readonly ShadowToolJournalEntry[];
  businessAttempts(): readonly string[];
  candidateToolInvoked(): boolean;
  retrievalAttempted(): boolean;
};

export function createShadowToolExecutor(input: {
  view: RuleAdaptationHostView;
  diagnosed: () => boolean;
  candidateEntry?: ControlledCandidateEntry;
}): ShadowToolExecutor {
  const entry = input.candidateEntry ?? createControlledCandidateEntry();
  const journal: ShadowToolJournalEntry[] = [];
  const rejected: ShadowToolJournalEntry[] = [];
  const businessAttempts: string[] = [];
  let candidateToolInvoked = false;
  let retrievalAttempted = false;

  const record = (execution: ShadowToolExecution): ShadowToolExecution => {
    const item: ShadowToolJournalEntry = {
      name: execution.name,
      readonly: execution.readonly,
      status: execution.status,
      ...(execution.code ? { code: execution.code } : {}),
      ...(execution.path ? { path: execution.path } : {}),
    };
    journal.push(item);
    if (
      execution.status === "rejected" ||
      execution.status === "unavailable" ||
      execution.status === "permission_denied"
    ) {
      rejected.push(item);
    }
    return execution;
  };

  return {
    descriptors: () => SHADOW_TOOL_DESCRIPTORS,
    journal: () => [...journal],
    rejected: () => [...rejected],
    businessAttempts: () => [...businessAttempts],
    candidateToolInvoked: () => candidateToolInvoked,
    retrievalAttempted: () => retrievalAttempted,
    execute(name, rawArgs) {
      const allowed = (SHADOW_ALLOWED_TOOLS as readonly string[]).includes(name);
      if (!allowed) {
        businessAttempts.push(name);
        return record({
          status: "rejected",
          name,
          readonly: false,
          code: "tool_not_permitted",
          path: `tools.${name}`,
          result: { error: "Business or unknown tools cannot run in shadow mode." },
        });
      }
      const readonly = name !== TOOL_SUBMIT_RULE_CANDIDATE;
      if (readonly && !input.diagnosed()) {
        return record({
          status: "rejected",
          name,
          readonly: true,
          code: "diagnose_required",
          path: `tools.${name}`,
          result: { error: "Diagnosis must be recorded before retrieval." },
        });
      }
      if (name === TOOL_SUBMIT_RULE_CANDIDATE) {
        candidateToolInvoked = true;
        const decision = entry.submitRuleCandidate(rawArgs, { enablePersist: true });
        return record({
          status: "rejected",
          name,
          readonly: false,
          code: decision.code,
          path: decision.path,
          result: decision,
        });
      }
      if (
        (name === TOOL_SEARCH_RULES ||
          name === TOOL_GET_RULE_DEFINITION ||
          name === TOOL_GET_EFFECTIVE_POLICY) &&
        !isReadToolEnabled(input.view.tools, name)
      ) {
        return record({
          status: "unavailable",
          name,
          readonly: true,
          code: "tool_unavailable",
          path: `tools.${name}`,
        });
      }
      const kind = name === TOOL_GET_EFFECTIVE_POLICY ? "effective" : "rules";
      if (!canReadHostView(input.view.permissions, kind)) {
        return record({
          status: "permission_denied",
          name,
          readonly: true,
          code: "insufficient_permission",
          path: `tools.${name}`,
        });
      }
      retrievalAttempted = true;
      const args = asArgs(rawArgs);
      if (name === TOOL_SEARCH_RULES) {
        const hits = searchLimitedRules(input.view.rules, args);
        return record({
          status: "ok",
          name,
          readonly: true,
          result: wrapUntrustedMaterial({ matches: hits }, JSON.stringify(hits)),
        });
      }
      if (name === TOOL_GET_RULE_DEFINITION) {
        const id =
          typeof args.id === "string"
            ? args.id
            : typeof args.ruleId === "string"
              ? args.ruleId
              : "";
        const rule = findLimitedRuleById(input.view.rules, id);
        if (!rule) {
          return record({
            status: "not_found",
            name,
            readonly: true,
            code: "fabricated_rule_id",
            path: "tools.getRuleDefinition.id",
            result: wrapUntrustedMaterial({ id, found: false }, id),
          });
        }
        const raw = [rule.body, rule.summary, rule.id].filter(Boolean).join("\n");
        return record({
          status: "ok",
          name,
          readonly: true,
          result: wrapUntrustedMaterial({ ...rule, found: true }, raw),
        });
      }
      const field = typeof args.field === "string" ? args.field : undefined;
      const values = filterEffectivePolicyView(input.view.effectivePolicy, field);
      return record({
        status: "ok",
        name,
        readonly: true,
        result: wrapUntrustedMaterial({ values }, JSON.stringify(values)),
      });
    },
  };
}
