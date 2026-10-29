import { resolveAccountComputerWebRoute } from "../../agents/sandbox/account-computer-browser-routing.js";
import { getChatInboundDepthAgentAllowlist } from "../../gateway/chat-inbound-flags.js";
import { parseKnowledgePublishIntentFromMessage } from "../../gateway/knowledge/publish-intent.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";

export const INBOUND_DEPTH_CLASSIFIER_VERSION = "inbound-depth-v1";

export type InboundDepth = "chat" | "retrieve" | "act";

export type InboundCapabilityCeiling = {
  knowledgePrefetchAllowed: boolean;
  liveSourcesAllowed: boolean;
  maxToolMode: "none" | "read" | "write";
  maxSideEffectLevel: "none" | "reversible" | "irreversible_external";
};

export type InboundRouteStrength = "explicit" | "strong" | "weak" | "unknown";

export type InboundDepthDecision = {
  depth: InboundDepth;
  reasons: string[];
  routeStrength: InboundRouteStrength;
  ceiling: InboundCapabilityCeiling;
  classifierVersion: string;
};

export type InboundSessionKind = "employee" | "space" | "mission" | "other";

export type InboundDepthInput = {
  text: string;
  hasAttachments: boolean;
  hasLinks: boolean;
  sessionKind: InboundSessionKind;
  previousDepth?: InboundDepth;
  hasUnfinishedToolRun: boolean;
  hasExplicitKnowledgeIntent: boolean;
  hasExplicitWriteIntent: boolean;
  hasExplicitPublishIntent: boolean;
};

const CHAT_CEILING: InboundCapabilityCeiling = {
  knowledgePrefetchAllowed: false,
  liveSourcesAllowed: false,
  maxToolMode: "none",
  maxSideEffectLevel: "none",
};

const RETRIEVE_CEILING: InboundCapabilityCeiling = {
  knowledgePrefetchAllowed: true,
  liveSourcesAllowed: false,
  maxToolMode: "read",
  maxSideEffectLevel: "none",
};

const ACT_CEILING: InboundCapabilityCeiling = {
  knowledgePrefetchAllowed: true,
  liveSourcesAllowed: false,
  maxToolMode: "write",
  maxSideEffectLevel: "reversible",
};

const CONTINUATION_RE = /^(继续|然后呢|接着说|接着|continue|go on)[.。!！?？\s]*$/iu;
const KNOWLEDGE_QUERY_RE =
  /查询知识库|查(一下)?[^。！？\n]{0,16}(知识库|纪要)|检索(资料|知识)|知识库里的|search (the )?(knowledge base|kb)|look up (the )?(knowledge|notes|minutes)/iu;
const WRITE_OR_SIDE_EFFECT_RE =
  /写入工作区|写到工作区|修改文件|打开工作区里的|保存到文件|write (this )?to (the )?workspace|edit the file|create a file/iu;
const PUBLISH_NL_RE = /发布到知识库|把这份草稿发布|publish (this )?to (the )?knowledge/iu;
/**
 * Channel typeset / publish the user already asked to run. Knowledge-base
 * publish stays on PUBLISH_NL_RE. These phrases are side effects: a chat
 * classification disables tools and the turn can end on a progress sentence.
 */
const CHANNEL_TYPESET_OR_PUBLISH_RE =
  /(?:开始排版|排版(?:并|和|后)发布|帮我排版|去排版|(?:继续|接着)排版|(?:把|将)?(?:这|该|本)?(?:篇|条)?(?:文章|稿件)发布到公众号|发布到公众号|发布这篇文章|推(?:到|送|进)草稿箱|typeset and publish|publish (?:this |the )?(?:article|post|draft) to (?:wechat|weixin|the official account))/iu;
const LINK_RE = /https?:\/\//iu;

const STEWARD_ACT_INTENT_RE =
  /标记已读|标为已读|设为已读|mark (?:it )?as read|send (?:an )?email|发(?:一封|个|送)?邮件|邮件发给|提醒我|定(?:个|一下)?提醒|schedule (?:a )?reminder|创建?提醒|预订(?:一下|个)?会议|约(?:个|一下)?(?:会|会议)|定(?:个|一下)?(?:会|会议)|安排(?:一下|个)?(?:会|会议)|book (?:a )?meeting|schedule (?:a )?meeting|set up (?:a )?meeting|user_operational_identity|personal-email/iu;
const STEWARD_RETRIEVE_INTENT_RE =
  /项目风险|本周项目|风险清单|project risk|collaboration\.directory|机器人列表|数字人列表|查(?:一下|询)?[^。！？\n]{0,24}(风险|项目进展)/iu;

/**
 * Explicit runtime tool/exec (or clear "call/run exec") intents. Chat-lane
 * disableTools on these prompts empties the allow-list; models then emit body
 * DSML `exec` and the protocol gate terminates as no_tools_available.
 * Pure small-talk / "不要用工具" stall copy must stay chat.
 */
const EXPLICIT_TOOL_EXEC_RE =
  /(?:用\s*exec(?:\s*工具)?(?:\s*(?:执行|调用))?|(?:立刻|必须|再次)(?:立刻|必须|调用|用)*\s*exec|(?:调用|执行)\s*exec\b|use (?:the )?exec(?: tool)?|(?:call|run|invoke)\s+(?:the )?exec(?: tool)?)/iu;

export function shouldApplyChatLaneSkip(params: {
  routerEnabled: boolean;
  depth?: InboundDepth;
  /**
   * Steward employee turns always classify (even when ROUTER env is still off).
   * When true and depth is chat, apply the same chat-lane cuts as router mode
   * (skip knowledge identity / catalog authorize, OI lightweight, empty skill
   * filter, disableTools). SHADOW/ROUTER env defaults remain false.
   */
  stewardClassified?: boolean;
}): boolean {
  if (params.depth !== "chat") {
    return false;
  }
  return params.routerEnabled || Boolean(params.stewardClassified);
}

export function shouldApplyRetrieveKnowledgePolicy(params: {
  knowledgePolicyEnabled: boolean;
  depth?: InboundDepth;
}): boolean {
  return params.knowledgePolicyEnabled && params.depth === "retrieve";
}

export function shouldApplyRetrieveToolPolicy(params: {
  toolPolicyEnabled: boolean;
  depth?: InboundDepth;
}): boolean {
  return params.toolPolicyEnabled && params.depth === "retrieve";
}

export function allowedKnowledgeSourcesForCeiling(
  ceiling: InboundCapabilityCeiling,
): Array<"personal" | "enterprise" | "data"> {
  return ceiling.liveSourcesAllowed
    ? ["personal", "enterprise", "data"]
    : ["personal", "enterprise"];
}

const EXPLICIT_LIVE_RE =
  /实时数据|实时行情|live (source|api|data)|调用(一下)?(接口|api)|外部\s*api|invoke (the )?(live |external )?(api|source)/iu;

export function detectExplicitLiveIntent(text: string): boolean {
  return EXPLICIT_LIVE_RE.test(text.trim());
}

export function ceilingForDepth(depth: InboundDepth): InboundCapabilityCeiling {
  if (depth === "act") {
    return { ...ACT_CEILING };
  }
  if (depth === "retrieve") {
    return { ...RETRIEVE_CEILING };
  }
  return { ...CHAT_CEILING };
}

export function resolveInboundSessionKind(
  sessionKey: string | undefined | null,
): InboundSessionKind {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return "other";
  }
  if (parsed.rest.startsWith("employee:")) {
    return "employee";
  }
  if (parsed.rest.startsWith("space:")) {
    return "space";
  }
  if (parsed.rest && !parsed.rest.startsWith("main")) {
    return "mission";
  }
  return "other";
}

export function isInboundDepthEmployeeStewardSession(params: {
  sessionKey: string;
  agentId?: string | null;
  // Additional agentIds (besides "main") in scope; defaults to the configured allowlist.
  allowlist?: string[];
}): boolean {
  const kind = resolveInboundSessionKind(params.sessionKey);
  const agentId = params.agentId?.trim().toLowerCase();
  const allowlist = params.allowlist ?? getChatInboundDepthAgentAllowlist();

  // Main steward: per-employee personal steward sessions (agent:main:employee:<id>).
  // Unchanged behavior: main/empty is always in scope; an allowlisted agent that
  // ever produced an employee-scoped key is also in scope.
  if (kind === "employee") {
    return !agentId || agentId === "main" || allowlist.includes(agentId);
  }

  // Allowlisted custom assistant: only its PRIMARY personal session
  // (agent:<id>:main, i.e. rest === "main"). Space/group/mission keys have
  // rest !== "main" (e.g. "main:space:<group>"), so they stay excluded and
  // collaboration-space isolation is preserved. Main is never brought in here.
  if (agentId && agentId !== "main" && allowlist.includes(agentId)) {
    return parseAgentSessionKey(params.sessionKey)?.rest === "main";
  }

  return false;
}

export function detectInboundLinks(text: string): boolean {
  return LINK_RE.test(text);
}

export function isInboundContinuation(text: string): boolean {
  return CONTINUATION_RE.test(text.trim());
}

function extractUserTextFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const rec = message as Record<string, unknown>;
  const role = typeof rec.role === "string" ? rec.role.trim().toLowerCase() : "";
  if (role !== "user") {
    return undefined;
  }
  if (typeof rec.content === "string") {
    const text = rec.content.trim();
    return text || undefined;
  }
  if (!Array.isArray(rec.content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of rec.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as Record<string, unknown>;
    if (typed.type === "text" && typeof typed.text === "string" && typed.text.trim()) {
      parts.push(typed.text.trim());
    }
  }
  const text = parts.join("\n").trim();
  return text || undefined;
}

/**
 * Derive the last non-continuation user turn's depth from persisted transcript.
 * Skips continuation utterances so restart/multi-worker shadow stays stable.
 */
export function derivePreviousInboundDepthFromMessages(
  messages: readonly unknown[],
): InboundDepth | undefined {
  const userTexts: string[] = [];
  for (const message of messages) {
    const text = extractUserTextFromMessage(message);
    if (text) {
      userTexts.push(text);
    }
  }
  for (let index = userTexts.length - 1; index >= 0; index -= 1) {
    const text = userTexts[index];
    if (!text || isInboundContinuation(text)) {
      continue;
    }
    return classifyInboundDepth({
      text,
      hasAttachments: false,
      hasLinks: detectInboundLinks(text),
      sessionKind: "employee",
      hasUnfinishedToolRun: false,
      hasExplicitKnowledgeIntent: false,
      hasExplicitWriteIntent: false,
      hasExplicitPublishIntent: false,
    }).depth;
  }
  return undefined;
}

const TOOL_CALL_TYPES = new Set(["toolcall", "tooluse", "functioncall", "tool_use", "tool_call"]);
const TOOL_RESULT_TYPES = new Set(["toolresult", "tool_result", "tool_result_error"]);

function collectToolCallIds(message: unknown): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const rec = message as Record<string, unknown>;
  const ids: string[] = [];
  const content = rec.content;
  if (!Array.isArray(content)) {
    return ids;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as Record<string, unknown>;
    const type = typeof typed.type === "string" ? typed.type.trim().toLowerCase() : "";
    if (!TOOL_CALL_TYPES.has(type)) {
      continue;
    }
    if (typeof typed.id === "string" && typed.id) {
      ids.push(typed.id);
    }
  }
  return ids;
}

function collectToolResultIds(message: unknown): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const rec = message as Record<string, unknown>;
  const ids: string[] = [];
  const pushId = (value: unknown) => {
    if (typeof value === "string" && value) {
      ids.push(value);
    }
  };
  const role = typeof rec.role === "string" ? rec.role.trim().toLowerCase() : "";
  if (role === "toolresult" || role === "tool") {
    pushId(rec.toolCallId);
    pushId(rec.tool_call_id);
    pushId(rec.toolUseId);
    pushId(rec.tool_use_id);
  }
  const content = rec.content;
  if (!Array.isArray(content)) {
    return ids;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as Record<string, unknown>;
    const type = typeof typed.type === "string" ? typed.type.trim().toLowerCase() : "";
    if (!TOOL_RESULT_TYPES.has(type)) {
      continue;
    }
    pushId(typed.toolCallId);
    pushId(typed.tool_call_id);
    pushId(typed.toolUseId);
    pushId(typed.tool_use_id);
    pushId(typed.id);
  }
  return ids;
}

/** True when transcript has a tool call without a matching tool result. */
export function hasUnfinishedToolRunInMessages(messages: readonly unknown[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    for (const id of collectToolCallIds(message)) {
      pending.add(id);
    }
    for (const id of collectToolResultIds(message)) {
      pending.delete(id);
    }
  }
  return pending.size > 0;
}

function decision(
  depth: InboundDepth,
  reasons: string[],
  routeStrength: InboundRouteStrength,
): InboundDepthDecision {
  return {
    depth,
    reasons,
    routeStrength,
    ceiling: ceilingForDepth(depth),
    classifierVersion: INBOUND_DEPTH_CLASSIFIER_VERSION,
  };
}

export function classifyInboundDepth(input: InboundDepthInput): InboundDepthDecision {
  try {
    const text = input.text.trim();
    const publishFromParser = Boolean(parseKnowledgePublishIntentFromMessage(text));
    const explicitPublish =
      input.hasExplicitPublishIntent || publishFromParser || PUBLISH_NL_RE.test(text);
    const explicitWrite = input.hasExplicitWriteIntent || WRITE_OR_SIDE_EFFECT_RE.test(text);
    const channelTypesetOrPublish = CHANNEL_TYPESET_OR_PUBLISH_RE.test(text);
    const explicitKnowledge = input.hasExplicitKnowledgeIntent || KNOWLEDGE_QUERY_RE.test(text);

    if (explicitPublish) {
      return decision(
        "act",
        ["explicit_publish_intent"],
        publishFromParser ? "explicit" : "strong",
      );
    }
    if (explicitWrite) {
      return decision("act", ["explicit_write_or_side_effect"], "strong");
    }
    if (channelTypesetOrPublish) {
      return decision("act", ["execution_typeset_or_channel_publish"], "strong");
    }
    if (EXPLICIT_TOOL_EXEC_RE.test(text)) {
      return decision("act", ["explicit_tool_exec_intent"], "strong");
    }
    if (explicitKnowledge) {
      return decision("retrieve", ["explicit_knowledge_query"], "strong");
    }
    const accountComputerRoute = resolveAccountComputerWebRoute(text);
    if (accountComputerRoute === "public_fetch" || accountComputerRoute === "public_search") {
      return decision("retrieve", ["public_web_tool"], "strong");
    }
    if (accountComputerRoute === "account_computer") {
      return decision("act", ["account_computer_browser"], "strong");
    }
    if (input.sessionKind === "employee") {
      if (STEWARD_ACT_INTENT_RE.test(text)) {
        return decision("act", ["steward_operational_intent"], "strong");
      }
      if (STEWARD_RETRIEVE_INTENT_RE.test(text)) {
        return decision("retrieve", ["steward_knowledge_intent"], "strong");
      }
    }
    if (
      CONTINUATION_RE.test(text) &&
      input.hasUnfinishedToolRun &&
      (input.previousDepth === "retrieve" || input.previousDepth === "act")
    ) {
      return decision(input.previousDepth, ["continuation_unfinished_tool"], "weak");
    }
    if (input.hasAttachments && !explicitWrite && !explicitPublish) {
      return decision("chat", ["attachments_without_task_verb"], "unknown");
    }
    if (input.hasLinks && !explicitKnowledge) {
      return decision("chat", ["default_chat"], "unknown");
    }
    return decision("chat", ["default_chat"], "unknown");
  } catch {
    return decision("chat", ["classify_error"], "unknown");
  }
}
