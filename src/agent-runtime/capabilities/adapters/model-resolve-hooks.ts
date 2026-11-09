import type { HookRunner } from "../../../plugins/hooks.js";
import type {
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookBeforeModelResolveResult,
} from "../../../plugins/types.js";

/** Preserve hook ordering and cache the legacy result for prompt construction. */
export async function resolveModelHookResult(params: {
  prompt: string;
  hookCtx: PluginHookAgentContext;
  hookRunner?: Pick<
    HookRunner,
    "hasHooks" | "runBeforeModelResolve" | "runBeforeAgentStart"
  > | null;
  warn: (message: string) => void;
}): Promise<{
  modelResolveOverride: PluginHookBeforeModelResolveResult | undefined;
  legacyBeforeAgentStartResult: PluginHookBeforeAgentStartResult | undefined;
}> {
  let modelResolveOverride: PluginHookBeforeModelResolveResult | undefined;
  let legacyBeforeAgentStartResult: PluginHookBeforeAgentStartResult | undefined;
  if (params.hookRunner?.hasHooks("before_model_resolve")) {
    try {
      modelResolveOverride = await params.hookRunner.runBeforeModelResolve(
        { prompt: params.prompt },
        params.hookCtx,
      );
    } catch (error) {
      params.warn(`before_model_resolve hook failed: ${String(error)}`);
    }
  }
  if (params.hookRunner?.hasHooks("before_agent_start")) {
    try {
      legacyBeforeAgentStartResult = await params.hookRunner.runBeforeAgentStart(
        { prompt: params.prompt },
        params.hookCtx,
      );
      modelResolveOverride = {
        providerOverride:
          modelResolveOverride?.providerOverride ?? legacyBeforeAgentStartResult?.providerOverride,
        modelOverride:
          modelResolveOverride?.modelOverride ?? legacyBeforeAgentStartResult?.modelOverride,
      };
    } catch (error) {
      params.warn(`before_agent_start hook (legacy model resolve path) failed: ${String(error)}`);
    }
  }
  return { modelResolveOverride, legacyBeforeAgentStartResult };
}
