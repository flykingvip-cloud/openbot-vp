/**
 * constraints.ts — map abstract Fabric ExecutionConstraints onto concrete TOL
 * control knobs (R4, design §3.4).
 *
 * Hard rule (R4.4): this mapping NEVER relaxes an existing default safety
 * posture. Constraints are modeled as *overrides*: an undefined field means
 * "do not override the existing TOL default" (so e.g. applyPatch.workspaceOnly
 * is never implicitly flipped to false here). Only explicit, tightening intent
 * flows through.
 *
 * TOL control vocabulary mirrors the existing runtime:
 *  - ExecHost           src/infra/exec-approvals.ts  ("sandbox"|"gateway"|"node")
 *  - sandbox access     src/cli/sandbox-cli.ts        (workspaceAccess "rw"|"ro")
 *  - ToolFsPolicy       src/agents/tool-fs-policy.ts  (workspaceOnly)
 *  - AOR budget         packages/aor-core             (TaskConstraints.budgetUsd)
 */

import type { ExecutionConstraints } from "./contract.js";

/** Concrete, Fabric-internal projection of constraints onto TOL knobs. */
export interface TolControls {
  /** Where the command runs. Undefined = leave existing host default. */
  execHost?: "sandbox" | "gateway" | "node";
  /** Docker sandbox config; undefined = no sandbox override. */
  sandbox?: {
    enabled: boolean;
    workspaceAccess: "rw" | "ro";
    /** Network reachable inside the sandbox. */
    network: boolean;
  };
  /** Filesystem boundary overrides; undefined fields = leave defaults. */
  fs: {
    /** Only set to a value when tightening; never implicitly false (R4.4). */
    workspaceOnly?: boolean;
    allowedPaths?: string[];
    blockedPaths?: string[];
  };
  /** Per-process timeout in ms; undefined = no override. */
  timeoutMs?: number;
  /** AOR budget ceiling in USD; undefined = no override. */
  budgetUsd?: number;
}

/**
 * Translate ExecutionConstraints (from a PolicyDecision) into TOL control
 * overrides. Tightening-only: absence leaves the existing default untouched.
 */
export function toTolControls(c: ExecutionConstraints): TolControls {
  const controls: TolControls = { fs: {} };

  switch (c.sandboxMode) {
    case "none":
      // Run on gateway/node host without Docker isolation.
      controls.execHost = "gateway";
      break;
    case "restricted":
      controls.execHost = "sandbox";
      controls.sandbox = {
        enabled: true,
        workspaceAccess: "ro",
        // Network follows allowNetwork; restricted defaults to allowed unless denied.
        network: c.allowNetwork !== false,
      };
      break;
    case "strict":
      controls.execHost = "sandbox";
      controls.sandbox = { enabled: true, workspaceAccess: "ro", network: false };
      // strict implies a workspace-contained filesystem.
      controls.fs.workspaceOnly = true;
      break;
    // undefined: leave host/sandbox defaults untouched.
  }

  // Network: an explicit deny tightens the sandbox; an explicit allow never
  // *loosens* a strict sandbox (strict already forced network:false above).
  if (c.allowNetwork === false && controls.sandbox) {
    controls.sandbox.network = false;
  }

  // Path scoping: explicit allow/block lists flow through; presence of any
  // scope implies a workspace-bounded fs policy (tightening only).
  if (c.allowedPaths?.length) {
    controls.fs.allowedPaths = [...c.allowedPaths];
    controls.fs.workspaceOnly ??= true;
  }
  if (c.blockedPaths?.length) {
    controls.fs.blockedPaths = [...c.blockedPaths];
  }

  if (typeof c.timeoutMs === "number") {
    controls.timeoutMs = c.timeoutMs;
  }
  if (typeof c.costLimit === "number") {
    controls.budgetUsd = c.costLimit;
  }

  return controls;
}
