import type { InteractionExecutionRequest } from "../contracts/interaction.js";

/**
 * Host admission rule for an utterance that asks to make or deliver one named file.
 * A model prose reply must not keep this turn on the chat lane.
 * Tool-ceiling classification is a different gate and does not admit work.
 */
const MAKE_OR_DELIVER_RE =
  /(?:制作|生成|创建|写成|编写|写一份|写一个|请写|帮我写|保存成|输出成|交付|create|write|generate|make|deliver)/iu;

const EXPLICIT_FILENAME_RE =
  /(?:文件名(?:为|是|叫)?|filename|file\s*name|named|保存为|save(?:d)?\s+as)\s*[:：为是]?\s*[`'"“”‘’]*([A-Za-z0-9][\w.-]{0,120}\.[A-Za-z0-9]{1,8})/iu;

const GOAL_MAX_CHARS = 2_000;

function explicitDeliverableFilename(message: string): string | null {
  const match = EXPLICIT_FILENAME_RE.exec(message);
  const filename = match?.[1]?.trim() ?? "";
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  return filename;
}

/** Null when the utterance is ordinary chat, a bare filename mention, or not a deliverable. */
export function hostNamedFileExecutionRequest(message: string): InteractionExecutionRequest | null {
  const text = message.trim();
  if (!text || !MAKE_OR_DELIVER_RE.test(text)) {
    return null;
  }
  const filename = explicitDeliverableFilename(text);
  if (!filename) {
    return null;
  }
  return {
    goal: text.length > GOAL_MAX_CHARS ? text.slice(0, GOAL_MAX_CHARS) : text,
    acceptance: [`交付文件 ${filename}`],
  };
}
