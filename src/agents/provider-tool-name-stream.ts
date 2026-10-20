import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  restoreProviderToolNamesInEvent,
  sanitizeStreamContextForProvider,
  sanitizeStreamToolChoice,
  scrubProviderToolPayload,
} from "./provider-tool-names.js";

function mergeReverseMaps(
  base: Map<string, string>,
  extra: Map<string, string>,
): Map<string, string> {
  if (extra.size === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const [sanitized, original] of extra) {
    merged.set(sanitized, original);
  }
  return merged;
}

function restoreProviderToolNamesOnStream(
  stream: ReturnType<StreamFn>,
  getReverse: () => Map<string, string>,
): ReturnType<StreamFn> {
  if (!stream || typeof stream !== "object") {
    return stream;
  }
  const streamRecord = stream as {
    result?: () => Promise<unknown>;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof streamRecord.result === "function") {
    const originalResult = streamRecord.result.bind(stream);
    streamRecord.result = async () => {
      const message = await originalResult();
      restoreProviderToolNamesInEvent(message, getReverse());
      return message;
    };
  }
  if (
    Symbol.asyncIterator in stream &&
    typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  ) {
    const originalAsyncIterator = (
      stream as { [Symbol.asyncIterator]: () => AsyncIterator<unknown> }
    )[Symbol.asyncIterator].bind(stream);
    (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
      function () {
        const iterator = originalAsyncIterator();
        return {
          async next() {
            const result = await iterator.next();
            if (!result.done) {
              restoreProviderToolNamesInEvent(result.value, getReverse());
            }
            return result;
          },
          async return(value?: unknown) {
            return iterator.return?.(value) ?? { done: true as const, value: undefined };
          },
          async throw(error?: unknown) {
            return iterator.throw?.(error) ?? { done: true as const, value: undefined };
          },
        };
      };
  }
  return stream;
}

/**
 * Innermost stream wrapper: legalize tool names immediately before the provider
 * request, including after `onPayload`, and map tool-call names back so dispatch
 * still uses the registered tool.
 */
export function wrapStreamFnSanitizeProviderToolNames(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const planned = sanitizeStreamContextForProvider(context);
    let reverse = planned.reverse;
    const userOnPayload = options?.onPayload;
    const nextOptions: NonNullable<Parameters<StreamFn>[2]> = {
      ...options,
      onPayload: async (payload, payloadModel) => {
        const next = userOnPayload ? await userOnPayload(payload, payloadModel) : undefined;
        const target = next === undefined ? payload : next;
        reverse = mergeReverseMaps(reverse, scrubProviderToolPayload(target));
        return next;
      },
    };
    if (planned.forward.size > 0 && options && "toolChoice" in options) {
      nextOptions.toolChoice = sanitizeStreamToolChoice(
        options.toolChoice,
        planned.forward,
      ) as NonNullable<Parameters<StreamFn>[2]>["toolChoice"];
    }
    const maybeStream = baseFn(model, planned.context, nextOptions);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        restoreProviderToolNamesOnStream(stream, () => reverse),
      );
    }
    return restoreProviderToolNamesOnStream(maybeStream, () => reverse);
  };
}
