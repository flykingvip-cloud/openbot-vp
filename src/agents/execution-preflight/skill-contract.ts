import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../skills/frontmatter.js";

export type SkillRuntimeContract = {
  skillId: string;
  aliases: string[];
  aliasOf?: string;
  primaryEngine?: string;
  forbiddenFinalEngines: string[];
  requiredValidators: string[];
  allowedTools: string[];
  forbiddenTools: string[];
  requiredReferences: string[];
  requiredConfirmations: string[];
  requiredArtifacts: string[];
  validationCommand?: string;
  deliveryConditions: string[];
  deliveryBlockedUntil?: string;
  /** From frontmatter `execution-stage` only. Model text is ignored. */
  executionStage?: "generation" | "delivery";
  /** Tools that may write before a receipt. Empty means write/edit stay generation-stage. */
  generationStageTools: string[];
  /** Tools that may announce completion only after a receipt. */
  deliveryStageTools: string[];
  triggers: string[];
  /**
   * Optional OGUI / Generative UI components this skill may emit (frontmatter
   * `supported-ui-components`). Empty / omitted = no UI declaration (prompt-only
   * for UI; other contract fields still apply).
   */
  supportedUiComponents: string[];
  /**
   * When true, skill output that requests user confirmation must go through an
   * OGUI form/choice or an existing Steward / Exec Approvals path — not a free
   * invented button. Frontmatter `requires-ui-confirmation: true|false`.
   */
  requiresUiConfirmation?: boolean;
};

const LIST_FIELDS = [
  "aliases",
  "forbidden-final-engines",
  "required-validators",
  "allowed-tools",
  "forbidden-tools",
  "required-references",
  "required-confirmations",
  "required-artifacts",
  "delivery-conditions",
  "generation-stage-tools",
  "delivery-stage-tools",
  "triggers",
  "supported-ui-components",
] as const;

function splitList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(/[,，]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function hasContractFields(frontmatter: Record<string, string>): boolean {
  const keys = [
    "alias-of",
    "primary-engine",
    "validation-command",
    "delivery-blocked-until",
    "execution-stage",
    ...LIST_FIELDS,
  ];
  return keys.some((key) => Boolean(frontmatter[key]?.trim()));
}

/** Known OGUI / chat-inline UI component ids a skill may declare. */
export const OGUI_UI_COMPONENT_IDS = ["ogui-form", "ogui-choice"] as const;

export type OguiUiComponentId = (typeof OGUI_UI_COMPONENT_IDS)[number];

const OGUI_UI_COMPONENT_ID_SET = new Set<string>(OGUI_UI_COMPONENT_IDS);

/**
 * Soft-validate declared UI components. Unknown ids are dropped (not a hard
 * preflight fail) so older skills with typos degrade safely; callers may
 * inspect `unknownIds` for lint.
 */
export function normalizeSupportedUiComponents(raw: string[]): {
  supportedUiComponents: OguiUiComponentId[];
  unknownIds: string[];
} {
  const supportedUiComponents: OguiUiComponentId[] = [];
  const unknownIds: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const key = id.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (OGUI_UI_COMPONENT_ID_SET.has(key)) {
      supportedUiComponents.push(key as OguiUiComponentId);
    } else {
      unknownIds.push(key);
    }
  }
  return { supportedUiComponents, unknownIds };
}

function parseRequiresUiConfirmation(raw: string | undefined): boolean | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "1") {
    return true;
  }
  if (v === "false" || v === "no" || v === "0") {
    return false;
  }
  return undefined;
}

/** Read the optional runtime contract. Skills without these keys stay prompt-only. */
export function readSkillContract(
  skillId: string,
  frontmatter: Record<string, string> | undefined,
): SkillRuntimeContract | undefined {
  if (!frontmatter || !hasContractFields(frontmatter)) {
    return undefined;
  }
  const aliasOf = frontmatter["alias-of"]?.trim() || undefined;
  const primaryEngine = frontmatter["primary-engine"]?.trim() || undefined;
  const validationCommand = frontmatter["validation-command"]?.trim() || undefined;
  const deliveryBlockedUntil = frontmatter["delivery-blocked-until"]?.trim() || undefined;
  const rawStage = frontmatter["execution-stage"]?.trim();
  const executionStage =
    rawStage === "generation" || rawStage === "delivery" ? rawStage : undefined;
  const requiresUiConfirmation = parseRequiresUiConfirmation(
    frontmatter["requires-ui-confirmation"],
  );
  return {
    skillId,
    aliases: splitList(frontmatter.aliases),
    ...(aliasOf ? { aliasOf } : {}),
    ...(primaryEngine ? { primaryEngine } : {}),
    forbiddenFinalEngines: splitList(frontmatter["forbidden-final-engines"]),
    requiredValidators: splitList(frontmatter["required-validators"]),
    allowedTools: splitList(frontmatter["allowed-tools"]),
    forbiddenTools: splitList(frontmatter["forbidden-tools"]),
    requiredReferences: splitList(frontmatter["required-references"]),
    requiredConfirmations: splitList(frontmatter["required-confirmations"]),
    requiredArtifacts: splitList(frontmatter["required-artifacts"]),
    ...(validationCommand ? { validationCommand } : {}),
    deliveryConditions: splitList(frontmatter["delivery-conditions"]),
    ...(deliveryBlockedUntil ? { deliveryBlockedUntil } : {}),
    ...(executionStage ? { executionStage } : {}),
    generationStageTools: splitList(frontmatter["generation-stage-tools"]),
    deliveryStageTools: splitList(frontmatter["delivery-stage-tools"]),
    triggers: splitList(frontmatter.triggers),
    supportedUiComponents: normalizeSupportedUiComponents(
      splitList(frontmatter["supported-ui-components"]),
    ).supportedUiComponents,
    ...(requiresUiConfirmation === undefined ? {} : { requiresUiConfirmation }),
  };
}

const frontmatterCache = new Map<string, Record<string, string>>();

/** Snapshot entries often drop frontmatter. Read each SKILL.md at most once per process. */
export function resolveSkillFrontmatter(params: {
  frontmatter?: Record<string, string>;
  filePath?: string;
  readFile?: (filePath: string) => string;
}): Record<string, string> {
  if (params.frontmatter && Object.keys(params.frontmatter).length > 0) {
    return params.frontmatter;
  }
  const filePath = params.filePath?.trim();
  if (!filePath) {
    return {};
  }
  const cached = frontmatterCache.get(filePath);
  if (cached) {
    return cached;
  }
  try {
    const readFile = params.readFile ?? ((target: string) => readFileSync(target, "utf8"));
    const parsed = parseFrontmatter(readFile(filePath));
    frontmatterCache.set(filePath, parsed);
    return parsed;
  } catch {
    frontmatterCache.set(filePath, {});
    return {};
  }
}

export function triggerMatches(message: string, trigger: string): boolean {
  const needle = trigger.trim().toLowerCase();
  if (!needle) {
    return false;
  }
  if (/^[a-z0-9_-]+$/iu.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "iu").test(message);
  }
  return message.toLowerCase().includes(needle);
}
