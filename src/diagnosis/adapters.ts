import { passthroughAttributionResolution } from "./attribution-passthrough.js";
/**
 * Phase 1 read-only Evidence Adapter interfaces.
 * collect() must not hit production stores or the message main chain.
 */
import { getEvidenceSourceManifest, isPhase1Collectable } from "./catalog.js";
import { routeResolutionMissingRequirement } from "./planner.js";
import {
  EVIDENCE_SOURCE_IDS,
  type AttributionResolution,
  type DiagnosticEvidence,
  type EvidenceRequirement,
  type EvidenceSourceId,
  type TrustedTenantContext,
} from "./types.js";

export interface DiagnosisEvidenceAdapter {
  readonly id: string;
  readonly authority: string;
  readonly phase1Safe: boolean;
  collect(request: EvidenceRequirement, ctx: TrustedTenantContext): Promise<EvidenceCollectResult>;
}

export interface RouteResolutionEvidenceAdapter extends DiagnosisEvidenceAdapter {
  readonly id: "route_resolution";
  readonly authority: "src/routing/resolve-route.ts";
}

export type EvidenceCollectResult = {
  evidences: readonly DiagnosticEvidence[];
  missing: readonly EvidenceRequirement[];
};

export class DiagnosisAdapterUnavailableError extends Error {
  readonly source: string;
  readonly missing: EvidenceRequirement;
  constructor(source: string, missing: EvidenceRequirement, message?: string) {
    super(message ?? `${source} is reserved or unavailable in Phase 1`);
    this.name = "DiagnosisAdapterUnavailableError";
    this.source = source;
    this.missing = missing;
  }
}

export function createUnimplementedAdapter(
  id: string,
  authority: string,
  phase1Safe?: boolean,
): DiagnosisEvidenceAdapter {
  const safe = phase1Safe ?? (isKnownSource(id) ? getEvidenceSourceManifest(id).phase1Safe : false);
  return {
    id,
    authority,
    phase1Safe: safe,
    collect(request) {
      if (!safe || !isPhase1Collectable(request.source)) {
        return Promise.resolve({
          evidences: [],
          missing: request.required ? [request] : [],
        });
      }
      return Promise.reject(
        new Error(`adapter ${id} is not wired to a store in Phase 1 increment 1`),
      );
    },
  };
}

export function createRouteResolutionAdapterStub(): RouteResolutionEvidenceAdapter {
  const missing = routeResolutionMissingRequirement();
  return {
    id: "route_resolution",
    authority: "src/routing/resolve-route.ts",
    phase1Safe: false,
    collect() {
      return Promise.resolve({
        evidences: [],
        missing: [missing],
      });
    },
  };
}

export type SkillInvocationPassthroughRow = {
  attributionResolution?: unknown;
};

/**
 * In-memory Skill adapter: copies the recorded resolution, never invents identity_tool_name.
 */
export function createSkillInvocationPassthroughAdapter(): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("skill_invocation");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: manifest.phase1Safe,
    collect() {
      return Promise.resolve({ evidences: [], missing: [] });
    },
  };
}

export function passthroughSkillResolutions(
  rows: readonly SkillInvocationPassthroughRow[],
): AttributionResolution[] {
  return rows.map((row) => passthroughAttributionResolution(row.attributionResolution));
}

function isKnownSource(id: string): id is EvidenceSourceId {
  return (EVIDENCE_SOURCE_IDS as readonly string[]).includes(id);
}
