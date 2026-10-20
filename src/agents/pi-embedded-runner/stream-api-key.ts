import type { StreamFn } from "@earendil-works/pi-agent-core";

/**
 * The embedded runner assigns `streamSimple` from `@earendil-works/pi-ai` so
 * tests can mock a stable function. That raw stream does **not** read
 * OpenBotAuthStorage — it only accepts `options.apiKey` or an Authorization
 * header. Without this wrapper, custom providers (api-proxy-*) fail with
 * `No API key for provider: …` even when the key is already resolved.
 */
export function wrapStreamFnWithResolvedApiKey(
  baseFn: StreamFn,
  apiKey: string | undefined,
): StreamFn {
  const key = apiKey?.trim();
  if (!key) {
    return baseFn;
  }
  return (model, context, options) => {
    const existing = typeof options?.apiKey === "string" ? options.apiKey.trim() : "";
    return baseFn(model, context, {
      ...options,
      apiKey: existing || key,
    });
  };
}

export async function resolveStreamApiKey(params: {
  getApiKey: (provider: string) => Promise<string | undefined>;
  modelProvider?: string;
  provider?: string;
}): Promise<string | undefined> {
  const candidates = [params.modelProvider, params.provider]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  for (const provider of candidates) {
    if (seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    const resolved = (await params.getApiKey(provider))?.trim();
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}
