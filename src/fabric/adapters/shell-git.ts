/**
 * shell-git.ts — generic, repo-agnostic shell/git adapters (R8.4, task 5.3).
 *
 * These prove the ecosystem entry: a tool name registered declaratively, with
 * no OpenBot-specific paths. They still flow through the same Policy Gate +
 * allowlist/exec-approval enforcement at execution time (R8.5) — declaring an
 * adapter NEVER bypasses command safety analysis.
 *
 * `capabilities.network: false` on the git adapter is consumed by the Policy
 * Runtime to derive `allowNetwork: false` (R8.3).
 */

import type { ToolAdapter } from "../contract.js";

/** Generic shell adapter: runs an arbitrary command via the exec surface. */
export const SHELL_ADAPTER: ToolAdapter = {
  id: "generic.shell",
  match: { toolNames: ["shell", "sh", "bash"] },
  execute: { command: "exec" },
  capabilities: { fs: true, network: true, streaming: true },
};

/** Generic git adapter: `git <args>`; network off by default (local ops). */
export const GIT_ADAPTER: ToolAdapter = {
  id: "generic.git",
  match: { toolNames: ["git"] },
  execute: { command: "git", argsTemplate: ["${args}"] },
  capabilities: { fs: true, network: false, streaming: true },
};

export const GENERIC_ADAPTERS: ToolAdapter[] = [SHELL_ADAPTER, GIT_ADAPTER];
