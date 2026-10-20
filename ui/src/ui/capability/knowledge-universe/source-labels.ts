import { t } from "../../../i18n/index.ts";
import type { KnowledgeSource } from "./types.ts";

export function knowledgeSourceLabel(source: KnowledgeSource): string {
  switch (source) {
    case "personal":
      return t("frontstage.workbench.knowledgeUniverse.sources.personal");
    case "enterprise":
      return t("frontstage.workbench.knowledgeUniverse.sources.enterprise");
    case "data":
      return t("frontstage.workbench.knowledgeUniverse.sources.data");
    default:
      return t("frontstage.workbench.knowledgeUniverse.sources.personal");
  }
}
