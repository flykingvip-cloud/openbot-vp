import type { PlatformPortRenderModel } from "../view-types.ts";

export type PlatformModelsActions = PlatformPortRenderModel["surfaceActions"]["models"];

export function selectPlatformModelsActions(
  actions: PlatformPortRenderModel["surfaceActions"],
): PlatformModelsActions {
  return actions.models;
}
