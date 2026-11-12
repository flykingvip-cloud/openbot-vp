import { stripControlChannelForDisplay } from "./control-channel-visibility.js";

/** Presentation only. Raw task facts, tool results and execution decisions remain unchanged. */
const RUNTIME_REASONS: Readonly<Record<string, string>> = {
  "Either sessionKey or label is required": "收件人的内部会话尚未确定",
  "Session not visible from this sandboxed agent session": "当前会话无权访问收件人的对话",
  sessions_send: "内部会话发送通道",
  conversation_send: "数字人私信通道",
  sessionKey: "内部会话标识",
  source_message_not_bound: "这条消息尚未正确关联到任务",
  execution_binding_required: "成果尚未关联到本次任务，暂不能交付",
  execution_binding_incomplete: "成果与本次任务的关联信息不完整，暂不能交付",
  execution_attempt_not_current: "本次执行已被更新，旧结果未继续推进",
  execution_attempt_unreadable: "暂时无法核对本次执行状态",
  plan_gate_unconfirmed: "执行计划尚未获准，任务暂未开始",
  trusted_group_locator_required: "暂时无法确认本小组的工作空间",
  registered_no_session: "对方尚未建立可接收消息的会话",
  dispatch_ticket_incomplete: "委派内容尚不完整",
  acl_denied: "当前没有进行此操作的权限",
};

const STAGE_RECEIPT =
  /\s*[（(](?:[^\n（）()；;]*[；;]\s*)?任务已建立=(?:是|否|未知)[^\n（）()]*计划已确认=(?:是|否|未知)[）)]/g;

function projectRuntimeProse(text: string, streaming: boolean): string {
  let next = text
    .replace(STAGE_RECEIPT, "")
    .replace(/（agentId=[^（）\n]+）/g, "")
    .replace(/\bagent:[A-Za-z0-9:_-]+\b/g, "会话")
    .replace(
      /团队成果未完成（(?:execution_binding_scope|execution_attempt_unreadable):[^）]*）。/g,
      "团队成果尚未与本次有效任务关联，暂不能提交审核。",
    );
  for (const [code, description] of Object.entries(RUNTIME_REASONS)) {
    next = next.replace(new RegExp(`\\b${code}\\b`, "g"), description);
    if (streaming) {
      // A streamed machine code may end in any character; withhold its incomplete suffix.
      for (let length = code.length - 1; length > 0; length--) {
        const prefix = code.slice(0, length);
        if (next.endsWith(prefix) && !/[A-Za-z0-9_]/.test(next.at(-length - 1) ?? "")) {
          next = next.slice(0, -length);
          break;
        }
      }
    }
  }
  return next.replace(/<\/?DELIVERABLE>/gi, "");
}

/** Shared assistant projection for live deltas, final text and historical assistant bubbles. */
export function projectAssistantReplyForDisplay(
  text: string,
  opts?: { streaming?: boolean },
): string {
  const stripped = stripControlChannelForDisplay(text, opts);
  // Code/document examples are content; never rewrite identifiers within fenced examples.
  return stripped
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part) =>
      part.startsWith("```") ? part : projectRuntimeProse(part, opts?.streaming === true),
    )
    .join("")
    .trim();
}
