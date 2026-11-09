import { qualifyTurn } from "../../conversation-task/qualification.js";
import type { ConversationTurnInput, QualificationResult } from "../../conversation-task/types.js";
import type { AnyAgentTool } from "../pi-tools.types.js";
import { formatActiveSkillGlossary } from "../skill-gates/glossary.js";
import { evaluateConfirmationGate } from "./confirmation-gate.js";
import {
  assertDeliveryStageSend,
  assertExecutionStageTool,
  deliveryStageToolNames,
  assertNotedArtifactNonEmpty,
  noteDeliveryArtifactPath,
  pathFromToolArgs,
} from "./delivery.js";
import { classifyExecutionFailure, SkillContractViolationError } from "./failure.js";
import { emitExecutionDisciplineObservation, markFirstToolStarted } from "./observability.js";
import { gateProductionCanaryContract } from "./production-validators.js";
import { readSkillContract, triggerMatches, type SkillRuntimeContract } from "./skill-contract.js";
import { nextAttemptNumber, recordExecutionTrace } from "./trace.js";
import type { ExecutionEvent, ExecutionPreflight, IntentClass, ToolVisibility } from "./types.js";
import { isTrustedValidatorRegistered, recordExecutionDecision } from "./validation.js";

export type PreflightSkillInput = {
  name: string;
  frontmatter?: Record<string, string>;
  disabled?: boolean;
};

export type BuildExecutionPreflightInput = {
  taskId: string;
  sessionId: string;
  message: string;
  skills: PreflightSkillInput[];
  /** Tools that survived allow/deny and inbound policy. */
  policyToolNames: string[];
  /** Catalog names used only to tell "not visible" from "visible but denied". */
  catalogToolNames?: string[];
  inboundDepth?: "chat" | "retrieve" | "act";
  resourceScope?: string[];
  qualify?: (input: ConversationTurnInput) => QualificationResult;
};

const EXEC_LIKE = new Set(["exec", "bash", "write", "edit", "process"]);

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function mapIntent(params: {
  qualificationKind: string;
  inboundDepth?: BuildExecutionPreflightInput["inboundDepth"];
  contract?: SkillRuntimeContract;
}): IntentClass {
  if (params.qualificationKind === "long_running_candidate") {
    return "long_running";
  }
  if (params.inboundDepth === "retrieve") {
    return "retrieve";
  }
  if (params.contract && params.contract.requiredConfirmations.length > 0) {
    return "multi_stage";
  }
  if (
    params.qualificationKind === "short_action" ||
    params.qualificationKind === "reminder" ||
    params.qualificationKind === "scheduled_action"
  ) {
    return "short_action";
  }
  return "chat";
}

function contractsFor(skills: PreflightSkillInput[]): SkillRuntimeContract[] {
  const contracts: SkillRuntimeContract[] = [];
  for (const skill of skills) {
    const contract = readSkillContract(skill.name, skill.frontmatter);
    const gated = contract ? gateProductionCanaryContract(contract) : undefined;
    if (gated) {
      contracts.push(gated);
    }
  }
  return contracts;
}

function resolvePrimary(params: {
  message: string;
  skills: PreflightSkillInput[];
  contracts: SkillRuntimeContract[];
}): {
  primary?: SkillRuntimeContract;
  aliases: string[];
  candidates: string[];
  decisionCode: string;
} {
  const byId = new Map(
    params.contracts.map((contract) => [contract.skillId.toLowerCase(), contract]),
  );
  const named: SkillRuntimeContract[] = [];
  for (const contract of params.contracts) {
    const names = [contract.skillId, ...contract.aliases];
    if (names.some((name) => triggerMatches(params.message, name))) {
      named.push(contract);
    }
  }
  const triggered =
    named.length > 0
      ? named
      : params.contracts.filter((contract) =>
          contract.triggers.some((trigger) => triggerMatches(params.message, trigger)),
        );
  const candidates = unique(triggered.map((contract) => contract.skillId));
  const collapsed = new Map<string, { contract: SkillRuntimeContract; viaAlias: boolean }>();
  const aliases: string[] = [];
  for (const contract of triggered) {
    if (contract.aliasOf) {
      const target = byId.get(contract.aliasOf.toLowerCase());
      if (!target) {
        // Target missing from this bot's skill set when only an alias is installed.
        // Degrade: keep the alias as primary
        // instead of skill_alias_unresolved clarification/DM stop.
        aliases.push(contract.skillId);
        collapsed.set(contract.skillId.toLowerCase(), {
          contract,
          viaAlias: true,
        });
        continue;
      }
      aliases.push(contract.skillId);
      collapsed.set(target.skillId.toLowerCase(), { contract: target, viaAlias: true });
      continue;
    }
    collapsed.set(contract.skillId.toLowerCase(), {
      contract,
      viaAlias: collapsed.get(contract.skillId.toLowerCase())?.viaAlias === true,
    });
  }
  if (collapsed.size === 0) {
    return { aliases, candidates: [], decisionCode: "no_skill_contract" };
  }
  if (collapsed.size > 1) {
    return { aliases, candidates, decisionCode: "skill_ambiguous" };
  }
  const winner = [...collapsed.values()][0];
  const skill = params.skills.find(
    (entry) => entry.name.toLowerCase() === winner?.contract.skillId.toLowerCase(),
  );
  if (skill?.disabled) {
    return {
      primary: winner?.contract,
      aliases,
      candidates,
      decisionCode: "skill_disabled",
    };
  }
  return {
    primary: winner?.contract,
    aliases,
    candidates: unique([winner?.contract.skillId ?? "", ...candidates]),
    decisionCode: winner?.viaAlias ? "skill_alias_resolved" : "primary_skill_selected",
  };
}

export function buildExecutionPreflight(input: BuildExecutionPreflightInput): ExecutionPreflight {
  const qualify = input.qualify ?? qualifyTurn;
  const qualification = qualify({ messageId: input.taskId || "preflight", text: input.message });
  const contracts = contractsFor(input.skills);
  const resolved = resolvePrimary({ message: input.message, skills: input.skills, contracts });
  const primary = resolved.decisionCode === "skill_disabled" ? undefined : resolved.primary;
  const intentClass = mapIntent({
    qualificationKind: qualification.kind,
    inboundDepth: input.inboundDepth,
    contract: primary,
  });
  const policy = unique(input.policyToolNames);
  const catalog = unique(input.catalogToolNames ?? policy);
  const policySet = new Set(policy.map((name) => name.toLowerCase()));
  const allowed: string[] = [];
  const blocked: string[] = [];
  const toolVisibility: Record<string, ToolVisibility> = {};
  const contractAllowed = new Set((primary?.allowedTools ?? []).map((name) => name.toLowerCase()));
  const contractForbidden = new Set(
    (primary?.forbiddenTools ?? []).map((name) => name.toLowerCase()),
  );
  const restrictToContract = contractAllowed.size > 0;
  for (const name of catalog) {
    const key = name.toLowerCase();
    const inPolicy = policySet.has(key);
    if (!inPolicy) {
      toolVisibility[name] = "not_visible";
      blocked.push(name);
      continue;
    }
    if (contractForbidden.has(key) || (restrictToContract && !contractAllowed.has(key))) {
      toolVisibility[name] = "execution_denied";
      blocked.push(name);
      continue;
    }
    toolVisibility[name] = "visible";
    allowed.push(name);
  }
  for (const name of policy) {
    if (!toolVisibility[name]) {
      const key = name.toLowerCase();
      if (contractForbidden.has(key) || (restrictToContract && !contractAllowed.has(key))) {
        toolVisibility[name] = "execution_denied";
        blocked.push(name);
      } else {
        toolVisibility[name] = "visible";
        allowed.push(name);
      }
    }
  }
  let decisionCode = resolved.decisionCode;
  const missingValidator = (primary?.requiredValidators ?? []).find(
    (id) => !isTrustedValidatorRegistered(id),
  );
  if (
    missingValidator &&
    decisionCode !== "skill_disabled" &&
    decisionCode !== "skill_alias_unresolved"
  ) {
    decisionCode = "validator_unavailable";
  }
  if (qualification.kind === "needs_clarification") {
    decisionCode = "goal_unclear";
  }
  if (
    decisionCode === "skill_disabled" ||
    decisionCode === "skill_ambiguous" ||
    decisionCode === "skill_alias_unresolved" ||
    decisionCode === "goal_unclear" ||
    decisionCode === "validator_unavailable"
  ) {
    const readOnly = new Set([
      "read",
      "memory_search",
      "knowledge_search",
      "knowledge_get",
      "sessions_history",
      "sessions_list",
    ]);
    const shrinking = allowed.slice();
    for (const name of shrinking) {
      if (readOnly.has(name.toLowerCase())) {
        continue;
      }
      allowed.splice(allowed.indexOf(name), 1);
      blocked.push(name);
      toolVisibility[name] = "execution_denied";
    }
  }
  const deliveryRequirements = primary
    ? unique([...primary.requiredArtifacts, ...primary.deliveryConditions])
    : [];
  const skillGlossary = formatActiveSkillGlossary({
    userText: input.message,
    boundSkillIds: primary ? [primary.skillId, ...resolved.aliases] : resolved.aliases,
    manifests: input.skills.map((skill) => ({
      skillId: skill.name,
      frontmatter: skill.frontmatter,
    })),
  });
  const bindingPrompt = [
    buildBindingPrompt({
      decisionCode,
      primary,
      aliases: resolved.aliases,
    }),
    skillGlossary,
  ]
    .filter((part) => part?.trim())
    .join("\n");
  const attemptNumber = nextAttemptNumber(input.taskId || "run");
  const preflight = {
    taskId: input.taskId,
    sessionId: input.sessionId,
    intentClass,
    qualificationKind: qualification.kind,
    ...(primary ? { primarySkill: primary.skillId } : {}),
    skillAliases: unique(resolved.aliases),
    candidateSkills: resolved.candidates,
    allowedTools: unique(allowed),
    blockedTools: unique(blocked),
    toolVisibility,
    resourceScope: input.resourceScope ?? [],
    stage: primary?.requiredConfirmations[0],
    deliveryRequirements,
    decisionCode,
    ...(bindingPrompt ? { bindingPrompt } : {}),
    forbiddenFinalEngines: primary?.forbiddenFinalEngines ?? [],
    requiredValidators: primary?.requiredValidators ?? [],
    requiredArtifacts: primary?.requiredArtifacts ?? [],
    requiredConfirmations: primary?.requiredConfirmations ?? [],
    generationStageTools: primary?.generationStageTools ?? [],
    deliveryStageTools: primary?.deliveryStageTools ?? [],
    ...(primary?.executionStage ? { executionStage: primary.executionStage } : {}),
    attemptNumber,
    ...(primary?.deliveryBlockedUntil
      ? { deliveryBlockedUntil: primary.deliveryBlockedUntil }
      : {}),
  };
  recordExecutionTrace({
    taskId: preflight.taskId,
    sessionId: preflight.sessionId,
    attemptNumber,
    intentClass: preflight.intentClass,
    decisionStage: "preflight",
    decisionCode,
    ...(preflight.primarySkill ? { primarySkill: preflight.primarySkill } : {}),
  });
  recordExecutionDecision(decisionCode);
  return preflight;
}

function fixedUserStop(sentence: string): string {
  return `执行约束：对用户只输出这一句，不要解释、不要翻译、不要补充步骤。\n${sentence}`;
}

function buildBindingPrompt(params: {
  decisionCode: string;
  primary?: SkillRuntimeContract;
  aliases: string[];
}): string | undefined {
  if (params.decisionCode === "goal_unclear") {
    return fixedUserStop("请补充这次要交付的具体结果。");
  }
  if (params.decisionCode === "skill_disabled") {
    return fixedUserStop("这个做法当前不可用。");
  }
  if (params.decisionCode === "skill_ambiguous") {
    return fixedUserStop("有多个做法同时命中，请指定一个。");
  }
  if (params.decisionCode === "skill_alias_unresolved") {
    return fixedUserStop("这一步有两个做法，请指定用哪一个。");
  }
  if (params.decisionCode === "validator_unavailable") {
    return fixedUserStop("这一步还不能交付。");
  }
  if (!params.primary) {
    return undefined;
  }
  const lines = [
    `执行约束：本轮主技能是 ${params.primary.skillId}。`,
    params.aliases.length > 0 ? `别名 ${params.aliases.join("、")} 已解析到该主技能。` : "",
    params.primary.primaryEngine ? `正式引擎：${params.primary.primaryEngine}。` : "",
    params.primary.forbiddenFinalEngines.length > 0
      ? `禁止把 ${params.primary.forbiddenFinalEngines.join("、")} 当作终版引擎。`
      : "",
    params.primary.primaryEngine
      ? "沙箱默认无 pip / 第三方 Python 包；缺包不是换禁止终版引擎的理由，也不得据此告诉用户无法做 PPT。用正式引擎（Node/PptxGenJS 路径）。"
      : "",
    params.primary.deliveryBlockedUntil
      ? `在 ${params.primary.deliveryBlockedUntil} 之前不要向用户宣称完成。`
      : "",
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

export function preflightEvents(preflight: ExecutionPreflight): ExecutionEvent[] {
  const base = {
    taskId: preflight.taskId,
    sessionId: preflight.sessionId,
    attemptNumber: preflight.attemptNumber,
  };
  const events: ExecutionEvent[] = [
    { ...base, name: "execution_preflight_started" },
    { ...base, name: "intent_classified", decisionCode: preflight.qualificationKind },
  ];
  if (preflight.skillAliases.length > 0 && preflight.primarySkill) {
    events.push({
      ...base,
      name: "skill_alias_resolved",
      skill: preflight.primarySkill,
      decisionCode: "skill_alias_resolved",
    });
  }
  if (preflight.primarySkill) {
    events.push({
      ...base,
      name: "primary_skill_selected",
      skill: preflight.primarySkill,
      decisionCode: preflight.decisionCode,
    });
    events.push({
      ...base,
      name: "skill_contract_bound",
      skill: preflight.primarySkill,
      decisionCode: preflight.decisionCode,
    });
  }
  events.push({ ...base, name: "tools_filtered", decisionCode: preflight.decisionCode });
  events.push({ ...base, name: "resource_scope_bound" });
  if (
    preflight.decisionCode === "goal_unclear" ||
    preflight.decisionCode === "skill_disabled" ||
    preflight.decisionCode === "validator_unavailable"
  ) {
    events.push({ ...base, name: "task_failed", decisionCode: preflight.decisionCode });
  }
  return events;
}

function argsMentionForbiddenEngine(args: unknown, engines: string[]): string | undefined {
  const blob = JSON.stringify(args ?? {}).toLowerCase();
  return engines.find((engine) => engine.trim() && blob.includes(engine.trim().toLowerCase()));
}

export function applyPreflightToTools(
  tools: AnyAgentTool[],
  preflight: ExecutionPreflight,
  options?: {
    workspaceDir?: string;
    runStartedAtMs?: number;
    runId?: string;
    sessionKey?: string;
  },
): AnyAgentTool[] {
  const allowed = new Set(preflight.allowedTools.map((name) => name.toLowerCase()));
  const visible = tools.filter((tool) => allowed.has(tool.name.toLowerCase()));
  const deliveryStage = new Set(
    deliveryStageToolNames(preflight).map((name) => name.toLowerCase()),
  );
  return visible.map((tool) => {
    const name = tool.name.toLowerCase();
    const notesPath = name === "write" || name === "edit";
    const guardsEngine = EXEC_LIKE.has(name) && preflight.forbiddenFinalEngines.length > 0;
    const gatesSend = deliveryStage.has(name);
    if ((!notesPath && !guardsEngine && !gatesSend) || !tool.execute) {
      return tool;
    }
    const execute = tool.execute.bind(tool);
    return {
      ...tool,
      execute: async (toolCallId, args, signal, onUpdate) => {
        const ttft = markFirstToolStarted({
          taskId: preflight.taskId,
          runStartedAtMs: options?.runStartedAtMs ?? Date.now(),
        });
        if (ttft !== undefined) {
          const gate = evaluateConfirmationGate({
            taskId: preflight.taskId,
            attemptNumber: preflight.attemptNumber,
            requiredConfirmations: preflight.requiredConfirmations,
          });
          emitExecutionDisciplineObservation({
            runId: options?.runId ?? preflight.taskId,
            sessionKey: options?.sessionKey,
            taskId: preflight.taskId,
            metrics: {
              timeToFirstToolMs: ttft,
              confirmationGateRequiredCount: gate.required.length,
              confirmationGatePendingCount: gate.pending.length,
            },
          });
        }
        if (notesPath) {
          assertExecutionStageTool({
            preflight,
            workspaceDir: options?.workspaceDir,
            toolName: name,
          });
        }
        if (gatesSend) {
          assertDeliveryStageSend({
            preflight,
            workspaceDir: options?.workspaceDir,
            toolName: name,
            args,
          });
        }
        const artifactPath = notesPath ? pathFromToolArgs(args) : undefined;
        const hit = guardsEngine
          ? argsMentionForbiddenEngine(args, preflight.forbiddenFinalEngines)
          : undefined;
        if (hit) {
          throw new SkillContractViolationError(
            `skill_contract_violation: forbidden engine ${hit}`,
          );
        }
        // Commit-before-note: only record a durable write path after execute succeeds.
        // Noting before write raced with stale-snapshot / soft-recover stops and left
        // 「打开成果」 chips pointing at files that were never written (HTML/PDF/etc.).
        // A success result that left a zero-byte file is a failure: no note, no chip.
        const result = await execute(toolCallId, args, signal, onUpdate);
        if (artifactPath) {
          assertNotedArtifactNonEmpty(options?.workspaceDir, artifactPath);
          noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, artifactPath);
        }
        return result;
      },
    };
  });
}

export function retryAllowedForMessage(message: string): boolean {
  return classifyExecutionFailure({ message }).retryable;
}

/**
 * Client, MCP-shaped, and skill-identity tools share the same allow set.
 * No contract: leave the lane unchanged so ordinary chat is not shrunk.
 */
export function filterLaneTools<T>(
  tools: readonly T[] | undefined,
  preflight: ExecutionPreflight,
  nameOf: (tool: T) => string,
): T[] | undefined {
  if (!tools) {
    return undefined;
  }
  const contractBound =
    Boolean(preflight.primarySkill) || preflight.decisionCode !== "no_skill_contract";
  if (!contractBound) {
    return tools.slice();
  }
  const allowed = new Set(preflight.allowedTools.map((name) => name.toLowerCase()));
  return tools.filter((tool) => allowed.has(nameOf(tool).toLowerCase()));
}
