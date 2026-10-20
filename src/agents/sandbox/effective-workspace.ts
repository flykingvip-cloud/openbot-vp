/**
 * Resolve the host workspace root tools and cwd should use for a sandbox turn.
 *
 * Account Computer / account-worker mounts the operators SoT at
 * `/account/workspace`. Session `resolvedWorkspace` may still be the retired
 * tenants path; coding tools, exec workspaceOnly, and shared-fs INTERSECT must
 * use the same host directory that is bound into the container.
 */
import { ACCOUNT_EXEC_WORKSPACE } from "./account-mounts.js";

export type EffectiveSandboxWorkspaceInput = {
  enabled: boolean;
  workspaceAccess: string;
  workspaceDir: string;
  containerWorkdir: string;
};

export function isAccountExecWorkspaceMount(containerWorkdir: string | undefined): boolean {
  return (containerWorkdir?.trim() ?? "") === ACCOUNT_EXEC_WORKSPACE;
}

/**
 * Prefer the account mount host path when the sandbox uses `/account/workspace`.
 * Otherwise keep the historical rw → resolvedWorkspace / ro → sandbox copy rule.
 */
export function resolveEffectiveSandboxWorkspaceDir(params: {
  resolvedWorkspace: string;
  sandbox: EffectiveSandboxWorkspaceInput | null | undefined;
}): string {
  const sandbox = params.sandbox;
  if (!sandbox?.enabled) {
    return params.resolvedWorkspace;
  }
  if (isAccountExecWorkspaceMount(sandbox.containerWorkdir)) {
    return sandbox.workspaceDir;
  }
  return sandbox.workspaceAccess === "rw" ? params.resolvedWorkspace : sandbox.workspaceDir;
}
