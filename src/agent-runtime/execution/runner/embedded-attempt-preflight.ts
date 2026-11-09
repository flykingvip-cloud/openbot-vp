import { resolveOpenClawAgentDir } from "../../../agents/agent-paths.js";
import { resolveSessionAgentIds } from "../../../agents/agent-scope.js";
import {
  analyzeBootstrapBudget,
  buildBootstrapPromptWarning,
  buildBootstrapInjectionStats,
} from "../../../agents/bootstrap-budget.js";
import {
  makeBootstrapWarn,
  resolveBootstrapContextForRun,
} from "../../../agents/bootstrap-files.js";
import { isConstitutionalRuntimeShadowEnabled } from "../../../agents/execution-preflight/constitutional-runtime-shadow-gate.js";
import { observeConstitutionalRuntimeShadow } from "../../../agents/execution-preflight/constitutional-runtime-shadow-observe.js";
import {
  applyPreflightToTools,
  buildExecutionPreflight,
  filterLaneTools,
  preflightEvents,
  resolveExecutionTaskId,
  resolveSkillFrontmatter,
} from "../../../agents/execution-preflight/index.js";
import { filterClientToolDefinitionsForInboundCeiling } from "../../../agents/inbound-tool-policy.js";
import { resolveModelAuthMode } from "../../../agents/model-auth.js";
import { supportsModelTools } from "../../../agents/model-tool-support.js";
import {
  resolveBootstrapMaxChars,
  resolveBootstrapPromptTruncationWarningMode,
  resolveBootstrapTotalMaxChars,
} from "../../../agents/pi-embedded-helpers.js";
import {
  logToolSchemasForGoogle,
  sanitizeToolsForGoogle,
} from "../../../agents/pi-embedded-runner/google.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import {
  observeAttemptSkillPreparation,
  wrapCreateToolsForObservation,
} from "../../../agents/pi-embedded-runner/run/execution-router-baselines.js";
import { resolveEmbeddedAttemptToolsRaw } from "../../../agents/pi-embedded-runner/run/resolve-embedded-tools.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { resolveEmbeddedRunSkillEntries } from "../../../agents/pi-embedded-runner/skills-runtime.js";
import { collectAllowedToolNames } from "../../../agents/pi-embedded-runner/tool-name-allowlist.js";
import { createOpenClawCodingTools } from "../../../agents/pi-tools.js";
import { normalizeClientToolNamesForProvider } from "../../../agents/pi-tools.schema.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  resolveSkillsPromptForRun,
} from "../../../agents/skills.js";
import { listNodes } from "../../../agents/tools/nodes-utils.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../../../agents/workspace.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { resolveSeatTurnContext } from "../../../gateway/seat-rules/turn-context.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { collectConnectedPreferredNodeIds } from "../../../infra/operator-local-computer.js";
import { isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveAttemptFsWorkspaceOnly } from "../../capabilities/index.js";
import { renderRunSkillContext } from "../../context/index.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-state.js";
export type { EmbeddedAttemptState } from "./embedded-attempt-state.js";

export function createEmbeddedAttemptState(): EmbeddedAttemptState {
  return {
    aborted: false,
    timedOut: false,
    timedOutDuringCompaction: false,
    promptError: null,
    promptErrorSource: null,
  } as EmbeddedAttemptState;
}

/** Workspace, abort, image capability, sandbox, LaneMode, constitutional shadow, reaction guidance. */
export async function runEmbeddedAttemptPreflight(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  s.skillContextInput = {
    workspaceDir: s.effectiveWorkspace,
    config: params.config,
    skillsSnapshot: params.skillsSnapshot,
    agentId: params.agentId,
  };
  s.preparedSkillContext = {
    input: s.skillContextInput,
    selection: resolveEmbeddedRunSkillEntries(s.skillContextInput),
  };
  const phaseValue1 = s.preparedSkillContext.selection;
  s.skillEntries = phaseValue1.skillEntries;
  s.preferLiveEntries = phaseValue1.preferLiveEntries;
  s.restoreSkillEnv =
    params.skillsSnapshot && !s.preferLiveEntries
      ? applySkillEnvOverridesFromSnapshot({
          snapshot: params.skillsSnapshot,
          config: params.config,
        })
      : applySkillEnvOverrides({
          skills: s.skillEntries ?? [],
          config: params.config,
        });
  s.accountSandboxLocations =
    s.sandbox?.enabled === true && s.sandbox.containerWorkdir === "/account/workspace";
  s.skillsPrompt = renderRunSkillContext(
    s.preparedSkillContext,
    {
      runId: params.runId,
      sessionKey: params.sessionKey,
      accountSandboxLocations: s.accountSandboxLocations,
    },
    { render: resolveSkillsPromptForRun, observe: observeAttemptSkillPreparation },
  );
  s.sessionLabel = params.sessionKey ?? params.sessionId;
  const phaseValue2 = await resolveBootstrapContextForRun({
    workspaceDir: s.effectiveWorkspace,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    warn: makeBootstrapWarn({ sessionLabel: s.sessionLabel, warn: (message) => log.warn(message) }),
    contextMode: params.bootstrapContextMode,
    runKind: params.bootstrapContextRunKind,
  });
  s.hookAdjustedBootstrapFiles = phaseValue2.bootstrapFiles;
  s.contextFiles = phaseValue2.contextFiles;
  s.bootstrapMaxChars = resolveBootstrapMaxChars(params.config);
  s.bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(params.config);
  s.bootstrapAnalysis = analyzeBootstrapBudget({
    files: buildBootstrapInjectionStats({
      bootstrapFiles: s.hookAdjustedBootstrapFiles,
      injectedFiles: s.contextFiles,
    }),
    bootstrapMaxChars: s.bootstrapMaxChars,
    bootstrapTotalMaxChars: s.bootstrapTotalMaxChars,
  });
  s.bootstrapPromptWarningMode = resolveBootstrapPromptTruncationWarningMode(params.config);
  s.bootstrapPromptWarning = buildBootstrapPromptWarning({
    analysis: s.bootstrapAnalysis,
    mode: s.bootstrapPromptWarningMode,
    seenSignatures: params.bootstrapPromptWarningSignaturesSeen,
    previousSignature: params.bootstrapPromptWarningSignature,
  });
  s.workspaceNotes = s.hookAdjustedBootstrapFiles.some(
    (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
  )
    ? ["Reminder: commit your changes in this workspace after edits."]
    : undefined;
  s.agentDir = params.agentDir ?? resolveOpenClawAgentDir();
  const phaseValue3 = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
    agentId: params.agentId,
  });
  s.defaultAgentId = phaseValue3.defaultAgentId;
  s.sessionAgentId = phaseValue3.sessionAgentId;
  s.effectiveFsWorkspaceOnly = resolveAttemptFsWorkspaceOnly({
    config: params.config,
    sessionAgentId: s.sessionAgentId,
    sessionKey: params.sessionKey,
    collaborationRoundInvoked: params.collaborationRoundInvoked,
  });
  // Check if the model supports native image input
  s.modelHasVision = params.model.input?.includes("image") ?? false;
  s.operatorEmail = params.executionIdentity?.user?.trim();
  s.preferredNodeIds = [];
  try {
    s.preferredNodeIds = collectConnectedPreferredNodeIds(await listNodes({}));
  } catch {
    s.preferredNodeIds = [];
  }
  s.seatTurnForExec = await resolveSeatTurnContext({
    cfg: params.config,
    tenantId: params.executionIdentity?.enterpriseId,
    employeeId: params.executionIdentity?.platformUserId,
    ...(s.operatorEmail ? { operatorUserIdAliases: [s.operatorEmail] } : {}),
    ...(s.preferredNodeIds.length > 0 ? { preferredNodeIds: s.preferredNodeIds } : {}),
    agentId: s.sessionAgentId,
  });
  s.seatExecPreference =
    s.seatTurnForExec?.bound && s.seatTurnForExec.execPreference
      ? s.seatTurnForExec.execPreference
      : undefined;
  s.operatorComputerBindingTarget =
    s.seatTurnForExec?.bound &&
    s.seatTurnForExec.tenantId &&
    s.seatTurnForExec.seatId &&
    params.executionIdentity?.platformUserId?.trim()
      ? {
          tenantId: s.seatTurnForExec.tenantId,
          seatId: s.seatTurnForExec.seatId,
          operatorUserId: params.executionIdentity.platformUserId.trim(),
        }
      : undefined;
  s.toolConstruction = wrapCreateToolsForObservation(() => {
    const created = createOpenClawCodingTools({
      sessionFile: params.sessionFile,
      taskExecutionBinding: params.taskExecutionBinding,
      agentId: s.sessionAgentId,
      exec: {
        ...params.execOverrides,
        elevated: params.bashElevated,
        ...(s.seatExecPreference ? { seatExecPreference: s.seatExecPreference } : {}),
        ...(s.seatTurnForExec?.operatorComputerNodeId
          ? { operatorComputerNodeId: s.seatTurnForExec.operatorComputerNodeId }
          : {}),
        ...(s.seatTurnForExec?.operatorComputerAlwaysAllowDesktop
          ? { operatorComputerAlwaysAllowDesktop: true }
          : {}),
        ...(s.operatorComputerBindingTarget
          ? { operatorComputerBindingTarget: s.operatorComputerBindingTarget }
          : {}),
      },
      sandbox: s.sandbox,
      messageProvider: params.messageChannel ?? params.messageProvider,
      agentAccountId: params.agentAccountId,
      messageTo: params.messageTo,
      messageThreadId: params.messageThreadId,
      groupId: params.groupId,
      groupChannel: params.groupChannel,
      groupSpace: params.groupSpace,
      spawnedBy: params.spawnedBy,
      senderId: params.senderId,
      senderName: params.senderName,
      senderUsername: params.senderUsername,
      senderE164: params.senderE164,
      senderIsOwner: params.senderIsOwner,
      sessionKey: s.sandboxSessionKey,
      sessionId: params.sessionId,
      runId: params.runId,
      agentDir: s.agentDir,
      workspaceDir: s.effectiveWorkspace,
      // A copied-workspace sandbox (`ro` / `none`) runs this attempt in the sandbox
      // copy; subagents spawned from it still inherit the real agent workspace.
      spawnWorkspaceDir:
        s.sandbox?.enabled && s.sandbox.workspaceAccess !== "rw" ? s.resolvedWorkspace : undefined,
      config: params.config,
      abortSignal: s.runAbortController.signal,
      modelProvider: params.model.provider,
      modelId: params.modelId,
      modelContextWindowTokens: params.model.contextWindow,
      modelAuthMode: resolveModelAuthMode(params.model.provider, params.config),
      currentChannelId: params.currentChannelId,
      currentThreadTs: params.currentThreadTs,
      currentMessageId: params.currentMessageId,
      replyToMode: params.replyToMode,
      hasRepliedRef: params.hasRepliedRef,
      modelHasVision: s.modelHasVision,
      requireExplicitMessageTarget:
        params.requireExplicitMessageTarget ?? isSubagentSessionKey(params.sessionKey),
      disableMessageTool: params.disableMessageTool,
      forceWorkspaceOnly: s.effectiveFsWorkspaceOnly,
      ...inheritExecutionIdentityRunFields(params),
      inboundToolCeiling: params.inboundToolCeiling,
      knowledgeConsumeRefs: params.knowledgeConsumeRefs,
      mentionedPluginToolAllowlist: params.mentionedPluginToolAllowlist,
      omitToolNames:
        s.accountComputerRoute === "public_fetch" || s.accountComputerRoute === "public_search"
          ? ["browser"]
          : undefined,
    });
    return created;
  });
  s.toolsRaw = resolveEmbeddedAttemptToolsRaw({
    disableTools: params.disableTools,
    inboundToolCeiling: params.inboundToolCeiling,
    skillPolicy: params.skillPolicy,
    createTools: s.toolConstruction.createTools,
    // Tip B: live LaneMode mutex via active-mode registry (setLaneMode → deny write).
    agentId: s.sessionAgentId ?? params.agentId,
  });
  s.toolsEnabled = supportsModelTools(params.model);
  s.policyTools = sanitizeToolsForGoogle({
    tools: s.toolsEnabled ? s.toolsRaw : [],
    provider: params.provider,
  });
  s.executionTaskId = resolveExecutionTaskId(params.runId);
  s.executionPreflight = buildExecutionPreflight({
    taskId: s.executionTaskId,
    sessionId: params.sessionId ?? params.sessionKey ?? "session",
    message: params.prompt,
    skills: (s.skillEntries ?? []).map((entry) => ({
      name: entry.skill.name,
      frontmatter: resolveSkillFrontmatter({
        frontmatter: entry.frontmatter,
        filePath: entry.skill.filePath,
      }),
      disabled: params.skillsSnapshot?.skillBlocklist?.includes(entry.skill.name) === true,
    })),
    policyToolNames: s.policyTools.map((tool) => tool.name),
    ...(params.inboundToolCeiling?.depth === "retrieve"
      ? { inboundDepth: "retrieve" as const }
      : {}),
    resourceScope: [s.effectiveWorkspace],
  });
  s.tools = applyPreflightToTools(s.policyTools, s.executionPreflight, {
    workspaceDir: s.effectiveWorkspace,
  });
  // Constitutional runtime shadow (default off): observe the finished preflight
  // decision and nothing else. Report-only: it returns nothing, so tools,
  // decisions and delivery stay exactly as computed above. Gate off is one
  // boolean check.
  if (
    isConstitutionalRuntimeShadowEnabled(
      params.constitutionalRuntimeShadowDeps.runtimeShadowEnabled,
    )
  ) {
    try {
      observeConstitutionalRuntimeShadow(
        params.constitutionalRuntimeShadowDeps,
        s.executionPreflight,
      );
    } catch {
      // Last resort only; observe is total. Nothing here reaches the business path.
    }
  }
  if (params.runId) {
    for (const event of preflightEvents(s.executionPreflight)) {
      emitAgentEvent({
        runId: params.runId,
        stream: "lifecycle",
        data: {
          event: event.name,
          taskId: event.taskId,
          sessionId: event.sessionId,
          attemptNumber: event.attemptNumber,
          intentClass: s.executionPreflight.intentClass,
          ...(s.executionPreflight.primarySkill
            ? { primarySkill: s.executionPreflight.primarySkill }
            : {}),
          ...(event.decisionCode ? { decisionCode: event.decisionCode } : {}),
          ...(event.skill ? { skill: event.skill } : {}),
        },
      });
    }
  }
  s.ceilingClientTools = s.toolsEnabled
    ? filterClientToolDefinitionsForInboundCeiling(params.clientTools, params.inboundToolCeiling)
    : undefined;
  s.providerSafeClientTools = s.ceilingClientTools
    ? normalizeClientToolNamesForProvider(s.ceilingClientTools)
    : undefined;
  s.clientTools = filterLaneTools(
    s.providerSafeClientTools,
    s.executionPreflight,
    (tool) => tool.function.name,
  );
  s.attemptToolLanes = {
    constructed: s.toolsRaw.map((tool) => tool.name),
    afterPolicy: s.policyTools.map((tool) => tool.name),
    afterPreflight: s.tools.map((tool) => tool.name),
    client: (s.clientTools ?? []).map((tool) => tool.function.name),
  };
  s.allowedToolNames = collectAllowedToolNames({
    tools: s.tools,
    clientTools: s.clientTools,
  });
  logToolSchemasForGoogle({ tools: s.tools, provider: params.provider });
}
