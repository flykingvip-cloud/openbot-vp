/** Optional hypothesis-only pass. Never evaluates tasks or invokes a control plane. */
export type RuleFinding = {
  readonly findingId: string;
  readonly source: "rule_v1";
  readonly evidenceIds: readonly string[];
  readonly code: string;
};
export type ReasoningEvidence = {
  readonly evidenceId: string;
  readonly layer: "resource" | "technical" | "execution" | "business";
  readonly status: "present" | "partial" | "unknown";
  readonly reasonCodes: readonly string[];
};
export type ReasoningInput = {
  readonly evidence: readonly ReasoningEvidence[];
  readonly findings: readonly RuleFinding[];
};
export type ReasoningItem = {
  id: string;
  kind: "hypothesis" | "suggestion";
  text: string;
  evidenceIds: string[];
  source: "reasoning";
  modelRef: string;
};
export type ReasoningModelPort = (
  input: ReasoningInput,
  context: { signal: AbortSignal; modelRef: string },
) => Promise<unknown>;
function object(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
}
function parse(value: unknown, ids: Set<string>, modelRef: string): ReasoningItem[] | null {
  if (
    !object(value) ||
    !exact(value, ["schemaVersion", "items"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  ) {
    return null;
  }
  const items: ReasoningItem[] = [];
  const used = new Set<string>();
  for (const row of value.items) {
    if (
      !object(row) ||
      !exact(row, ["id", "kind", "text", "evidenceIds", "source", "modelRef"]) ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      used.has(row.id) ||
      (row.kind !== "hypothesis" && row.kind !== "suggestion") ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      row.text.length > 2000 ||
      row.source !== "reasoning" ||
      row.modelRef !== modelRef ||
      !Array.isArray(row.evidenceIds) ||
      !row.evidenceIds.length ||
      !row.evidenceIds.every((id) => typeof id === "string" && ids.has(id)) ||
      new Set(row.evidenceIds).size !== row.evidenceIds.length
    ) {
      return null;
    }
    used.add(row.id);
    items.push({
      id: row.id,
      kind: row.kind,
      text: row.text,
      evidenceIds: [...row.evidenceIds] as string[],
      source: "reasoning",
      modelRef,
    });
  }
  return items;
}
export async function runReasoningPass(
  input: ReasoningInput,
  options: {
    enabled?: boolean;
    modelRef?: string;
    timeoutMs?: number;
    model?: ReasoningModelPort;
  } = {},
) {
  // Copy only metadata; extra prompt/tool/body fields are never sent to the model.
  const safe: ReasoningInput = {
    evidence: input.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      layer: e.layer,
      status: e.status,
      reasonCodes: [...e.reasonCodes],
    })),
    findings: input.findings.map((f) => ({
      findingId: f.findingId,
      source: "rule_v1",
      evidenceIds: [...f.evidenceIds],
      code: f.code,
    })),
  };
  const fallback = (reason: string) => ({
    scoringMethod: "rule_v1" as const,
    findings: structuredClone(safe.findings),
    items: [] as ReasoningItem[],
    reason,
  });
  if (!options.enabled) {
    return fallback("reasoning_disabled");
  }
  if (!options.model || !options.modelRef?.trim()) {
    return fallback("reasoning_unconfigured");
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) {
    return fallback("reasoning_invalid_timeout");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("reasoning_timeout"));
      }, timeoutMs);
    });
    const value = await Promise.race([
      Promise.resolve().then(() =>
        options.model!(structuredClone(safe), {
          signal: controller.signal,
          modelRef: options.modelRef!,
        }),
      ),
      timeout,
    ]);
    const items = parse(value, new Set(safe.evidence.map((e) => e.evidenceId)), options.modelRef);
    return items
      ? {
          scoringMethod: "rule_v1_with_hypotheses" as const,
          findings: structuredClone(safe.findings),
          items,
          reason: "hypotheses_only",
        }
      : fallback("reasoning_schema_invalid");
  } catch (error) {
    return fallback(
      error instanceof Error && error.message === "reasoning_timeout"
        ? "reasoning_timeout"
        : "reasoning_model_error",
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    controller.abort();
  }
}
