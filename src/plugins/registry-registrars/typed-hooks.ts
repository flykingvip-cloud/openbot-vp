// Typed hook registrar (`api.on(hookName, handler)`) — the strongly-typed
// hook events used by the modern plugin SDK. Includes the prompt-injection
// policy enforcement that gates `before_prompt_build` / `before_agent_start`
// when the plugin's config has `hooks.allowPromptInjection=false`.

import type { PluginRecord, PluginTypedHookPolicy, RegistrarContext } from "../registry-types.js";
import {
  isPluginHookName,
  isPromptInjectionHookName,
  stripPromptMutationFieldsFromLegacyHookResult,
} from "../types.js";
import type {
  PluginHookHandlerMap,
  PluginHookName,
  PluginHookRegistration as TypedPluginHookRegistration,
} from "../types.js";

const constrainLegacyPromptInjectionHook = (
  handler: PluginHookHandlerMap["before_agent_start"],
): PluginHookHandlerMap["before_agent_start"] => {
  return (event, ctx) => {
    const result = handler(event, ctx);
    if (result && typeof result === "object" && "then" in result) {
      return Promise.resolve(result).then((resolved) =>
        stripPromptMutationFieldsFromLegacyHookResult(resolved),
      );
    }
    return stripPromptMutationFieldsFromLegacyHookResult(result);
  };
};

export type RegisterTypedHookOptions = { priority?: number };

export function registerTypedHook<K extends PluginHookName>(
  ctx: RegistrarContext,
  record: PluginRecord,
  hookName: K,
  handler: PluginHookHandlerMap[K],
  opts?: RegisterTypedHookOptions,
  policy?: PluginTypedHookPolicy,
): void {
  if (!isPluginHookName(hookName)) {
    ctx.pushDiagnostic({
      level: "warn",
      pluginId: record.id,
      source: record.source,
      message: `unknown typed hook "${String(hookName)}" ignored`,
    });
    return;
  }
  let effectiveHandler = handler;
  if (policy?.allowPromptInjection === false && isPromptInjectionHookName(hookName)) {
    if (hookName === "before_prompt_build") {
      ctx.pushDiagnostic({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `typed hook "${hookName}" blocked by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
      });
      return;
    }
    if (hookName === "before_agent_start") {
      ctx.pushDiagnostic({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `typed hook "${hookName}" prompt fields constrained by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
      });
      effectiveHandler = constrainLegacyPromptInjectionHook(
        handler as PluginHookHandlerMap["before_agent_start"],
      ) as PluginHookHandlerMap[K];
    }
  }
  record.hookCount += 1;
  ctx.registry.typedHooks.push({
    pluginId: record.id,
    hookName,
    handler: effectiveHandler,
    priority: opts?.priority,
    source: record.source,
  } as TypedPluginHookRegistration);
}
