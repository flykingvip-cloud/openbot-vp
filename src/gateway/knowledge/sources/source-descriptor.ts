/**
 * Unified description of a knowledge source across every input channel. This is the
 * single shape the workbench uses to talk about "where knowledge comes from", whether
 * the source is passively chunk-indexed (upload/web/dataset/enterprise) or an active
 * capability that is only registered and consumed through the governed runtime
 * (api/external/capability). Active sources are NEVER ingested into the chunk index —
 * that hand-off belongs to the capability runtime, preserving the consumption boundary.
 */

export type KnowledgeSourceKind =
  | "upload"
  | "web"
  | "dataset"
  | "api"
  | "external"
  | "enterprise"
  | "capability"
  /** Durable passive folder source; device paths live on LocalFolderBinding, not here. */
  | "localFolder"
  /** P5: remote passive connectors — same three-layer contract as localFolder. */
  | "gitRepo"
  | "cloudDrive"
  | "mailAttachment";

/** passive = chunk-indexed + retrievable; active = register-only, consumed via runtime. */
export type KnowledgeSourcePlane = "passive" | "active";

export type KnowledgeSourceVisibility = "private" | "team" | "enterprise";

export type SourceDescriptor = {
  id: string;
  kind: KnowledgeSourceKind;
  plane: KnowledgeSourcePlane;
  title: string;
  knowledgeBaseId?: string;
  ownerId?: string;
  visibility?: KnowledgeSourceVisibility;
  freshness?: "fresh" | "stale" | "unknown";
  /** For api/external sources: the declared endpoint/locator (not invoked here). */
  endpoint?: string;
  metadata?: Record<string, string>;
  createdAtMs: number;
};

const ACTIVE_SOURCE_KINDS: ReadonlySet<KnowledgeSourceKind> = new Set([
  "api",
  "external",
  "capability",
]);

/**
 * Active source kinds (api/external/capability) are register-only and consumed through
 * the capability runtime; everything else is a passive, chunk-indexed source.
 */
export function resolveSourcePlane(kind: KnowledgeSourceKind): KnowledgeSourcePlane {
  return ACTIVE_SOURCE_KINDS.has(kind) ? "active" : "passive";
}

export function isActiveSourceKind(kind: KnowledgeSourceKind): boolean {
  return ACTIVE_SOURCE_KINDS.has(kind);
}
