/**
 * probes.ts — REAL Policy Runtime probes (Phase B 11.1a).
 *
 * Replaces the fail-closed stub (`defaultDecideFor`) with genuine enforcement
 * signals composed from the existing OpenBot infrastructure:
 *  - scope: the request already passed `authorizeGatewayMethod` to reach the
 *    handler, so the method-level scope/role/domain gate is satisfied → allowed.
 *  - allowlist: for exec-class tools, the command is analyzed (`analyzeShellCommand`)
 *    and evaluated against the agent's resolved allowlist (`evaluateExecAllowlist`).
 *  - approval: `requiresExecApproval` decides whether human approval is needed;
 *    if required and not interactively resolved here → DENY (default-safe), but
 *    NOW this is a real verdict (allowlisted commands ALLOW).
 *
 * Dependencies are injectable so this is unit-testable without reading the real
 * approvals file; defaults wire the real infra.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.3; tasks 11.1.
 */

import { evaluateExecAllowlist } from "../infra/exec-approvals-allowlist.js";
import { analyzeShellCommand } from "../infra/exec-approvals-analysis.js";
import type { ExecAllowlistEntry } from "../infra/exec-approvals.js";
import {
  requiresExecApproval,
  resolveExecApprovals,
  resolveExecApprovalsReadonly,
  type ExecAsk,
  type ExecSecurity,
} from "../infra/exec-approvals.js";
import type { RuntimeNode, ToolRequest } from "./contract.js";
import type { DecideFor } from "./gateway.js";
import type { LoomAttribution } from "./mappers.js";
import { decide, type PolicyInputs } from "./policy-runtime.js";

const EXEC_CLASS = new Set(["exec", "shell", "sh", "bash"]);

/** Resolved approvals view the probe needs (injectable for tests). */
export interface ResolvedExecApprovals {
  ask: ExecAsk;
  security: ExecSecurity;
  allowlist: ExecAllowlistEntry[];
}

export interface ExecProbeDeps {
  resolveApprovals?: (agentId?: string) => ResolvedExecApprovals;
  analyze?: typeof analyzeShellCommand;
  safeBins?: Set<string>;
}

function defaultResolveApprovals(agentId?: string): ResolvedExecApprovals {
  const r = resolveExecApprovals(agentId);
  return { ask: r.agent.ask, security: r.agent.security, allowlist: r.allowlist };
}

/**
 * WP-04 — Fabric shadow-compare / decide-only paths must inject this (or an
 * equivalent in-memory stub) so `ensureExecApprovals` never mutates the
 * approvals file during `check` / replay / dryRunDiff.
 */
export function createReadonlyResolveApprovals(): (agentId?: string) => ResolvedExecApprovals {
  return (agentId?: string) => {
    const r = resolveExecApprovalsReadonly(agentId);
    return { ask: r.agent.ask, security: r.agent.security, allowlist: r.allowlist };
  };
}

/** Build the exec-class allowlist + approval probe inputs for a request. */
export function buildExecPolicyInputs(
  command: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; agentId?: string } = {},
  deps: ExecProbeDeps = {},
): PolicyInputs {
  const resolveApprovals = deps.resolveApprovals ?? defaultResolveApprovals;
  const analyze = deps.analyze ?? analyzeShellCommand;
  const safeBins = deps.safeBins ?? new Set<string>();

  const resolved = resolveApprovals(opts.agentId);
  const analysis = analyze({ command, cwd: opts.cwd, env: opts.env });
  const evaluation = evaluateExecAllowlist({
    analysis,
    allowlist: resolved.allowlist,
    safeBins,
    cwd: opts.cwd,
  });
  // A command is "cleared" only under full security or a satisfied allowlist.
  // requiresExecApproval only governs *prompting*, not the allow/deny verdict —
  // so we must DENY allowlist-misses / security="deny" here (fail-safe), and we
  // additionally force approval when ask="always" even for cleared commands.
  const cleared = resolved.security === "full" || evaluation.allowlistSatisfied;
  const needsApproval =
    !cleared ||
    requiresExecApproval({
      ask: resolved.ask,
      security: resolved.security,
      analysisOk: analysis.ok,
      allowlistSatisfied: evaluation.allowlistSatisfied,
    });

  return {
    scope: { allowed: true }, // method already authorized upstream
    allowlist: {
      applicable: true,
      analysisOk: analysis.ok,
      satisfied: evaluation.allowlistSatisfied,
    },
    // Approval required but not interactively resolved here → DENY (fail-safe).
    approval: needsApproval ? { requiresApproval: true } : undefined,
  };
}

function nodeRequest(node: RuntimeNode) {
  return node.type === "tool" || node.type === "agent" ? node.request : undefined;
}

/**
 * Stage-2 (Governance Signals) wiring options. `attributionFor` adapts real Loom
 * output into the stable `LoomAttribution` shape **at compile time** (decide
 * time), so the signal is baked into `PolicyDecision`/decisionTrace with
 * `effect: "neutral"` — it NEVER, by itself, flips the decision (M4 / D3). The
 * resolver is injected (not read here), keeping `src/fabric` free of any runtime
 * Loom/registry lookup or `src → scripts` coupling (D2/D4).
 */
export interface ProbeDecideOptions {
  attributionFor?: (request: ToolRequest) => LoomAttribution | undefined;
}

/**
 * A real `decideFor`: exec-class tools get a genuine allowlist/approval verdict;
 * all other tools are scope-allowed (the method gate already ran upstream). A
 * compile-time Loom attribution signal (when an `attributionFor` is injected) is
 * attached to every node as a neutral Stage-2 governance signal.
 */
export function createProbeDecideFor(
  deps: ExecProbeDeps = {},
  opts: ProbeDecideOptions = {},
): DecideFor {
  return (node: RuntimeNode) => {
    const request = nodeRequest(node);
    if (!request) {
      // Non-executable node: scope-only allow (executor won't run it anyway).
      const synthetic: ToolRequest = {
        id: node.id,
        source: { type: "openbot" },
        tool: { name: "noop" },
        input: {},
        context: {},
        trace: { sessionId: "s", correlationId: node.id },
      };
      const attribution = opts.attributionFor?.(synthetic);
      return decide(synthetic, {
        scope: { allowed: true },
        ...(attribution ? { attribution } : {}),
      });
    }
    const attribution = opts.attributionFor?.(request);
    if (!EXEC_CLASS.has(request.tool.name)) {
      return decide(request, {
        scope: { allowed: true },
        ...(attribution ? { attribution } : {}),
      });
    }
    const command = (request.input.args ?? []).join(" ");
    const inputs = buildExecPolicyInputs(
      command,
      { cwd: request.input.cwd, agentId: request.source.userId },
      deps,
    );
    return decide(request, { ...inputs, ...(attribution ? { attribution } : {}) });
  };
}
