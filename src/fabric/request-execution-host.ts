import type { ExecutionEvent, ToolRequest } from "./contract.js";
import type { FabricService } from "./service.js";

export type FabricRequestHost = {
  service: FabricService;
  dispose: () => Promise<void>;
  signal?: AbortSignal;
};
/** Share catalog/check only. Every execution gets its own lease and grant issuer. */
export function createRequestHostedFabricService(input: {
  control: FabricService;
  admit: (request: ToolRequest) => Promise<FabricRequestHost>;
}): FabricService {
  const execute = async (request: ToolRequest, onEvent?: (event: ExecutionEvent) => void) => {
    const host = await input.admit(request);
    try {
      host.signal?.throwIfAborted();
      const outcome = onEvent
        ? await host.service.stream(request, onEvent)
        : await host.service.execute(request);
      host.signal?.throwIfAborted();
      return outcome;
    } finally {
      await host.dispose();
    }
  };
  return {
    check: (request) => input.control.check(request),
    registerAdapter: (raw) => input.control.registerAdapter(raw),
    execute: (request) => execute(request),
    stream: (request, onEvent) => execute(request, onEvent),
  };
}
