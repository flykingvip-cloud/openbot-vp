import type { RawUsageLike, UsageProvenance } from "./types.ts";

export type MappedUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  provenance: UsageProvenance;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function mapModelUsage(raw: RawUsageLike | null | undefined): MappedUsage {
  if (!raw) {
    throw new Error("missing usage: sample rejected");
  }
  const promptTokens = finiteNumber(
    raw.promptTokens ?? raw.input ?? raw.inputTokens ?? raw.prompt_tokens,
  );
  const completionTokens = finiteNumber(
    raw.completionTokens ?? raw.output ?? raw.outputTokens ?? raw.completion_tokens,
  );
  const totalTokens = finiteNumber(raw.totalTokens ?? raw.total ?? raw.total_tokens);
  if (promptTokens == null || completionTokens == null || totalTokens == null) {
    throw new Error("missing usage: sample rejected");
  }
  if (promptTokens < 0 || completionTokens < 0 || totalTokens < 0) {
    throw new Error("missing usage: sample rejected");
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    provenance: "model_return",
  };
}

export function assertUsageAcceptable(params: {
  usage: MappedUsage;
  provenance: UsageProvenance;
}): void {
  if (params.provenance !== "model_return") {
    throw new Error(`forged usage marked ${params.provenance}: sample rejected`);
  }
  if (params.usage.provenance !== "model_return") {
    throw new Error("forged usage marked synthetic: sample rejected");
  }
}
