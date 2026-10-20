import { renderMeshGovernanceSurface } from "./enterprise-mesh-governance-surface.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

/**
 * Phase 4: Active workforce surface is absorbed into Legacy mesh shell.
 * Kept as a thin alias so older imports continue to resolve.
 */
export function renderWorkforceGovernanceSurface(props: EnterpriseSurfaceProps, basePath = "") {
  return renderMeshGovernanceSurface(props, basePath);
}
