import { t } from "../../i18n/index.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";

export function resolveKnowledgeBaseDisplayTitle(
  knowledgeBases: KnowledgeBaseSummary[],
  knowledgeBaseId: string,
): string | null {
  const title = knowledgeBases.find((kb) => kb.id === knowledgeBaseId)?.title?.trim();
  return title || null;
}

/** User-facing archive hint for deliverable lists — never leaks internal kb_* ids. */
export function formatDeliverableArchivedLibraryLabel(
  knowledgeBases: KnowledgeBaseSummary[],
  knowledgeBaseId: string,
): string {
  const title = resolveKnowledgeBaseDisplayTitle(knowledgeBases, knowledgeBaseId);
  if (title) {
    return t("frontstage.workbench.knowledgeUniverse.workspace.archivedTo", { library: title });
  }
  return t("frontstage.workbench.knowledgeUniverse.workspace.archived");
}
