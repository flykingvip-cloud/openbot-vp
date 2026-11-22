/** A summary is derivative evidence and must never outlive its source revision. */
export type RetrievalSummary = {
  schemaVersion: 1;
  state: "pending" | "processing" | "ready" | "failed" | "stale";
  documentType: "sop" | "report" | "meeting" | "dataset" | "other";
  sourceVersionId: string;
  sourceContentHash: string;
  templateVersion: string;
  generatedAt?: number;
  sourceRelations?: Array<{
    kind: "revision-of" | "derived-from" | "duplicate-of" | "supersedes";
    documentId: string;
    versionId?: string;
  }>;
  editorialStatus?: "draft" | "final";
  reviewedBy?: string;
  method?: "model" | "human";
  fields?: {
    purpose: string;
    keyPoints: string[];
    coverage: string[];
    entities: string[];
    boundaries: string[];
  };
  failureCode?: string;
};

export function retrievalSummaryForSource(
  summary: RetrievalSummary | undefined,
  source: { versionId: string; contentHash: string },
): RetrievalSummary | undefined {
  if (!summary) {
    return undefined;
  }
  if (
    summary.sourceVersionId !== source.versionId ||
    summary.sourceContentHash !== source.contentHash
  ) {
    return { ...summary, state: "stale" };
  }
  return summary;
}

/** Only current ready content enters recall; previews and stale derivatives do not. */
export function retrievalSummaryText(
  summary: RetrievalSummary | undefined,
  source: { versionId: string; contentHash: string },
): string {
  const current = retrievalSummaryForSource(summary, source);
  if (current?.state !== "ready" || !current.fields) {
    return "";
  }
  return [
    current.fields.purpose,
    ...current.fields.keyPoints,
    ...current.fields.coverage,
    ...current.fields.entities,
    ...current.fields.boundaries,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Human edits are never silently overwritten by asynchronous generation. */
export function canApplyGeneratedSummary(
  existing: RetrievalSummary | undefined,
  generated: RetrievalSummary,
  source: { versionId: string; contentHash: string },
): boolean {
  return (
    existing?.method !== "human" &&
    generated.state === "ready" &&
    generated.sourceVersionId === source.versionId &&
    generated.sourceContentHash === source.contentHash
  );
}

/** Soft diagnostics only; never an ingestion or indexing gate. */
export function retrievalSummaryQuality(summary: RetrievalSummary): string[] {
  const fields = summary.fields;
  if (!fields) {
    return ["missing_fields"];
  }
  const text = [
    fields.purpose,
    ...fields.keyPoints,
    ...fields.coverage,
    ...fields.entities,
    ...fields.boundaries,
  ].join("");
  const count = Array.from(
    new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text),
  ).length;
  const flags: string[] = [];
  if (count < 150) {
    flags.push("short_summary");
  }
  if (count > 300) {
    flags.push("long_summary");
  }
  if (/目录|第\s*\d+\s*页|免责声明/u.test(fields.purpose)) {
    flags.push("possible_preview_boilerplate");
  }
  if (fields.keyPoints.length === 0) {
    flags.push("missing_key_points");
  }
  return flags;
}
