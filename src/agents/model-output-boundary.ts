import { stripAssistantScratchpadFromText } from "../shared/text/assistant-scratchpad.js";
/**
 * Model output is not execution fact. Protocol text (DSML and similar) is not a
 * structured tool call: do not execute it, do not render it, and do not feed it
 * back as ordinary conversation history.
 */
import { findCodeRegions, isInsideCode } from "../shared/text/code-regions.js";

/** Detection hit only — `arguments` stay empty; never used to execute. */
export type CanonicalToolCall = {
  callId: string;
  toolName: string;
  /** Always empty for body-protocol detection; execution uses adapter-normalized native calls only. */
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

export const PROTOCOL_FAILURE_USER_TEXT = "本步工具调用未能执行，请重试。";

export function detectedToolNamesFromGate(gate: UserVisibleGateResult): string[] {
  return gate.recoveredCalls.map((call) => call.toolName).filter(Boolean);
}

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
/** Unclosed MiniMax marker prefix at EOS (`<minimax` / `<minimax:tool_call`). */
const INCOMPLETE_MINIMAX_TAIL_RE = /^<\s*\/?\s*minimax(?::[\w.-]*)?$/i;

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
  if (
    INCOMPLETE_PIPE_TAIL_RE.test(tail) ||
    INCOMPLETE_MINIMAX_TAIL_RE.test(tail) ||
    (includeBareLt && INCOMPLETE_BARE_LT_RE.test(tail))
  ) {
    return { head: text.slice(0, lastLt), tail };
  }
  return { head: text, tail: "" };
}

function parseDsmlInvokeBlock(block: string, index: number): CanonicalToolCall | null {
  const nameMatch = /invoke\s+name\s*=\s*["']([^"']+)["']/i.exec(block);
  const toolName = nameMatch?.[1]?.trim();
  if (!toolName) {
    return null;
  }
  // Detection-only: never carry full executable parameters (§5.4). Names suffice for observation.
  return {
    callId: `detect-dsml-${index}`,
    toolName,
    arguments: {},
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

/** MiniMax marked protocol — only when `minimax:tool_call` appears outside fences. */
function stripAndDetectMinimax(text: string): {
  visible: string;
  detected: boolean;
  incomplete: boolean;
  recoveredCalls: CanonicalToolCall[];
} {
  const codeRegions = findCodeRegions(text);
  const markerRe = /<\/?minimax:tool_call>/gi;
  let markerOutside = false;
  let markerMatch: RegExpExecArray | null;
  while ((markerMatch = markerRe.exec(text))) {
    if (!isInsideCode(markerMatch.index, codeRegions)) {
      markerOutside = true;
      break;
    }
  }
  if (!markerOutside) {
    return { visible: text, detected: false, incomplete: false, recoveredCalls: [] };
  }

  const recoveredCalls: CanonicalToolCall[] = [];
  let callIndex = 0;
  const invokeOpenRe = /<invoke\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokeOpenRe.exec(text))) {
    if (isInsideCode(invokeMatch.index, codeRegions)) {
      continue;
    }
    const toolName = invokeMatch[1]?.trim() || "";
    if (toolName) {
      recoveredCalls.push({
        callId: `detect-minimax-${callIndex}`,
        toolName,
        arguments: {},
        source: "adapter",
      });
      callIndex += 1;
    }
  }

  const openMinimax = /<minimax:tool_call>/gi;
  const closeMinimax = /<\/minimax:tool_call>/gi;
  let openCount = 0;
  let closeCount = 0;
  let m: RegExpExecArray | null;
  while ((m = openMinimax.exec(text))) {
    if (!isInsideCode(m.index, codeRegions)) {
      openCount += 1;
    }
  }
  while ((m = closeMinimax.exec(text))) {
    if (!isInsideCode(m.index, codeRegions)) {
      closeCount += 1;
    }
  }
  let incomplete = openCount > closeCount;
  if (!incomplete) {
    const openInvoke = /<invoke\b[^>]*>/gi;
    while ((m = openInvoke.exec(text))) {
      if (isInsideCode(m.index, codeRegions)) {
        continue;
      }
      const after = text.slice(m.index);
      if (!/<\/invoke>/i.test(after)) {
        incomplete = true;
        break;
      }
    }
  }

  // Char-wise strip of markers/invokes outside fences (preserve fenced examples).
  let visible = "";
  let i = 0;
  while (i < text.length) {
    if (isInsideCode(i, codeRegions)) {
      visible += text[i];
      i += 1;
      continue;
    }
    const rest = text.slice(i);
    const markerAt = rest.match(/^<\/?minimax:tool_call>/i);
    if (markerAt) {
      i += markerAt[0].length;
      continue;
    }
    const invokeAt = rest.match(/^<invoke\b[^>]*>[\s\S]*?<\/invoke>/i);
    if (invokeAt) {
      i += invokeAt[0].length;
      continue;
    }
    const truncInvoke = rest.match(/^<invoke\b[^>]*>/i);
    if (truncInvoke && !rest.toLowerCase().includes("</invoke>")) {
      break;
    }
    visible += text[i];
    i += 1;
  }

  return {
    visible: collapseVisible(visible),
    detected: true,
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
  const minimax = stripAndDetectMinimax(dsml.detected ? dsml.visible : head);
  const incomplete = Boolean(tail) || dsml.incomplete || minimax.incomplete;
  const detected = dsml.detected || minimax.detected || Boolean(tail);
  if (!detected) {
    return {
      visibleText: text,
      detected: false,
      incomplete: false,
      protocol: null,
      recoveredCalls: [],
    };
  }
  let protocol: ProtocolKind | null = null;
  if (minimax.detected || /minimax/i.test(tail)) {
    protocol = "minimax";
  } else if (dsml.detected || /dsml/i.test(tail)) {
    protocol = "dsml";
  } else {
    protocol = "special_token";
  }
  const visibleSource = minimax.detected ? minimax.visible : dsml.visible;
  return {
    visibleText: collapseVisible(visibleSource),
    detected: true,
    incomplete,
    protocol,
    recoveredCalls: [...dsml.recoveredCalls, ...minimax.recoveredCalls],
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
