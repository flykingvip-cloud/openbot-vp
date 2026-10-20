/**
 * Stable, tenant-isolated runtime model ids for enterprise BYOK assets.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/design.md` §1.2
 */

import { createHash } from "node:crypto";

/** Short opaque hash — not the raw tenantId (avoids leaking tenant identity upstream). */
export function connectionShortHash(tenantId: string, connectionId: string): string {
  return createHash("sha256")
    .update(`${tenantId.trim()}:${connectionId.trim()}`)
    .digest("hex")
    .slice(0, 10);
}

export function canonicalizeUpstreamModelId(upstreamModelId: string): string {
  return upstreamModelId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * runtimeModelId format: `ent/<connectionShort>/<upstreamCanonical>`
 * Collision-safe across tenants with identical upstream ids.
 */
export function buildRuntimeModelId(params: {
  tenantId: string;
  connectionId: string;
  upstreamModelId: string;
}): string {
  const short = connectionShortHash(params.tenantId, params.connectionId);
  const upstream = canonicalizeUpstreamModelId(params.upstreamModelId);
  if (!upstream) {
    throw new Error("upstreamModelId required");
  }
  return `ent/${short}/${upstream}`;
}

export function buildCredentialRef(tenantId: string, connectionId: string): string {
  return `emc/${tenantId.trim()}/${connectionId.trim()}`;
}

export function isEnterpriseRuntimeModelId(modelId: string): boolean {
  return modelId.trim().startsWith("ent/");
}
