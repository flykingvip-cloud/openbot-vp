import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { assertFreeChatExecCommandAllowed } from "../gateway/supervisor/free-chat-cli-guard.js";
import {
  PERSONAL_EMAIL_EXEC_TRANSPORT_DENIAL,
  isPersonalMailTransportCommand,
} from "../gateway/user-operational-identity-guidance.js";
import {
  type ExecAsk,
  type ExecHost,
  type ExecSecurity,
  loadExecApprovals,
} from "../infra/exec-approvals.js";
import { resolveExecSafeBinRuntimePolicy } from "../infra/exec-safe-bin-runtime-policy.js";
import { desktopSaveRunsOnNode } from "../infra/local-exec-permission.js";
import {
  decideLocalComputerHost,
  shouldSkipOperatorComputerApproval,
} from "../infra/operator-local-computer.js";
import {
  getShellPathFromLoginShell,
  resolveShellEnvFallbackTimeoutMs,
} from "../infra/shell-env.js";
import { logInfo } from "../logger.js";
import { parseAgentSessionKey, resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { markBackgrounded } from "./bash-process-registry.js";
import { resolveExecSecurityAskWithinCeiling } from "./bash-tools.exec-ceiling.js";
import { processGatewayAllowlist } from "./bash-tools.exec-host-gateway.js";
import { executeNodeHostCommand } from "./bash-tools.exec-host-node.js";
import {
  type ExecPolicyDraft,
  isExecApprovalPendingResult,
  markExecPolicyAllowed,
  runWithExecPolicyProvenance,
} from "./bash-tools.exec-policy-provenance.js";
import {
  assertProtectedGatewayProcessCommandAllowed,
  preferBoundSandboxExecHost,
  resolveConfiguredExecHost,
} from "./bash-tools.exec-protected-process.js";
import {
  DEFAULT_MAX_OUTPUT,
  DEFAULT_PATH,
  DEFAULT_PENDING_MAX_OUTPUT,
  applyPathPrepend,
  applyShellPath,
  normalizeExecAsk,
  normalizeExecHost,
  normalizeExecSecurity,
  normalizePathPrepend,
  renderExecHostLabel,
  resolveApprovalRunningNoticeMs,
  runExecProcess,
  sanitizeHostBaseEnv,
  execSchema,
  validateHostEnv,
} from "./bash-tools.exec-runtime.js";
import type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolDetails,
} from "./bash-tools.exec-types.js";
import {
  buildSandboxEnv,
  clampWithDefault,
  coerceEnv,
  readEnvInt,
  resolveSandboxWorkdir,
  resolveWorkdir,
  rewriteContainerAbsolutePathsToHostInCommand,
  rewriteGatewayAbsoluteHostPathsInCommand,
  truncateMiddle,
  clampExecWorkdirToWorkspaceRoot,
} from "./bash-tools.shared.js";
import { enrichPathMissingToolError } from "./recoverable-tool-failure.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { assertSharedFsExecMutationAllowed } from "./shared-fs-resource-policy.js";

export type { BashSandboxConfig } from "./bash-tools.shared.js";
export type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolDetails,
} from "./bash-tools.exec-types.js";

function extractScriptTargetFromCommand(
  command: string,
): { kind: "python"; relOrAbsPath: string } | { kind: "node"; relOrAbsPath: string } | null {
  const raw = command.trim();
  if (!raw) {
    return null;
  }

  // Intentionally simple parsing: we only support common forms like
  //   python file.py
  //   python3 -u file.py
  //   node --experimental-something file.js
  // If the command is more complex (pipes, heredocs, quoted paths with spaces), skip preflight.
  const pythonMatch = raw.match(/^\s*(python3?|python)\s+(?:-[^\s]+\s+)*([^\s]+\.py)\b/i);
  if (pythonMatch?.[2]) {
    return { kind: "python", relOrAbsPath: pythonMatch[2] };
  }
  const nodeMatch = raw.match(/^\s*(node)\s+(?:--[^\s]+\s+)*([^\s]+\.js)\b/i);
  if (nodeMatch?.[2]) {
    return { kind: "node", relOrAbsPath: nodeMatch[2] };
  }

  return null;
}

async function validateScriptFileForShellBleed(params: {
  command: string;
  workdir: string;
}): Promise<void> {
  const target = extractScriptTargetFromCommand(params.command);
  if (!target) {
    return;
  }

  const absPath = path.isAbsolute(target.relOrAbsPath)
    ? path.resolve(target.relOrAbsPath)
    : path.resolve(params.workdir, target.relOrAbsPath);

  // Best-effort: only validate if file exists and is reasonably small.
  let stat: { isFile(): boolean; size: number };
  try {
    await assertSandboxPath({
      filePath: absPath,
      cwd: params.workdir,
      root: params.workdir,
    });
    stat = await fs.stat(absPath);
  } catch {
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  if (stat.size > 512 * 1024) {
    return;
  }

  const content = await fs.readFile(absPath, "utf-8");

  // Common failure mode: shell env var syntax leaking into Python/JS.
  // We deliberately match all-caps/underscore vars to avoid false positives with `$` as a JS identifier.
  const envVarRegex = /\$[A-Z_][A-Z0-9_]{1,}/g;
  const first = envVarRegex.exec(content);
  if (first) {
    const idx = first.index;
    const before = content.slice(0, idx);
    const line = before.split("\n").length;
    const token = first[0];
    throw new Error(
      [
        `exec preflight: detected likely shell variable injection (${token}) in ${target.kind} script: ${path.basename(
          absPath,
        )}:${line}.`,
        target.kind === "python"
          ? `In Python, use os.environ.get(${JSON.stringify(token.slice(1))}) instead of raw ${token}.`
          : `In Node.js, use process.env[${JSON.stringify(token.slice(1))}] instead of raw ${token}.`,
        "(If this is inside a string literal on purpose, escape it or restructure the code.)",
      ].join("\n"),
    );
  }

  // Another recurring pattern from the issue: shell commands accidentally emitted as JS.
  if (target.kind === "node") {
    const firstNonEmpty = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (firstNonEmpty && /^NODE\b/.test(firstNonEmpty)) {
      throw new Error(
        `exec preflight: JS file starts with shell syntax (${firstNonEmpty}). ` +
          `This looks like a shell command, not JavaScript.`,
      );
    }
  }
}

export function createExecTool(
  defaults?: ExecToolDefaults,
  // oxlint-disable-next-line typescript/no-explicit-any
): AgentTool<any, ExecToolDetails> {
  const defaultBackgroundMs = clampWithDefault(
    defaults?.backgroundMs ?? readEnvInt("PI_BASH_YIELD_MS"),
    10_000,
    10,
    120_000,
  );
  const allowBackground = defaults?.allowBackground ?? true;
  const defaultTimeoutSec =
    typeof defaults?.timeoutSec === "number" && defaults.timeoutSec > 0
      ? defaults.timeoutSec
      : 1800;
  const defaultPathPrepend = normalizePathPrepend(defaults?.pathPrepend);
  const {
    safeBins,
    safeBinProfiles,
    trustedSafeBinDirs,
    unprofiledSafeBins,
    unprofiledInterpreterSafeBins,
  } = resolveExecSafeBinRuntimePolicy({
    local: {
      safeBins: defaults?.safeBins,
      safeBinTrustedDirs: defaults?.safeBinTrustedDirs,
      safeBinProfiles: defaults?.safeBinProfiles,
    },
    onWarning: (message) => {
      logInfo(message);
    },
  });
  if (unprofiledSafeBins.length > 0) {
    logInfo(
      `exec: ignoring unprofiled safeBins entries (${unprofiledSafeBins.toSorted().join(", ")}); use allowlist or define tools.exec.safeBinProfiles.<bin>`,
    );
  }
  if (unprofiledInterpreterSafeBins.length > 0) {
    logInfo(
      `exec: interpreter/runtime binaries in safeBins (${unprofiledInterpreterSafeBins.join(", ")}) are unsafe without explicit hardened profiles; prefer allowlist entries`,
    );
  }
  const notifyOnExit = defaults?.notifyOnExit !== false;
  const notifyOnExitEmptySuccess = defaults?.notifyOnExitEmptySuccess === true;
  const notifySessionKey = defaults?.sessionKey?.trim() || undefined;
  const approvalRunningNoticeMs = resolveApprovalRunningNoticeMs(defaults?.approvalRunningNoticeMs);
  // Derive agentId only when sessionKey is an agent session key.
  const parsedAgentSession = parseAgentSessionKey(defaults?.sessionKey);
  const agentId =
    defaults?.agentId ??
    (parsedAgentSession ? resolveAgentIdFromSessionKey(defaults?.sessionKey) : undefined);

  return {
    name: "exec",
    label: "exec",
    description:
      'Execute shell commands with background continuation. Use yieldMs/background to continue later via process tool. Use pty=true for TTY-required commands (terminal UIs, coding agents). To save a file on the user\'s Desktop, set host to node and write only "$HOME/Desktop/<file>".',
    parameters: execSchema,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const params = args as {
        command: string;
        workdir?: string;
        env?: Record<string, string>;
        yieldMs?: number;
        background?: boolean;
        timeout?: number;
        pty?: boolean;
        elevated?: boolean;
        host?: string;
        security?: string;
        ask?: string;
        node?: string;
      };

      if (!params.command) {
        throw new Error("Provide a command to start.");
      }

      assertFreeChatExecCommandAllowed({ command: params.command });
      if (isPersonalMailTransportCommand(params.command)) {
        throw new Error(PERSONAL_EMAIL_EXEC_TRANSPORT_DENIAL);
      }

      const warnings: string[] = [];
      const backgroundRequested = params.background === true;
      const yieldRequested = typeof params.yieldMs === "number";
      if (!allowBackground && (backgroundRequested || yieldRequested)) {
        warnings.push("Warning: background execution is disabled; running synchronously.");
      }
      const yieldWindow = allowBackground
        ? backgroundRequested
          ? 0
          : clampWithDefault(
              params.yieldMs ?? defaultBackgroundMs,
              defaultBackgroundMs,
              10,
              120_000,
            )
        : null;
      const elevatedDefaults = defaults?.elevated;
      const elevatedAllowed = Boolean(elevatedDefaults?.enabled && elevatedDefaults.allowed);
      const elevatedDefaultMode =
        elevatedDefaults?.defaultLevel === "full"
          ? "full"
          : elevatedDefaults?.defaultLevel === "ask"
            ? "ask"
            : elevatedDefaults?.defaultLevel === "on"
              ? "ask"
              : "off";
      const effectiveDefaultMode = elevatedAllowed ? elevatedDefaultMode : "off";
      const elevatedMode =
        typeof params.elevated === "boolean"
          ? params.elevated
            ? elevatedDefaultMode === "full"
              ? "full"
              : "ask"
            : "off"
          : effectiveDefaultMode;
      const elevatedRequested = elevatedMode !== "off";
      if (elevatedRequested) {
        if (!elevatedDefaults?.enabled || !elevatedDefaults.allowed) {
          const runtime = defaults?.sandbox ? "sandboxed" : "direct";
          const gates: string[] = [];
          const contextParts: string[] = [];
          const provider = defaults?.messageProvider?.trim();
          const sessionKey = defaults?.sessionKey?.trim();
          if (provider) {
            contextParts.push(`provider=${provider}`);
          }
          if (sessionKey) {
            contextParts.push(`session=${sessionKey}`);
          }
          if (!elevatedDefaults?.enabled) {
            gates.push("enabled (tools.elevated.enabled / agents.list[].tools.elevated.enabled)");
          } else {
            gates.push(
              "allowFrom (tools.elevated.allowFrom.<provider> / agents.list[].tools.elevated.allowFrom.<provider>)",
            );
          }
          throw new Error(
            [
              `elevated is not available right now (runtime=${runtime}).`,
              `Failing gates: ${gates.join(", ")}`,
              contextParts.length > 0 ? `Context: ${contextParts.join(" ")}` : undefined,
              "Fix-it keys:",
              "- tools.elevated.enabled",
              "- tools.elevated.allowFrom.<provider>",
              "- agents.list[].tools.elevated.enabled",
              "- agents.list[].tools.elevated.allowFrom.<provider>",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
      }
      if (elevatedRequested) {
        logInfo(`exec: elevated command ${truncateMiddle(params.command, 120)}`);
      }
      // An absent sandbox must never be treated as a sandbox execution. Doing so runs the
      // command in the gateway process namespace while skipping gateway exec approvals.
      const configuredHost = resolveConfiguredExecHost({
        configuredHost: defaults?.host,
        sandboxAvailable: Boolean(defaults?.sandbox),
      });
      const sandboxHostConfigured = defaults?.host === "sandbox";
      const requestedHost = normalizeExecHost(params.host) ?? null;
      let host: ExecHost = requestedHost ?? configuredHost;
      const localComputer = decideLocalComputerHost({
        configuredHost,
        requestedHost,
        command: params.command,
        operatorNodeId: defaults?.operatorComputerNodeId,
        elevatedRequested,
      });
      if (
        !elevatedRequested &&
        requestedHost &&
        requestedHost !== configuredHost &&
        localComputer.kind === "deny"
      ) {
        throw new Error(
          `exec host not allowed (requested ${renderExecHostLabel(requestedHost)}; ` +
            `configure tools.exec.host=${renderExecHostLabel(configuredHost)} to allow).`,
        );
      }
      const operatorNodePin = localComputer.kind === "allow" ? localComputer.pinNodeId : undefined;
      const seatExecPreference = defaults?.seatExecPreference;
      if (seatExecPreference?.host && seatExecPreference.host !== configuredHost) {
        throw new Error(
          `exec host not allowed (seat requested ${renderExecHostLabel(seatExecPreference.host)}; ` +
            `configure tools.exec.host=${renderExecHostLabel(configuredHost)} to allow).`,
        );
      }
      if (elevatedRequested) {
        host = "gateway";
      } else {
        // Bound session sandbox wins over agent tools.exec.host=gateway|node
        // (sticky or model-echoed) so shell/exec stay in aw-exec-lease.
        // Desktop local-computer allow keeps host=node.
        host = preferBoundSandboxExecHost({
          host,
          sandboxAvailable: Boolean(defaults?.sandbox),
          requestedHost,
          elevatedRequested: false,
          localComputerAllow: localComputer.kind === "allow",
        });
      }

      assertProtectedGatewayProcessCommandAllowed({
        command: params.command,
        host,
        runtimePid: process.pid,
      });

      const configuredSecurity = defaults?.security ?? (host === "sandbox" ? "deny" : "allowlist");
      const requestedSecurity = normalizeExecSecurity(params.security);
      // Keep local exec defaults in sync with exec-approvals.json when tools.exec.ask is unset.
      const configuredAsk = defaults?.ask ?? loadExecApprovals().defaults?.ask ?? "on-miss";
      const requestedAsk = normalizeExecAsk(params.ask);
      // 席位和会话只能收紧。elevated full 仍是操作者 break-glass。
      const resolvedExec = resolveExecSecurityAskWithinCeiling({
        configuredSecurity,
        configuredAsk,
        configuredHost,
        seat: seatExecPreference,
        session: {
          ...(requestedSecurity ? { security: requestedSecurity } : {}),
          ...(requestedAsk ? { ask: requestedAsk } : {}),
          ...(requestedHost ? { host: requestedHost } : {}),
        },
        elevatedRequested,
        elevatedMode,
      });
      const security = resolvedExec.security;
      let ask = resolvedExec.ask;
      let bypassApprovals = resolvedExec.bypassApprovals;
      const runtimeAskSource = resolvedExec.runtimeAskSource;
      if (
        shouldSkipOperatorComputerApproval({
          command: params.command,
          alwaysAllowDesktop: defaults?.operatorComputerAlwaysAllowDesktop,
        })
      ) {
        // Durable Always Allow for this seat↔computer: skip the Desktop card.
        ask = "off";
        bypassApprovals = true;
      }

      return runWithExecPolicyProvenance(
        {
          session_id: defaults?.sessionId?.trim() || null,
          session_key: defaults?.sessionKey?.trim() || null,
          run_id: defaults?.runId?.trim() || null,
          tool_call_id: toolCallId ?? null,
          command: params.command,
          host,
          security,
          ask,
        },
        async (policyDraft) =>
          executeResolvedExecPolicy({
            policyDraft,
            params,
            defaults,
            host,
            security,
            ask,
            sandboxHostConfigured,
            requestedHost,
            boundNodeOverride: operatorNodePin,
            warnings,
            allowBackground,
            backgroundRequested,
            yieldRequested,
            defaultTimeoutSec,
            defaultPathPrepend,
            safeBins,
            safeBinProfiles,
            trustedSafeBinDirs,
            agentId,
            notifyOnExit,
            notifyOnExitEmptySuccess,
            notifySessionKey,
            approvalRunningNoticeMs,
            signal,
            onUpdate,
            yieldWindow,
            bypassApprovals,
            runtimeAskSource,
          }),
      );
    },
  };
}

async function executeResolvedExecPolicy(params: {
  policyDraft: ExecPolicyDraft;
  params: {
    command: string;
    workdir?: string;
    env?: Record<string, string>;
    yieldMs?: number;
    background?: boolean;
    timeout?: number;
    pty?: boolean;
    elevated?: boolean;
    host?: string;
    security?: string;
    ask?: string;
    node?: string;
  };
  defaults?: ExecToolDefaults;
  host: ExecHost;
  security: ExecSecurity;
  ask: ExecAsk;
  runtimeAskSource?: "operator" | "seat" | "session";
  sandboxHostConfigured: boolean;
  requestedHost: ExecHost | null;
  /** Seat-bound node. When set, the model-supplied node is ignored. */
  boundNodeOverride?: string;
  warnings: string[];
  allowBackground: boolean;
  backgroundRequested: boolean;
  yieldRequested: boolean;
  defaultTimeoutSec: number;
  defaultPathPrepend: string[];
  safeBins: Set<string>;
  safeBinProfiles: ReturnType<typeof resolveExecSafeBinRuntimePolicy>["safeBinProfiles"];
  trustedSafeBinDirs: ReturnType<typeof resolveExecSafeBinRuntimePolicy>["trustedSafeBinDirs"];
  agentId?: string;
  notifyOnExit: boolean;
  notifyOnExitEmptySuccess: boolean;
  notifySessionKey?: string;
  approvalRunningNoticeMs: number;
  signal?: AbortSignal;
  onUpdate?: Parameters<AgentTool<typeof execSchema, ExecToolDetails>["execute"]>[3];
  execCommandOverride?: string;
  yieldWindow: number | null;
  bypassApprovals: boolean;
}): Promise<AgentToolResult<ExecToolDetails>> {
  const {
    policyDraft,
    params: toolParams,
    defaults,
    host,
    security,
    ask,
    sandboxHostConfigured,
    requestedHost,
    warnings,
    allowBackground,
    backgroundRequested,
    yieldRequested,
    defaultTimeoutSec,
    defaultPathPrepend,
    safeBins,
    safeBinProfiles,
    trustedSafeBinDirs,
    agentId,
    notifyOnExit,
    notifyOnExitEmptySuccess,
    notifySessionKey,
    approvalRunningNoticeMs,
    signal,
    onUpdate,
    bypassApprovals,
  } = params;
  const runtimeAskSource = params.runtimeAskSource;
  let execCommandOverride = params.execCommandOverride;
  const yieldWindow = params.yieldWindow;
  const maxOutput = DEFAULT_MAX_OUTPUT;
  const pendingMaxOutput = DEFAULT_PENDING_MAX_OUTPUT;

  const sandbox = host === "sandbox" ? defaults?.sandbox : undefined;
  if (host === "sandbox" && !sandbox && (sandboxHostConfigured || requestedHost === "sandbox")) {
    throw new Error(
      [
        "exec host=sandbox is configured, but sandbox runtime is unavailable for this session.",
        'Enable sandbox mode (`agents.defaults.sandbox.mode="non-main"` or `"all"`) or set tools.exec.host to "gateway"/"node".',
      ].join("\n"),
    );
  }
  const rawWorkdir = toolParams.workdir?.trim() || defaults?.cwd || process.cwd();
  let workdir = rawWorkdir;
  let containerWorkdir = sandbox?.containerWorkdir;
  // Authorization stays in the host-verifiable namespace (same direction as
  // mapContainerPathToWorkspaceRoot for file tools). Container rewrite is only
  // for docker/aw-exec-lease execution via runExecProcess.execCommand.
  let command = toolParams.command;
  let containerExecutionCommand: string | undefined;
  if (sandbox) {
    const resolved = await resolveSandboxWorkdir({
      workdir: rawWorkdir,
      sandbox,
      warnings,
    });
    workdir = resolved.hostWorkdir;
    containerWorkdir = resolved.containerWorkdir;
    // Normalize any model-emitted container mount paths back to the host root
    // before shared-fs INTERSECT, Desktop allow, and allowlist checks.
    command = rewriteContainerAbsolutePathsToHostInCommand({
      command,
      workspaceDir: sandbox.workspaceDir,
      containerWorkdir: sandbox.containerWorkdir,
    });
    // P1-2: host→container rewrite for the execution command only (not auth).
    containerExecutionCommand = rewriteGatewayAbsoluteHostPathsInCommand({
      command,
      workspaceDir: sandbox.workspaceDir,
      containerWorkdir: sandbox.containerWorkdir,
    });
  } else {
    workdir = resolveWorkdir(rawWorkdir, warnings);
  }

  // Shared-fs INTERSECT: when tools.fs.workspaceOnly is on, outside-workspace
  // mutation targets are denied here (policy owner shared-fs-resource) so
  // write-deny ⇒ exec-deny for the same path class. Not a workspace-root-guard wrap.
  // Uses host-namespace `command` + host workdir/workspaceRoot — never the
  // container-rewritten execution string.
  if (defaults?.workspaceOnly && !desktopSaveRunsOnNode(host, command)) {
    // Trusted root only — never treat model workdir as the authorization root.
    const workspaceRoot = defaults.workspaceRoot?.trim() || defaults.cwd;
    if (!workspaceRoot) {
      throw new Error(
        "exec workspaceOnly requires a server/session workspace root; model workdir alone is not trusted.",
      );
    }
    const clamped = clampExecWorkdirToWorkspaceRoot({
      workdir,
      workspaceRoot,
    });
    if (clamped.clamped) {
      // Collaboration / workspaceOnly rounds: never honor a model workdir outside the
      // authorized root — clamp to the root and keep the mutation gate meaningful.
      warnings.push(
        `Warning: workdir "${workdir}" is outside workspace root "${workspaceRoot}"; using workspace root.`,
      );
      workdir = clamped.workdir;
    } else {
      workdir = clamped.workdir;
    }
    assertSharedFsExecMutationAllowed({
      command,
      workdir,
      workspaceRoot: path.resolve(workspaceRoot),
      workspaceOnly: true,
    });
  }

  const inheritedBaseEnv = coerceEnv(process.env);
  const baseEnv = host === "sandbox" ? inheritedBaseEnv : sanitizeHostBaseEnv(inheritedBaseEnv);

  // Logic: Sandbox gets raw env. Host (gateway/node) must pass validation.
  // We validate BEFORE merging to prevent any dangerous vars from entering the stream.
  if (host !== "sandbox" && toolParams.env) {
    validateHostEnv(toolParams.env);
  }

  const mergedEnv = toolParams.env ? { ...baseEnv, ...toolParams.env } : baseEnv;

  const env = sandbox
    ? buildSandboxEnv({
        defaultPath: DEFAULT_PATH,
        paramsEnv: toolParams.env,
        sandboxEnv: sandbox.env,
        containerWorkdir: containerWorkdir ?? sandbox.containerWorkdir,
      })
    : mergedEnv;

  if (!sandbox && host === "gateway" && !toolParams.env?.PATH) {
    const shellPath = getShellPathFromLoginShell({
      env: process.env,
      timeoutMs: resolveShellEnvFallbackTimeoutMs(process.env),
    });
    applyShellPath(env, shellPath);
  }

  // `tools.exec.pathPrepend` is only meaningful when exec runs locally (gateway) or in the sandbox.
  // Node hosts intentionally ignore request-scoped PATH overrides, so don't pretend this applies.
  if (host === "node" && defaultPathPrepend.length > 0) {
    warnings.push(
      "Warning: tools.exec.pathPrepend is ignored for host=node. Configure PATH on the node host/service instead.",
    );
  } else {
    applyPathPrepend(env, defaultPathPrepend);
  }

  if (host === "node") {
    const nodeResult = await executeNodeHostCommand({
      command,
      workdir,
      env,
      requestedEnv: toolParams.env,
      requestedNode: params.boundNodeOverride ? undefined : toolParams.node?.trim(),
      boundNode: params.boundNodeOverride?.trim() || defaults?.node?.trim(),
      sessionKey: defaults?.sessionKey,
      turnSourceChannel: defaults?.messageProvider,
      turnSourceTo: defaults?.currentChannelId,
      turnSourceAccountId: defaults?.accountId,
      turnSourceThreadId: defaults?.currentThreadTs,
      agentId,
      security,
      ask,
      runtimeAskSource,
      timeoutSec: toolParams.timeout,
      defaultTimeoutSec,
      approvalRunningNoticeMs,
      warnings,
      notifySessionKey,
      trustedSafeBinDirs,
      operatorComputerBindingTarget: defaults?.operatorComputerBindingTarget,
    });
    if (!isExecApprovalPendingResult(nodeResult)) {
      markExecPolicyAllowed(policyDraft);
    }
    return nodeResult;
  }

  if (host === "gateway" && !bypassApprovals) {
    const gatewayResult = await processGatewayAllowlist({
      command,
      workdir,
      env,
      pty: toolParams.pty === true && !sandbox,
      timeoutSec: toolParams.timeout,
      defaultTimeoutSec,
      security,
      ask,
      runtimeAskSource,
      safeBins,
      safeBinProfiles,
      agentId,
      sessionKey: defaults?.sessionKey,
      turnSourceChannel: defaults?.messageProvider,
      turnSourceTo: defaults?.currentChannelId,
      turnSourceAccountId: defaults?.accountId,
      turnSourceThreadId: defaults?.currentThreadTs,
      scopeKey: defaults?.scopeKey,
      warnings,
      notifySessionKey,
      approvalRunningNoticeMs,
      maxOutput,
      pendingMaxOutput,
      trustedSafeBinDirs,
    });
    if (gatewayResult.decision === "pending" || gatewayResult.pendingResult) {
      return gatewayResult.pendingResult!;
    }
    if (gatewayResult.decision === "allowed") {
      markExecPolicyAllowed(policyDraft);
    }
    execCommandOverride = gatewayResult.execCommandOverride;
  } else {
    // Sandbox host, or elevated bypass of processGatewayAllowlist: execution is
    // allowed by the existing tools.exec host/security owner, not by wrapper return.
    markExecPolicyAllowed(policyDraft);
  }

  const explicitTimeoutSec = typeof toolParams.timeout === "number" ? toolParams.timeout : null;
  const backgroundTimeoutBypass =
    allowBackground && explicitTimeoutSec === null && (backgroundRequested || yieldRequested);
  const effectiveTimeout = backgroundTimeoutBypass
    ? null
    : (explicitTimeoutSec ?? defaultTimeoutSec);
  const getWarningText = () => (warnings.length ? `${warnings.join("\n")}\n\n` : "");
  const usePty = toolParams.pty === true && !sandbox;

  // Preflight: catch a common model failure mode (shell syntax leaking into Python/JS sources)
  // before we execute and burn tokens in cron loops.
  await validateScriptFileForShellBleed({ command, workdir });

  const run = await runExecProcess({
    // `command` remains host-verifiable for session/logging; sandbox execution
    // uses containerExecutionCommand (gateway allowlist override still wins).
    command,
    execCommand: execCommandOverride ?? containerExecutionCommand,
    workdir,
    env,
    sandbox,
    containerWorkdir,
    usePty,
    warnings,
    maxOutput,
    pendingMaxOutput,
    notifyOnExit,
    notifyOnExitEmptySuccess,
    scopeKey: defaults?.scopeKey,
    sessionKey: notifySessionKey,
    taskBoundary: defaults?.taskBoundary,
    timeoutSec: effectiveTimeout,
    onUpdate,
  });

  let yielded = false;
  let yieldTimer: NodeJS.Timeout | null = null;

  // Tool-call abort should not kill backgrounded sessions; timeouts still must.
  const onAbortSignal = () => {
    if (yielded || run.session.backgrounded) {
      return;
    }
    run.kill();
  };

  if (signal?.aborted) {
    onAbortSignal();
  } else if (signal) {
    signal.addEventListener("abort", onAbortSignal, { once: true });
  }

  return new Promise<AgentToolResult<ExecToolDetails>>((resolve, reject) => {
    const resolveRunning = () =>
      resolve({
        content: [
          {
            type: "text",
            text: `${getWarningText()}Command still running (session ${run.session.id}, pid ${
              run.session.pid ?? "n/a"
            }). Use process (list/poll/log/write/kill/clear/remove) for follow-up.`,
          },
        ],
        details: {
          status: "running",
          sessionId: run.session.id,
          pid: run.session.pid ?? undefined,
          startedAt: run.startedAt,
          cwd: run.session.cwd,
          tail: run.session.tail,
        },
      });

    const onYieldNow = () => {
      if (yieldTimer) {
        clearTimeout(yieldTimer);
      }
      if (yielded) {
        return;
      }
      yielded = true;
      markBackgrounded(run.session);
      resolveRunning();
    };

    if (allowBackground && yieldWindow !== null) {
      if (yieldWindow === 0) {
        onYieldNow();
      } else {
        yieldTimer = setTimeout(() => {
          if (yielded) {
            return;
          }
          yielded = true;
          markBackgrounded(run.session);
          resolveRunning();
        }, yieldWindow);
      }
    }

    run.promise
      .then((outcome) => {
        if (yieldTimer) {
          clearTimeout(yieldTimer);
        }
        if (yielded || run.session.backgrounded) {
          return;
        }
        if (outcome.status === "failed") {
          // Prefer server/session workspaceRoot; never advertise raw model workdir.
          const workspaceRoot = defaults?.workspaceRoot?.trim() || defaults?.cwd || undefined;
          const reason = enrichPathMissingToolError({
            errorText: outcome.reason ?? "Command failed.",
            workspaceRoot,
          });
          reject(new Error(reason));
          return;
        }
        resolve({
          content: [
            {
              type: "text",
              text: `${getWarningText()}${outcome.aggregated || "(no output)"}`,
            },
          ],
          details: {
            status: "completed",
            exitCode: outcome.exitCode ?? 0,
            durationMs: outcome.durationMs,
            aggregated: outcome.aggregated,
            cwd: run.session.cwd,
          },
        });
      })
      .catch((err) => {
        if (yieldTimer) {
          clearTimeout(yieldTimer);
        }
        if (yielded || run.session.backgrounded) {
          return;
        }
        const workspaceRoot = defaults?.workspaceRoot?.trim() || defaults?.cwd || undefined;
        const message = err instanceof Error ? err.message : String(err);
        const enriched = enrichPathMissingToolError({
          errorText: message,
          workspaceRoot,
        });
        if (enriched !== message && err instanceof Error) {
          err.message = enriched;
        }
        reject(err as Error);
      });
  });
}

export const execTool = createExecTool();
