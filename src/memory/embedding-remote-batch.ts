/**
 * DashScope OpenAI-compatible `/embeddings` rejects more than 10 inputs
 * (`InternalError.InvalidParameter`: 批量大小无效，不应大于 10).
 * Official OpenAI accepts larger arrays, but paging at 10 is safe for every
 * remote that speaks this protocol — including production Qwen proxies.
 */
export const REMOTE_EMBEDDING_MAX_BATCH_INPUTS = 10;

export async function embedRemoteInputsInPages<T>(params: {
  inputs: string[];
  maxBatchInputs?: number;
  embedPage: (page: string[]) => Promise<T[]>;
}): Promise<T[]> {
  const pageSize = Math.max(1, params.maxBatchInputs ?? REMOTE_EMBEDDING_MAX_BATCH_INPUTS);
  if (params.inputs.length === 0) {
    return [];
  }
  if (params.inputs.length <= pageSize) {
    return await params.embedPage(params.inputs);
  }
  const out: T[] = [];
  for (let start = 0; start < params.inputs.length; start += pageSize) {
    const page = params.inputs.slice(start, start + pageSize);
    out.push(...(await params.embedPage(page)));
  }
  return out;
}
