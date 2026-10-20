/**
 * P0.0a migration — deterministic merge/dedupe of collaboration ledger JSONL files.
 *
 * Production groups can carry both `ledger/collaboration.jsonl` (canonical) and the
 * older flat `collaboration-ledger.jsonl`. They are merged, never blindly copied.
 *
 * Dedupe key: sha256 of the canonical JSON of the parsed record (object keys sorted
 * recursively, so key order / whitespace differences do not matter). A line that is
 * not valid JSON is kept verbatim with key `raw:<sha256(trimmed line)>`.
 * Winner: the first occurrence in precedence order (canonical file before the legacy
 * file, then line order); its original line text is emitted unchanged.
 * Order: `recordedAtMs` ascending (records without a finite numeric `recordedAtMs`
 * last), then source precedence, then line index. The ledger reader already sorts by
 * `recordedAtMs`, so this order matches what readers observe.
 */
import { createHash } from "node:crypto";

export type LedgerSourceInput = {
  /** Relative label, e.g. `ledger/collaboration.jsonl`. Array order = precedence. */
  label: string;
  content: string;
};

export type LedgerLine = {
  key: string;
  text: string;
  recordedAtMs: number | null;
  sourceIndex: number;
  lineIndex: number;
};

export type LedgerMergeResult = {
  content: string;
  sha256: string;
  lines: number;
  /** Records added on top of `existingTarget` (all records when there is none). */
  appended: number;
  keys: Set<string>;
  sourceLines: number;
  duplicatesDropped: number;
  parseErrors: number;
};

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .toSorted()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function parseLedgerLines(
  content: string,
  sourceIndex = 0,
): {
  lines: LedgerLine[];
  parseErrors: number;
} {
  const lines: LedgerLine[] = [];
  let parseErrors = 0;
  const rawLines = content.split("\n");
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const text = (rawLines[lineIndex] ?? "").replace(/\r$/, "");
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    let key: string;
    let recordedAtMs: number | null = null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      key = `rec:${sha256Hex(canonicalJson(parsed))}`;
      const ts =
        parsed && typeof parsed === "object"
          ? (parsed as { recordedAtMs?: unknown }).recordedAtMs
          : undefined;
      recordedAtMs = typeof ts === "number" && Number.isFinite(ts) ? ts : null;
    } catch {
      parseErrors += 1;
      key = `raw:${sha256Hex(trimmed)}`;
    }
    lines.push({ key, text, recordedAtMs, sourceIndex, lineIndex });
  }
  return { lines, parseErrors };
}

function compareLines(left: LedgerLine, right: LedgerLine): number {
  const l = left.recordedAtMs ?? Number.POSITIVE_INFINITY;
  const r = right.recordedAtMs ?? Number.POSITIVE_INFINITY;
  if (l !== r) {
    return l < r ? -1 : 1;
  }
  if (left.sourceIndex !== right.sourceIndex) {
    return left.sourceIndex - right.sourceIndex;
  }
  return left.lineIndex - right.lineIndex;
}

function render(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Merge `sources` into a deduped ledger. When `existingTarget` is given its bytes are
 * kept verbatim as a prefix and only records whose key it lacks are appended
 * (incremental re-sync; idempotent: a second run appends nothing).
 */
export function mergeLedgerSources(params: {
  sources: LedgerSourceInput[];
  existingTarget?: string | null;
  /** Extra keys treated as already present (e.g. records of a sibling legacy file). */
  knownKeys?: Iterable<string>;
}): LedgerMergeResult {
  let parseErrors = 0;
  let sourceLines = 0;
  const seen = new Set<string>(params.knownKeys ?? []);
  const kept: LedgerLine[] = [];
  let baseLineCount = 0;
  if (params.existingTarget != null) {
    const parsed = parseLedgerLines(params.existingTarget, -1);
    baseLineCount = parsed.lines.length;
    for (const line of parsed.lines) {
      seen.add(line.key);
    }
  }
  let duplicatesDropped = 0;
  params.sources.forEach((source, sourceIndex) => {
    const parsed = parseLedgerLines(source.content, sourceIndex);
    parseErrors += parsed.parseErrors;
    sourceLines += parsed.lines.length;
    for (const line of parsed.lines) {
      if (seen.has(line.key)) {
        duplicatesDropped += 1;
        continue;
      }
      seen.add(line.key);
      kept.push(line);
    }
  });
  const appendedText = kept.toSorted(compareLines).map((line) => line.text);
  let content: string;
  if (params.existingTarget != null) {
    const base = params.existingTarget;
    const glue = base && !base.endsWith("\n") && appendedText.length > 0 ? "\n" : "";
    content = `${base}${glue}${render(appendedText)}`;
  } else {
    content = render(appendedText);
  }
  return {
    content,
    sha256: sha256Hex(content),
    lines: baseLineCount + appendedText.length,
    appended: appendedText.length,
    keys: seen,
    sourceLines,
    duplicatesDropped,
    parseErrors,
  };
}

/** Keys of every non-blank line (used to prove the target covers all sources). */
export function ledgerKeys(content: string): Set<string> {
  return new Set(parseLedgerLines(content).lines.map((line) => line.key));
}

export function countNonBlankLines(content: string): number {
  return content.split("\n").filter((line) => line.trim()).length;
}
