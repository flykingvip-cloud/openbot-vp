/**
 * Deliverable output envelope — explicit boundaries for saveable artifact bodies.
 *
 * Priority when parsing assistant text:
 * 1. <<DELIVERABLE title="...">> ... <</DELIVERABLE>>  (machine-readable, preferred)
 * 2. 「 ... 」  (human-readable lightweight alternative)
 *
 * Content outside envelopes is treated as conversational wrapper, not artifact body.
 */

export type DeliverableEnvelopeKind = "tag" | "quoted";

export type DeliverableSettleState = "declared" | "confirmed" | "retryable" | "conflict";

export type DeliverableEnvelope = {
  kind: DeliverableEnvelopeKind;
  title?: string;
  type?: string;
  version?: string;
  logicalId?: string;
  /**
   * Declared workspace-relative file path (for example `output/report.html`).
   * Unsafe absolute or traversing paths are rejected before file access.
   */
  file?: string;
  /** True when `file=` was declared but the workspace file was never written. */
  unwritten?: boolean;
  /** System settle state: confirmed | retryable | conflict | declared (PR C). */
  settle?: DeliverableSettleState;
  /** Declared published/external URL when the deliverable was published outside the workspace. */
  url?: string;
  body: string;
};

// Unified tag matcher: captures the full attribute block then the body, so single-line
// multi-attribute declarations (`<<DELIVERABLE title="x" file="y.docx">>`) and multi-line
// ones parse identically. Mirrors src/shared/preview-artifact/deliverable-envelope.ts.
const TAGGED_DELIVERABLE_RE = /<<\s*DELIVERABLE\b([^>]*)>+([\s\S]*?)<<\s*\/\s*DELIVERABLE\s*>>/gi;

const QUOTED_DELIVERABLE_RE = /「([\s\S]*?)」/g;

const MIN_ENVELOPE_BODY_CHARS = 20;
const MAX_WORKSPACE_RELATIVE_PATH_CHARS = 500;

function normalizeEnvelopeBody(body: string) {
  return body.replace(/^\s+|\s+$/g, "");
}

function normalizeEnvelopeTitle(title: string | undefined) {
  const trimmed = title?.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

export type DeliverableEnvelopeAttributes = {
  title?: string;
  type?: string;
  version?: string;
  logicalId?: string;
  file?: string;
  url?: string;
  unwritten?: boolean;
  settle?: DeliverableSettleState;
};

/** Normalize an untrusted declaration to a safe workspace-relative file path. */
export function normalizeDeliverableWorkspacePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.length > MAX_WORKSPACE_RELATIVE_PATH_CHARS ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("\0") ||
    /^[a-z]:\//i.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
    )
  ) {
    return undefined;
  }
  return segments.join("/");
}

export function parseDeliverableAttributes(block: string): DeliverableEnvelopeAttributes {
  const attrs: DeliverableEnvelopeAttributes = {};
  const attrRe = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(block))) {
    const key = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!value) {
      continue;
    }
    if (key === "title") {
      attrs.title = value.slice(0, 80);
    } else if (key === "type") {
      attrs.type = value.slice(0, 40);
    } else if (key === "version") {
      attrs.version = value.slice(0, 16);
    } else if (key === "logicalid" || key === "logical_id" || key === "id") {
      attrs.logicalId = value.slice(0, 80);
    } else if (key === "file" || key === "path" || key === "filename") {
      const workspacePath = normalizeDeliverableWorkspacePath(value);
      if (workspacePath) {
        attrs.file = workspacePath;
      }
    } else if (key === "url") {
      if (/^https?:\/\//i.test(value)) {
        attrs.url = value.slice(0, 2000);
      }
    } else if (key === "unwritten") {
      attrs.unwritten =
        value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
    } else if (key === "settle") {
      const normalized = value.toLowerCase();
      if (
        normalized === "declared" ||
        normalized === "confirmed" ||
        normalized === "retryable" ||
        normalized === "conflict"
      ) {
        attrs.settle = normalized;
      }
    }
  }
  return attrs;
}

function envelopeDeclaresLocation(entry: DeliverableEnvelope): boolean {
  return Boolean(entry.file || entry.url);
}

function pickBestEnvelope(candidates: DeliverableEnvelope[]): DeliverableEnvelope | null {
  // A declaration that carries a concrete location (file/url) is a first-class deliverable even
  // when its body is a short summary, so it is exempt from the min-body length gate.
  const eligible = candidates.filter(
    (entry) =>
      envelopeDeclaresLocation(entry) ||
      normalizeEnvelopeBody(entry.body).length >= MIN_ENVELOPE_BODY_CHARS,
  );
  if (eligible.length === 0) {
    return null;
  }
  return eligible.reduce((best, current) => {
    const currentLocated = envelopeDeclaresLocation(current);
    const bestLocated = envelopeDeclaresLocation(best);
    if (currentLocated !== bestLocated) {
      return currentLocated ? current : best;
    }
    return normalizeEnvelopeBody(current.body).length > normalizeEnvelopeBody(best.body).length
      ? current
      : best;
  });
}

function buildTaggedEnvelope(attrBlock: string, rawBody: string): DeliverableEnvelope | null {
  const body = normalizeEnvelopeBody(rawBody);
  const attrs = parseDeliverableAttributes(attrBlock);
  // Keep declarations that carry a concrete location even with an empty body — the file/link
  // itself is the deliverable; the body is only an optional summary.
  if (!body && !attrs.file && !attrs.url) {
    return null;
  }
  return {
    kind: "tag",
    title: normalizeEnvelopeTitle(attrs.title),
    type: attrs.type,
    version: attrs.version,
    logicalId: attrs.logicalId?.trim() || undefined,
    file: attrs.file,
    url: attrs.url,
    unwritten: attrs.unwritten || undefined,
    settle: attrs.settle,
    body,
  };
}

export function extractTaggedDeliverableEnvelopes(text: string): DeliverableEnvelope[] {
  const envelopes: DeliverableEnvelope[] = [];
  TAGGED_DELIVERABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAGGED_DELIVERABLE_RE.exec(text))) {
    const envelope = buildTaggedEnvelope(match[1] ?? "", match[2] ?? "");
    if (envelope) {
      envelopes.push(envelope);
    }
  }
  return envelopes;
}

export function extractQuotedDeliverableEnvelopes(text: string): DeliverableEnvelope[] {
  const envelopes: DeliverableEnvelope[] = [];
  QUOTED_DELIVERABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUOTED_DELIVERABLE_RE.exec(text))) {
    const body = normalizeEnvelopeBody(match[1] ?? "");
    if (!body) {
      continue;
    }
    envelopes.push({
      kind: "quoted",
      body,
    });
  }
  return envelopes;
}

// 「…」 double as ordinary Chinese quotation marks in prose, so a quoted envelope
// is only trusted when its body dominates the whole message (i.e. the message
// essentially IS the quoted deliverable). A stray quote inside a long article must
// NOT be taken as the deliverable body, otherwise the preview/capture collapses
// the article down to a single quoted sentence.
const MIN_QUOTED_ENVELOPE_COVERAGE = 0.6;

function isDominantQuotedEnvelope(body: string, text: string): boolean {
  const totalLength = text.trim().length;
  if (totalLength === 0) {
    return false;
  }
  return normalizeEnvelopeBody(body).length / totalLength >= MIN_QUOTED_ENVELOPE_COVERAGE;
}

function envelopeLocationKey(entry: DeliverableEnvelope): string | null {
  if (entry.file) {
    return `file:${entry.file}`;
  }
  if (entry.url) {
    return `url:${entry.url}`;
  }
  return null;
}

/**
 * All tagged envelopes that declare a concrete file or URL, in document order.
 * Used so one assistant reply can expose multiple 「打开成果」 targets.
 */
export function extractLocatedDeliverableEnvelopes(text: string): DeliverableEnvelope[] {
  const seen = new Set<string>();
  const located: DeliverableEnvelope[] = [];
  for (const envelope of extractTaggedDeliverableEnvelopes(text)) {
    if (!envelopeDeclaresLocation(envelope)) {
      continue;
    }
    const key = envelopeLocationKey(envelope);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    located.push(envelope);
  }
  return located;
}

/** Return the best deliverable envelope in `text`, or null when none qualify. */
export function extractDeliverableEnvelope(text: string): DeliverableEnvelope | null {
  const located = extractLocatedDeliverableEnvelopes(text);
  if (located.length === 1) {
    return located[0] ?? null;
  }
  if (located.length > 1) {
    return pickBestEnvelope(located);
  }
  const tagged = extractTaggedDeliverableEnvelopes(text);
  const taggedBest = pickBestEnvelope(tagged);
  if (taggedBest) {
    return taggedBest;
  }
  const quotedBest = pickBestEnvelope(extractQuotedDeliverableEnvelopes(text));
  return quotedBest && isDominantQuotedEnvelope(quotedBest.body, text) ? quotedBest : null;
}

/** Extract deliverable body for preview/download; falls back to trimmed input. */
export function resolveDeliverableBody(text: string): string {
  const envelope = extractDeliverableEnvelope(text);
  if (envelope) {
    return envelope.body;
  }
  return text.trim();
}

/**
 * Strip machine <<DELIVERABLE>> tags from assistant text for display.
 * Replaces each tagged block with its body; drops orphan open/close tags.
 */
export function stripDeliverableEnvelopeTags(text: string): string {
  if (!text || !text.includes("DELIVERABLE")) {
    return text;
  }
  TAGGED_DELIVERABLE_RE.lastIndex = 0;
  const withBodies = text.replace(TAGGED_DELIVERABLE_RE, (_full, _attrs: string, body: string) =>
    normalizeEnvelopeBody(body ?? ""),
  );
  return withBodies
    .replace(/<<\s*\/?\s*DELIVERABLE\b[^>]*>>?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
