import type { DatabaseSync } from "node:sqlite";

export type GovernanceLlmUsageStats = {
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsCharged: number;
  lastCallAt: number | null;
};

const EMPTY_STATS: GovernanceLlmUsageStats = {
  llmCallCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  creditsCharged: 0,
  lastCallAt: null,
};

export function incrementGovernanceLlmUsageLocal(params: {
  db: DatabaseSync;
  kbId: string;
  inputTokens: number;
  outputTokens: number;
  creditsCharged?: number;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  const inputTokens = Math.max(0, Math.floor(params.inputTokens));
  const outputTokens = Math.max(0, Math.floor(params.outputTokens));
  const creditsCharged = Math.max(0, Number(params.creditsCharged ?? 0));
  params.db
    .prepare(
      `INSERT INTO governance_llm_usage (
         kb_id, llm_call_count, input_tokens, output_tokens, credits_charged, last_call_at, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(kb_id) DO UPDATE SET
         llm_call_count = llm_call_count + 1,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         credits_charged = credits_charged + excluded.credits_charged,
         last_call_at = excluded.last_call_at,
         updated_at = excluded.updated_at`,
    )
    .run(params.kbId, inputTokens, outputTokens, creditsCharged, now, now);
}

export function getGovernanceLlmUsageStats(
  db: DatabaseSync,
  kbId?: string,
): GovernanceLlmUsageStats {
  if (kbId) {
    const row = db
      .prepare(
        `SELECT llm_call_count, input_tokens, output_tokens, credits_charged, last_call_at
         FROM governance_llm_usage WHERE kb_id = ?`,
      )
      .get(kbId) as
      | {
          llm_call_count: number;
          input_tokens: number;
          output_tokens: number;
          credits_charged: number;
          last_call_at: number | null;
        }
      | undefined;
    if (!row) {
      return { ...EMPTY_STATS };
    }
    return {
      llmCallCount: row.llm_call_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.input_tokens + row.output_tokens,
      creditsCharged: row.credits_charged,
      lastCallAt: row.last_call_at,
    };
  }

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(llm_call_count), 0) AS llm_call_count,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(credits_charged), 0) AS credits_charged,
         MAX(last_call_at) AS last_call_at
       FROM governance_llm_usage`,
    )
    .get() as {
    llm_call_count: number;
    input_tokens: number;
    output_tokens: number;
    credits_charged: number;
    last_call_at: number | null;
  };
  return {
    llmCallCount: row.llm_call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.input_tokens + row.output_tokens,
    creditsCharged: row.credits_charged,
    lastCallAt: row.last_call_at,
  };
}
