/**
 * Per-run inbound attachment grants for the media tools (image / pdf).
 *
 * Why this exists: Managed Enterprise forces workspace-only FS
 * (`resolveEffectiveToolFsWorkspaceOnly`, the C17 write boundary), so
 * `resolveMediaToolLocalRoots` narrows the media tools to the agent workspace.
 * Webchat attachments, however, are saved to the process-global
 * `<stateDir>/media/webchat-uploads/` by the gateway, which is outside every
 * agent workspace — so a managed agent could not read any attachment the user
 * had just uploaded (observed as `Local media path is not under an allowed
 * directory` on every webchat PDF/image).
 *
 * Widening the allowlist to `<stateDir>/media` would hand every tenant's agent a
 * read primitive over a directory shared by all tenants. Instead the turn that
 * owns the attachments registers their EXACT paths against its runId, and the
 * media tools grant just those files. Arbitrary paths outside the workspace stay
 * refused, so the workspace-only contract is unchanged.
 *
 * This mirrors the existing run-keyed handoff used for model sets
 * (`rememberRunModelSet` / `lookupRunModelAllowlist`), which the media tools
 * already read through `agentRunId`.
 */

import path from "node:path";

/** Bound the map so a leaked runId cannot grow it without limit. */
const MAX_TRACKED_RUNS = 256;

const grantsByRunId = new Map<string, string[]>();

function normalizePaths(paths: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const candidate of paths) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    // Only local filesystem paths are grantable; URLs are fetched over the network
    // and never consulted against localRoots.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      continue;
    }
    seen.add(path.resolve(trimmed));
  }
  return [...seen];
}

/**
 * Grant this run's inbound attachments to the media tools.
 *
 * Paths are resolved but NOT verified to exist: a missing file still fails later
 * in the media loader, and this registry must not do filesystem probing on the
 * reply hot path. Re-registering a runId replaces the previous grant.
 */
export function rememberInboundMediaGrants(
  runId: string | null | undefined,
  paths: readonly (string | null | undefined)[] | undefined,
): void {
  const key = runId?.trim();
  if (!key || !paths || paths.length === 0) {
    return;
  }
  const normalized = normalizePaths(paths);
  if (normalized.length === 0) {
    return;
  }
  // Evict the oldest entry when full (insertion-ordered Map).
  if (!grantsByRunId.has(key) && grantsByRunId.size >= MAX_TRACKED_RUNS) {
    const oldest = grantsByRunId.keys().next();
    if (!oldest.done) {
      grantsByRunId.delete(oldest.value);
    }
  }
  grantsByRunId.set(key, normalized);
}

/** Copy of the granted paths. Unknown run → empty (never a wildcard). */
export function lookupInboundMediaGrants(runId: string | null | undefined): string[] {
  const key = runId?.trim();
  if (!key) {
    return [];
  }
  const granted = grantsByRunId.get(key);
  return granted ? [...granted] : [];
}

export function forgetInboundMediaGrants(runId: string | null | undefined): void {
  const key = runId?.trim();
  if (key) {
    grantsByRunId.delete(key);
  }
}

export function resetInboundMediaGrantsForTest(): void {
  grantsByRunId.clear();
}
