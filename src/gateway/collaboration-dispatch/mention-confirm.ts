import {
  normalizeAgentIdentifier,
  normalizeMentionIdentity,
  stripComposerQuoteBlocksForMentionScan,
} from "./mention-utils.js";
import type { CollaborationBotTarget, MentionConfirm, MentionConfirmCandidate } from "./types.js";

const OPAQUE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_MENTION_ID = /^mention-[a-z0-9]+(?:-[a-z0-9]+)+$/i;

const AFFIRMATIVE_REPLIES = new Set([
  "是",
  "是的",
  "对",
  "对的",
  "确认",
  "好",
  "好的",
  "嗯",
  "yes",
  "ok",
  "okay",
  "就是",
  "就这个",
  "就这位",
  "叫他",
  "叫她",
]);

const REJECT_REPLIES = new Set(["不是", "不对", "不要", "取消", "no", "算了"]);

export function isOpaqueMentionToken(token: string, knownIdentities: ReadonlySet<string>) {
  if (knownIdentities.has(token)) {
    return false;
  }
  return OPAQUE_UUID.test(token) || OPAQUE_MENTION_ID.test(token);
}

export function editDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = Array.from({ length: right.length + 1 }, () => 0);
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    const leftChar = left[row - 1];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = leftChar === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length] ?? 0;
}

export function typoDistanceLimit(token: string) {
  return token.length >= 6 ? 2 : 1;
}

export function formatMentionConfirmQuestion(candidates: MentionConfirmCandidate[]) {
  if (candidates.length <= 1) {
    return `【点名确认】你是想叫「${candidates[0]?.name ?? ""}」吗？回复确认即可。`;
  }
  const names = candidates.map((candidate) => `「${candidate.name}」`).join("、");
  return `【点名确认】你是想叫哪一位：${names}？回复名字确认。`;
}

export function buildMentionConfirm(params: {
  token: string;
  candidates: MentionConfirmCandidate[];
}): MentionConfirm | null {
  const unique: MentionConfirmCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of params.candidates) {
    const agentId = normalizeAgentIdentifier(candidate.agentId);
    if (!agentId || seen.has(agentId)) {
      continue;
    }
    seen.add(agentId);
    unique.push({ agentId, name: candidate.name });
  }
  if (unique.length === 0) {
    return null;
  }
  return {
    ambiguous: unique.length > 1,
    token: params.token,
    candidates: unique,
    question: formatMentionConfirmQuestion(unique),
  };
}

function identityValues(bot: CollaborationBotTarget) {
  return [bot.agentId, bot.name]
    .map((value) => normalizeMentionIdentity(value))
    .filter((value): value is string => Boolean(value && value.length >= 2));
}

export function closestBotCandidates(token: string, bots: CollaborationBotTarget[]) {
  const limit = typoDistanceLimit(token);
  const ranked: Array<{ bot: CollaborationBotTarget; distance: number; identityLength: number }> =
    [];
  for (const bot of bots) {
    let best: { distance: number; identityLength: number } | null = null;
    for (const identity of identityValues(bot)) {
      if (identity === token) {
        continue;
      }
      const distance = editDistance(token, identity);
      if (distance <= 0 || distance > limit) {
        continue;
      }
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && identity.length > best.identityLength)
      ) {
        best = { distance, identityLength: identity.length };
      }
    }
    if (best) {
      ranked.push({ bot, ...best });
    }
  }
  if (ranked.length === 0) {
    return [];
  }
  const bestDistance = Math.min(...ranked.map((entry) => entry.distance));
  const bestLength = Math.max(
    ...ranked
      .filter((entry) => entry.distance === bestDistance)
      .map((entry) => entry.identityLength),
  );
  return ranked
    .filter((entry) => entry.distance === bestDistance && entry.identityLength === bestLength)
    .map((entry) => entry.bot);
}

function isCjk(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function mentionScanText(message: string) {
  return stripComposerQuoteBlocksForMentionScan(message).replace(/@[^\s@]+/gu, " ");
}

function findNameRanges(text: string, name: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  if (isCjk(name)) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(name, from);
      if (index < 0) {
        break;
      }
      ranges.push({ start: index, end: index + name.length });
      from = index + name.length;
    }
    return ranges;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])(${escaped})(?=$|[^A-Za-z0-9])`, "giu");
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? "";
    const offset = match[0].lastIndexOf(value);
    const start = (match.index ?? 0) + Math.max(0, offset);
    ranges.push({ start, end: start + value.length });
  }
  return ranges;
}

export function findSpokenExactBots(message: string, bots: CollaborationBotTarget[]) {
  const scan = mentionScanText(message);
  const occupied = Array.from({ length: scan.length }, () => false);
  const matched: CollaborationBotTarget[] = [];
  const seen = new Set<string>();
  const ranked = [...bots].toSorted((left, right) => right.name.length - left.name.length);
  for (const bot of ranked) {
    const name = bot.name.trim();
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (name.length < 2 || !agentId || seen.has(agentId)) {
      continue;
    }
    const open = findNameRanges(scan, name).find((range) => {
      for (let index = range.start; index < range.end; index += 1) {
        if (occupied[index]) {
          return false;
        }
      }
      return true;
    });
    if (!open) {
      continue;
    }
    for (let index = open.start; index < open.end; index += 1) {
      occupied[index] = true;
    }
    seen.add(agentId);
    matched.push(bot);
  }
  return matched;
}

function bestSpokenWindow(compact: string, identity: string) {
  let best: { distance: number } | null = null;
  const sizes = [identity.length - 1, identity.length, identity.length + 1].filter(
    (size) => size >= 2 && size <= compact.length,
  );
  for (const size of sizes) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      const slice = compact.slice(index, index + size);
      const distance = editDistance(slice, identity);
      if (distance <= 0 || distance > 1) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = { distance };
      }
    }
  }
  return best;
}

export function findSpokenTypoConfirm(
  message: string,
  bots: CollaborationBotTarget[],
): MentionConfirm | null {
  const compact =
    normalizeMentionIdentity(mentionScanText(message).replace(/[，。！？!?,.:;；：]/gu, "")) ?? "";
  if (compact.length < 2) {
    return null;
  }
  const hits: Array<{ bot: CollaborationBotTarget; distance: number; identityLength: number }> = [];
  for (const bot of bots) {
    const identity = normalizeMentionIdentity(bot.name);
    if (!identity || identity.length < 3) {
      continue;
    }
    const window = bestSpokenWindow(compact, identity);
    if (!window) {
      continue;
    }
    const covers = compact.length <= identity.length + 6 || identity.length / compact.length >= 0.5;
    if (!covers) {
      continue;
    }
    hits.push({ bot, distance: window.distance, identityLength: identity.length });
  }
  if (hits.length === 0) {
    return null;
  }
  const bestDistance = Math.min(...hits.map((hit) => hit.distance));
  const bestLength = Math.max(
    ...hits.filter((hit) => hit.distance === bestDistance).map((hit) => hit.identityLength),
  );
  return buildMentionConfirm({
    token: compact,
    candidates: hits
      .filter((hit) => hit.distance === bestDistance && hit.identityLength === bestLength)
      .map((hit) => ({ agentId: hit.bot.agentId, name: hit.bot.name })),
  });
}

function transcriptText(message: unknown) {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown; text?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (typeof (message as { text?: unknown }).text === "string") {
    return (message as { text: string }).text;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function resolveMentionConfirmFollowUp(params: {
  message: string;
  recentGroupMessages?: unknown[];
  bots: CollaborationBotTarget[];
}) {
  const history = params.recentGroupMessages ?? [];
  let question = "";
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const text = transcriptText(history[index]);
    const marker = text.indexOf("【点名确认】");
    if (marker >= 0) {
      question = text.slice(marker);
      break;
    }
  }
  if (!question) {
    return null;
  }
  const names = [...question.matchAll(/「([^」]+)」/g)].map((match) => match[1] ?? "");
  const candidates = names
    .map((name) =>
      params.bots.find(
        (bot) => normalizeMentionIdentity(bot.name) === normalizeMentionIdentity(name),
      ),
    )
    .filter((bot): bot is CollaborationBotTarget => Boolean(bot));
  if (candidates.length === 0) {
    return null;
  }
  const normalized = normalizeMentionIdentity(params.message.replace(/[？?！!。.]/gu, "")) ?? "";
  if (!normalized || REJECT_REPLIES.has(normalized)) {
    return null;
  }
  const named = candidates.filter((bot) => {
    const name = normalizeMentionIdentity(bot.name);
    return name === normalized || params.message.includes(bot.name);
  });
  if (named.length > 0) {
    return named;
  }
  if (AFFIRMATIVE_REPLIES.has(normalized) && candidates.length === 1) {
    return [candidates[0]];
  }
  return null;
}
