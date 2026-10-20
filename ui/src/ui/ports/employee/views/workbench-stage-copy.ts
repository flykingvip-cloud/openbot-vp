import { t } from "../../../../i18n/index.ts";
import type { WorkbenchPrimaryModule, WorkbenchSettingsView } from "./workbench-types.ts";

export function renderStageSubtitle(
  primaryModule: WorkbenchPrimaryModule,
  itemTitle: string,
  panelSubtitle: string | null | undefined,
  settingsView: WorkbenchSettingsView = "system",
) {
  if (primaryModule === "settings") {
    return settingsView === "personal"
      ? t("frontstage.workbench.settings.profileSubtitle")
      : t("frontstage.workbench.settings.systemSubtitle");
  }
  const subtitle = panelSubtitle?.trim();
  if (subtitle) {
    return subtitle;
  }
  if (primaryModule === "collaboration") {
    return t("frontstage.workbench.surface.stage.collaborationSubtitle", { title: itemTitle });
  }
  if (primaryModule === "knowledge") {
    return t("frontstage.workbench.nav.knowledgeVerse");
  }
  if (primaryModule === "tasks") {
    return t("frontstage.workbench.nav.myTasks");
  }
  return t("frontstage.workbench.nav.aiAssistant");
}
