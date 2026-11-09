import type { ConstraintEntry, ConstraintEntryInput, TrackedTask } from "../contracts/task.js";
import { stripInboundStamp } from "./input-stamp.js";

export function normalizeConstraintEntries(
  raw: ConstraintEntryInput[] | undefined,
): ConstraintEntry[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const out: ConstraintEntry[] = [];
  for (const row of raw) {
    if (typeof row === "string") {
      const text = row.replace(/\s+/g, " ").trim();
      if (!text) {
        continue;
      }
      out.push({ text, atMs: 0, kind: "supplement" });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const text = String(row.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      continue;
    }
    out.push({
      text,
      atMs: typeof row.atMs === "number" ? row.atMs : 0,
      kind: row.kind === "revise" ? "revise" : "supplement",
      ...(row.superseded ? { superseded: true } : {}),
    });
  }
  return out;
}

/** Currently binding constraint texts (history retained separately via superseded flag). */
export function activeConstraintTexts(task: TrackedTask | undefined | null): string[] {
  return normalizeConstraintEntries(task?.effectiveConstraints)
    .filter((row) => !row.superseded)
    .map((row) => row.text);
}

export const PRIOR_UTTERANCE_CORRECTION_MAX_CHARS = 80;

/**
 * Starts a correction of the previous sentence.
 * Deliberately does not match 「另外…」 or 「新任务」 openers.
 * This is a constraint dependency, not classifyTurnRelation.
 */
export const PRIOR_UTTERANCE_CORRECTION_START_RE =
  /^(?:我(?:并)?(?:没有|没|不是|并不是)|我(?:是说|的意思是|说的是|指的是|要的是|问的是|刚才说|刚刚说)|不是|不对|并不是|并没有|错了|搞错了?|理解错了?|你(?:理解错|搞错|误会|说错|弄错|没理解|没明白|没看懂)|其实|为什么|为啥|怎么会|补充一下|再(?:解释|展开|详细)|继续)/u;

export const PRIOR_UTTERANCE_CORRECTION_ANYWHERE_RE =
  /误会了|理解错|搞错了|弄错了|不是这个意思|并没有让你|我没有让你|我没说|你说的不对/u;

/** Same prior-utterance judgment the group correction window uses. */
export function isPriorUtteranceCorrection(message: string | undefined): boolean {
  const compactText = message?.replace(/\s+/g, "").trim() ?? "";
  if (
    !compactText ||
    compactText.includes("@") ||
    compactText.length > PRIOR_UTTERANCE_CORRECTION_MAX_CHARS
  ) {
    return false;
  }
  return (
    PRIOR_UTTERANCE_CORRECTION_START_RE.test(compactText) ||
    PRIOR_UTTERANCE_CORRECTION_ANYWHERE_RE.test(compactText)
  );
}

const BARE_CONTINUE_RE =
  /^(?:请)?(?:继续|接着)(?:吧|呀|啊|喔|哦)?(?:当前(?:任务|工作)?)?[。.!！?？\s]*$/u;

export function isBareContinueCue(message: string | undefined): boolean {
  const compactText = message?.replace(/\s+/g, "").trim() ?? "";
  if (!compactText || compactText.includes("@")) {
    return false;
  }
  return BARE_CONTINUE_RE.test(compactText);
}

const CONSTRAINT_REVISION_OPENER_RE =
  /^(?:不对|错了|纠正|改为|改成|以后以|以本条为准|不要再(?:用|按|采用)?|别再)/u;

const CONSTRAINT_FULL_REPLACE_RE =
  /(?:以本条为准|全部(?:改成|改为|替换)|整体替换|废弃此前(?:全部)?(?:约束|要求|限制)?|之前的?(?:约束|要求|限制)(?:全部)?(?:作废|无效)|(?:只|仅)按本条|以后只按(?:本条|这条))/u;

/**
 * Owner revises or replaces prior same-task instructions.
 * Local revise is not a full replace. Board writes stay with the caller.
 */
export function isOwnerConstraintRevision(message: string | undefined): boolean {
  const text = stripInboundStamp(message ?? "");
  if (!text || text.startsWith("/")) {
    return false;
  }
  if (isOwnerConstraintFullReplace(text)) {
    return true;
  }
  if (isPriorUtteranceCorrection(text)) {
    return true;
  }
  const compactText = text.replace(/\s+/g, "").trim();
  return CONSTRAINT_REVISION_OPENER_RE.test(compactText);
}

/** True only for a wholesale replacement. Partial corrections stay false. */
export function isOwnerConstraintFullReplace(message: string | undefined): boolean {
  const text = stripInboundStamp(message ?? "");
  if (!text || text.startsWith("/")) {
    return false;
  }
  const compactText = text.replace(/\s+/g, "").trim();
  return CONSTRAINT_FULL_REPLACE_RE.test(compactText);
}

const OWNER_EXECUTION_BARRIER_RE =
  /(?:^|[，,。.\s])(?:先别(?:发布|发出|发送|付款|支付|下单)|不要(?:付款|支付|发布|发出|发送|下单)|别发布|禁止(?:付款|支付|发布))(?:[。.!！]?|$)/u;

export function isOwnerExecutionBarrierUtterance(message: string | undefined): boolean {
  const text = stripInboundStamp(message ?? "");
  if (!text || text.startsWith("/")) {
    return false;
  }
  return OWNER_EXECUTION_BARRIER_RE.test(text.replace(/\s+/g, ""));
}

/** Queries, bare continue, empty text, and commands are not persisted constraints. */
export function shouldPersistOwnerConstraint(message: string | undefined): boolean {
  const text = stripInboundStamp(message ?? "");
  if (!text || text.startsWith("/")) {
    return false;
  }
  if (isBareContinueCue(text)) {
    return false;
  }
  if (
    /^(?:请问?)?(?:当前)?(?:任务)?(?:目标|在做什么|做什么任务|任务是什么|现在的目标)(?:是|的)?(?:什么|嘛|吗)?[?？!！。.\s]*$/u.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /^(?:请问?)?(?:当前)?(?:有哪些|有什么|有效的?|有效)?(?:约束|限制|补充要求|补充约束)(?:有哪些|有什么|是什么)?[?？!！。.\s]*$/u.test(
      text,
    )
  ) {
    return false;
  }
  return true;
}
