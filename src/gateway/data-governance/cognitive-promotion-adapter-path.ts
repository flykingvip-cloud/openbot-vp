/**
 * Shared later-wave (and first-wave cloud) object-path resolver.
 * Write and unlink must use this helper so tenantId/region/objectKey cannot
 * escape the adapter root or another tenant's prefix.
 */
import path from "node:path";

const SAFE_ADAPTER_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

export function assertSafeAdapterPathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    path.isAbsolute(trimmed) ||
    !SAFE_ADAPTER_PATH_SEGMENT.test(trimmed)
  ) {
    throw new Error(`unsafe_object_path:${label}`);
  }
  return trimmed;
}

function assertContained(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("unsafe_object_path");
  }
}

/**
 * Resolve `{root}/{tenantId}/{region}/{objectKey}` with token checks plus
 * path.resolve/path.relative containment under both the adapter root and the
 * tenant prefix.
 */
export function resolveContainedAdapterObjectPath(params: {
  root: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  const tenantId = assertSafeAdapterPathSegment(params.tenantId, "tenantId");
  const region = assertSafeAdapterPathSegment(params.region, "region");
  const objectKey = assertSafeAdapterPathSegment(params.objectKey, "objectKey");
  const root = path.resolve(params.root);
  const tenantRoot = path.resolve(root, tenantId);
  const dest = path.resolve(root, tenantId, region, objectKey);
  assertContained(root, dest);
  assertContained(tenantRoot, dest);
  return dest;
}
