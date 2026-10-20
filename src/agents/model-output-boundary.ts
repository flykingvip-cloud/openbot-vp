import { stripAssistantScratchpadFromText } from "../shared/text/assistant-scratchpad.js";
/**
 * Model output is not execution fact. Protocol text (DSML and similar) is not a
 * structured tool call: do not execute it, do not render it, and do not feed it
 * back as ordinary conversation history.
 */
import { findCodeRegions, isInsideCode } from "../shared/text/code-regions.js";

export type CanonicalToolCall = {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  source: "structured" | "adapter";
};

export type ProtocolKind = "dsml" | "minimax" | "special_token" | "downgraded_tool_call";

export type UserVisibleGateResult = {
  visibleText: string;
  detected: boolean;
  incomplete: boolean;
  protocol: ProtocolKind | null;
  recoveredCalls: CanonicalToolCall[];
};

export const PROTOCOL_FAILURE_USER_TEXT = "当前工具调用格式异常，我暂时无法继续执行这一步。";

/** One or two pipes: `<|DSML|` / `<｜DSML｜` and DeepSeek's `<｜｜DSML｜｜`. */
const DSML_PIPE = String.raw`[|｜]{1,2}`;
const DSML_OPEN_RE = new RegExp(`<\\s*\\/?\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_PIPE}`, "gi");

function collapseVisible(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Unclosed `<|` / `<｜...` at EOS — a split special-token or DSML tag. */
const INCOMPLETE_PIPE_TAIL_RE = /^<\s*\/?\s*[|｜][^>]*$/;
/** Bare `<` / `</` at EOS. Held so `<|DSML` cannot leak across chunks. */
const INCOMPLETE_BARE_LT_RE = /^<\s*\/?\s*$/;

function splitIncompleteProtocolTail(
  text: string,
  includeBareLt: boolean,
): { head: string; tail: string } {
  const lastLt = text.lastIndexOf("<");
  if (lastLt < 0) {
    return { head: text, tail: "" };
  }
  const tail = text.slice(lastLt);
  if (tail.includes(">")) {
    return { head: text, tail: "" };
  }
  if (INCOMPLETE_PIPE_TAIL_RE.test(tail) || (includeBareLt && INCOMPLETE_BARE_LT_RE.test(tail))) {
    return { head: text.slice(0, lastLt), tail };
  }
  return { head: text, tail: "" };
}

function parseParameterValue(raw: string, isString: boolean): unknown {
  const value = raw.trim();
  if (isString) {
    return value;
  }
  if (!value) {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseDsmlInvokeBlock(block: string, index: number): CanonicalToolCall | null {
  const nameMatch = /invoke\s+name\s*=\s*["']([^"']+)["']/i.exec(block);
  const toolName = nameMatch?.[1]?.trim();
  if (!toolName) {
    return null;
  }
  const args: Record<string, unknown> = {};
  const paramRe = new RegExp(
    String.raw`parameter\s+name\s*=\s*["']([^"']+)["'](?:[^>]*\bstring\s*=\s*["'](true|false)["'])?[^>]*>([\s\S]*?)<\s*/\s*${DSML_PIPE}\s*DSML\s*${DSML_PIPE}\s*parameter`,
    "gi",
  );
  for (const match of block.matchAll(paramRe)) {
    const key = match[1]?.trim();
    if (!key) {
      continue;
    }
    args[key] = parseParameterValue(match[3] ?? "", match[2]?.toLowerCase() !== "false");
  }
  return {
    callId: `adapter-dsml-${index}`,
    toolName,
    arguments: args,
    source: "adapter",
  };
}

function tagKind(rawAfterDsml: string): string {
  return rawAfterDsml
    .replace(/^[|\s]+/, "")
    .replace(/[|\s]+$/, "")
    .trim()
    .toLowerCase();
}

function findDsmlTag(
  text: string,
  from: number,
  codeRegions: ReturnType<typeof findCodeRegions>,
):
  | { start: number; end: number; closing: boolean; kind: string }
  | { start: number; incomplete: true }
  | null {
  DSML_OPEN_RE.lastIndex = from;
  let open = DSML_OPEN_RE.exec(text);
  while (open && isInsideCode(open.index ?? 0, codeRegions)) {
    open = DSML_OPEN_RE.exec(text);
  }
  if (!open) {
    return null;
  }
  const start = open.index ?? 0;
  const afterToken = start + open[0].length;
  const closing = /<\s*\//.test(open[0]);
  const gt = text.indexOf(">", afterToken);
  if (gt < 0) {
    return { start, incomplete: true };
  }
  const kind = tagKind(text.slice(afterToken, gt));
  return { start, end: gt + 1, closing, kind };
}

function matchingCloseKind(kind: string): string {
  return (kind.split(/\s+/)[0] ?? kind).replace(/\/$/, "");
}

function findMatchingClose(
  text: string,
  from: number,
  kind: string,
  codeRegions: ReturnType<typeof findCodeRegions>,
): number | null {
  const want = matchingCloseKind(kind);
  let cursor = from;
  while (cursor < text.length) {
    const tag = findDsmlTag(text, cursor, codeRegions);
    if (!tag) {
      return null;
    }
    if ("incomplete" in tag) {
      return null;
    }
    if (tag.closing && matchingCloseKind(tag.kind) === want) {
      return tag.end;
    }
    cursor = tag.end;
  }
  return null;
}

function stripAndParseDsml(text: string): {
  visible: string;
  detected: boolean;
  incomplete: boolean;
  recoveredCalls: CanonicalToolCall[];
} {
  DSML_OPEN_RE.lastIndex = 0;
  if (!text || !DSML_OPEN_RE.test(text)) {
    DSML_OPEN_RE.lastIndex = 0;
    return { visible: text, detected: false, incomplete: false, recoveredCalls: [] };
  }
  DSML_OPEN_RE.lastIndex = 0;
  const codeRegions = findCodeRegions(text);

  let visible = "";
  let cursor = 0;
  let incomplete = false;
  let detected = false;
  const recoveredCalls: CanonicalToolCall[] = [];

  while (cursor < text.length) {
    const tag = findDsmlTag(text, cursor, codeRegions);
    if (!tag) {
      visible += text.slice(cursor);
      break;
    }
    if ("incomplete" in tag) {
      visible += text.slice(cursor, tag.start);
      incomplete = true;
      detected = true;
      break;
    }
    visible += text.slice(cursor, tag.start);
    detected = true;
    const kindName = matchingCloseKind(tag.kind);
    if (!tag.closing && (kindName === "tool_calls" || kindName === "invoke")) {
      const closeEnd = findMatchingClose(text, tag.end, kindName, codeRegions);
      if (closeEnd == null) {
        incomplete = true;
        break;
      }
      detected = true;
      const block = text.slice(tag.start, closeEnd);
      if (kindName === "invoke") {
        const parsed = parseDsmlInvokeBlock(block, recoveredCalls.length);
        if (parsed) {
          recoveredCalls.push(parsed);
        }
      } else {
        const invokeChunks = block
          .split(new RegExp(String.raw`<\s*${DSML_PIPE}\s*DSML\s*${DSML_PIPE}\s*invoke\b`, "i"))
          .slice(1);
        for (const chunk of invokeChunks) {
          const parsed = parseDsmlInvokeBlock(`invoke ${chunk}`, recoveredCalls.length);
          if (parsed) {
            recoveredCalls.push(parsed);
          }
        }
      }
      cursor = closeEnd;
      continue;
    }
    cursor = tag.end;
  }

  return {
    visible,
    detected,
    incomplete,
    recoveredCalls,
  };
}

export function applyUserVisibleOutputGate(
  text: string,
  opts?: { streaming?: boolean },
): UserVisibleGateResult {
  if (!text) {
    return {
      visibleText: text,
      detected: false,
      incomplete: false,
      protocol: null,
      recoveredCalls: [],
    };
  }
  const { head, tail } = splitIncompleteProtocolTail(text, Boolean(opts?.streaming));
  const dsml = stripAndParseDsml(head);
  const incomplete = Boolean(tail) || dsml.incomplete;
  const detected = dsml.detected || Boolean(tail);
  if (!detected) {
    return {
      visibleText: text,
      detected: false,
      incomplete: false,
      protocol: null,
      recoveredCalls: [],
    };
  }
  return {
    visibleText: collapseVisible(dsml.visible),
    detected: true,
    incomplete,
    protocol: dsml.detected || /dsml/i.test(tail) ? "dsml" : "special_token",
    recoveredCalls: dsml.recoveredCalls,
  };
}

export function gateUserVisibleText(text: string): string {
  return applyUserVisibleOutputGate(text).visibleText;
}

/**
 * Chat fan-out merge must be allowed to shrink when protocol text is stripped.
 * Monotonic append would freeze leaked `<|DSML` into the final bubble.
 */
export function mergeAssistantVisibleText(params: {
  previousText: string;
  nextText: string;
  nextDelta?: string;
}): string {
  const previousText = params.previousText;
  const nextText = params.nextText;
  const nextDelta = params.nextDelta ?? "";
  const prevGate = applyUserVisibleOutputGate(previousText);
  const nextGate = applyUserVisibleOutputGate(nextText);
  const deltaGate = applyUserVisibleOutputGate(nextDelta);
  if (prevGate.detected || nextGate.detected || deltaGate.detected) {
    return nextGate.visibleText;
  }
  if (nextText && previousText) {
    if (nextText.startsWith(previousText)) {
      return nextText;
    }
    if (previousText.startsWith(nextText) && !nextDelta) {
      return previousText;
    }
  }
  if (nextDelta) {
    return previousText ? `${previousText}${nextDelta}` : nextDelta;
  }
  if (nextText) {
    return nextText;
  }
  return previousText;
}

export function stripProtocolTextFromAssistantContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    if (typeof content === "string") {
      const gated = applyUserVisibleOutputGate(content);
      const delivery = stripAssistantScratchpadFromText(gated.visibleText);
      if (!gated.detected && delivery === content) {
        return content;
      }
      // Protocol failure only when protocol scaffolding was present; pure scratchpad -> empty.
      if (gated.detected && !delivery.trim()) {
        return PROTOCOL_FAILURE_USER_TEXT;
      }
      return delivery;
    }
    return content;
  }
  let changed = false;
  let anyVisible = false;
  let protocolDetected = false;
  const next = content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const rec = block as Record<string, unknown>;
    if (rec.type !== "text" || typeof rec.text !== "string") {
      if (rec.type === "text") {
        return block;
      }
      // Keep process channel (e.g. type:thinking) untouched for structure;
      // dropThinkingBlocks decides whether it is fed to the model.
      anyVisible = true;
      return block;
    }
    const gated = applyUserVisibleOutputGate(rec.text);
    if (gated.detected) {
      protocolDetected = true;
    }
    const delivery = stripAssistantScratchpadFromText(gated.visibleText);
    if (!gated.detected && delivery === rec.text) {
      if (rec.text.trim()) {
        anyVisible = true;
      }
      return block;
    }
    changed = true;
    if (delivery.trim()) {
      anyVisible = true;
    }
    return { ...rec, text: delivery };
  });
  if (!changed) {
    return content;
  }
  if (!anyVisible && protocolDetected) {
    return next.map((block) => {
      if (!block || typeof block !== "object") {
        return block;
      }
      const rec = block as Record<string, unknown>;
      if (rec.type === "text") {
        return { ...rec, text: PROTOCOL_FAILURE_USER_TEXT };
      }
      return block;
    });
  }
  return next;
}

export function stripProtocolTextFromAssistantMessages<
  T extends { role?: unknown; content?: unknown },
>(messages: T[]): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }
    const content = stripProtocolTextFromAssistantContent(message.content);
    if (content === message.content) {
      return message;
    }
    changed = true;
    return { ...message, content };
  });
  return changed ? next : messages;
}
