const BLACKLIST_TERMS = [
  "workflow",
  "schema",
  "toolchain",
  "dependency graph",
  "dependency",
  "provider",
  "model",
  "routing",
  "prompt",
  "memory strategy",
  "execution policy",
  "capability governance",
  "registry",
  "asset lifecycle",
  "version",
  "rollback",
  "migration",
  "healthy",
  "warning",
  "broken",
  "submitted",
  "reviewing",
  "approved",
  "published",
  "deprecated",
  "retired",
  "rejected",
  "OpenAI",
  "Anthropic",
  "模型路由",
  "路由策略",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const englishTerms = BLACKLIST_TERMS.filter((term) => /^[a-zA-Z ]+$/.test(term)).map((term) =>
  escapeRegExp(term).replaceAll("\\ ", "\\s+"),
);
const literalTerms = BLACKLIST_TERMS.filter((term) => !/^[a-zA-Z ]+$/.test(term)).map(escapeRegExp);

export const TERMINOLOGY_BLACKLIST_PATTERN = new RegExp(
  [...englishTerms.map((term) => `\\b${term}\\b`), ...literalTerms].join("|"),
  "iu",
);

export const SKILL_STANDALONE_PATTERN = /\bSkill\b/u;

export type TerminologyScanResult = {
  context: string;
  term: string;
  text: string;
};

type ScannableNode = {
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => Iterable<ScannableNode> | ArrayLike<ScannableNode>;
};

function findBlockedTerm(text: string): string | null {
  const skillMatch = text.match(SKILL_STANDALONE_PATTERN);
  if (skillMatch?.[0]) {
    return skillMatch[0];
  }
  const termMatch = text.match(TERMINOLOGY_BLACKLIST_PATTERN);
  return termMatch?.[0] ?? null;
}

export function assertNoBlacklistedTerm(text: string, context: string): void {
  const term = findBlockedTerm(text);
  if (!term) {
    return;
  }
  throw new Error(`Employee capability terminology violation in ${context}: "${term}"`);
}

export function scanText(text: string | null | undefined, context = "text"): void {
  if (typeof text === "string" && text.trim()) {
    assertNoBlacklistedTerm(text, context);
  }
}

function scanAttributes(node: ScannableNode, context: string): void {
  if (!node.getAttribute) {
    return;
  }
  for (const attrName of ["aria-label", "title", "placeholder"]) {
    scanText(node.getAttribute(attrName), `${context}[${attrName}]`);
  }
}

function toArray<T>(value: Iterable<T> | ArrayLike<T>): T[] {
  return Array.from(value as ArrayLike<T>);
}

export function scanNode(renderRoot: ScannableNode, context = "renderRoot"): void {
  scanText(renderRoot.textContent, context);
  scanAttributes(renderRoot, context);
  const descendants = renderRoot.querySelectorAll?.("[aria-label], [title], [placeholder]");
  if (!descendants) {
    return;
  }
  for (const node of toArray(descendants)) {
    scanAttributes(node, context);
  }
}
