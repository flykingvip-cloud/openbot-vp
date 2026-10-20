import { t } from "../i18n/index.ts";
import { BrandLogoError, readCustomBrandLogoFile } from "./brand-assets.ts";
import type { UiSettings } from "./storage.ts";
import type { ArtifactWorkspaceSidebar } from "./types.ts";
import type {
  DeliverableSaveDecisionChoice,
  DeliverableSaveState,
  DeliverableSaveToast,
} from "./wiring/deliverable-save.ts";

export type SidebarActionHost = {
  deliverableSaveDecisionResolve: ((choice: DeliverableSaveDecisionChoice | null) => void) | null;
  sidebarDeliverableSaveState: DeliverableSaveState | null;
  sidebarDeliverableSaveToast: DeliverableSaveToast | null;
  sidebarDeliverableSaveToastTimer: number | null;
  sidebarOpen: boolean;
  sidebarCloseTimer: number | null;
  sidebarPreviewMode: "markdown" | "artifact";
  sidebarContent: string | null;
  sidebarError: string | null;
  sidebarArtifactWorkspace: ArtifactWorkspaceSidebar | null;
  splitRatio: number;
  settings: UiSettings;
  workbenchBrandLogoError: string | null;
  applySettings: (settings: UiSettings) => void;
  handleCancelDeliverableSaveDecision: () => void;
};

export function confirmDeliverableOverwrite(host: SidebarActionHost) {
  const resolve = host.deliverableSaveDecisionResolve;
  host.deliverableSaveDecisionResolve = null;
  if (host.sidebarDeliverableSaveState) {
    host.sidebarDeliverableSaveState = {
      ...host.sidebarDeliverableSaveState,
      busy: true,
      pendingDecision: null,
    };
  }
  resolve?.({ saveMode: "overwrite" });
}

export function confirmDeliverableSaveAs(host: SidebarActionHost) {
  const resolve = host.deliverableSaveDecisionResolve;
  host.deliverableSaveDecisionResolve = null;
  const filename =
    host.sidebarDeliverableSaveState?.saveAsFilenameDraft?.trim() ||
    host.sidebarDeliverableSaveState?.pendingDecision?.suggestedSaveAsFilename;
  if (host.sidebarDeliverableSaveState) {
    host.sidebarDeliverableSaveState = {
      ...host.sidebarDeliverableSaveState,
      busy: true,
      pendingDecision: null,
    };
  }
  resolve?.({ saveMode: "save_as", saveAsFilename: filename });
}

export function cancelDeliverableSaveDecision(host: SidebarActionHost) {
  const resolve = host.deliverableSaveDecisionResolve;
  host.deliverableSaveDecisionResolve = null;
  if (host.sidebarDeliverableSaveState) {
    host.sidebarDeliverableSaveState = {
      ...host.sidebarDeliverableSaveState,
      busy: false,
      pendingDecision: null,
    };
  }
  resolve?.(null);
}

export function changeDeliverableSaveAsFilename(host: SidebarActionHost, filename: string) {
  if (!host.sidebarDeliverableSaveState?.pendingDecision) {
    return;
  }
  host.sidebarDeliverableSaveState = {
    ...host.sidebarDeliverableSaveState,
    saveAsFilenameDraft: filename,
  };
}

export function closeSidebar(host: SidebarActionHost) {
  host.handleCancelDeliverableSaveDecision();
  host.sidebarOpen = false;
  if (host.sidebarCloseTimer != null) {
    window.clearTimeout(host.sidebarCloseTimer);
  }
  host.sidebarCloseTimer = window.setTimeout(() => {
    if (host.sidebarOpen) {
      return;
    }
    host.sidebarPreviewMode = "markdown";
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarArtifactWorkspace = null;
    host.sidebarDeliverableSaveState = null;
    host.sidebarDeliverableSaveToast = null;
    if (host.sidebarDeliverableSaveToastTimer != null) {
      window.clearTimeout(host.sidebarDeliverableSaveToastTimer);
      host.sidebarDeliverableSaveToastTimer = null;
    }
    host.sidebarCloseTimer = null;
  }, 200);
}

export function changeSplitRatio(host: SidebarActionHost, ratio: number) {
  const newRatio = Math.max(0.4, Math.min(0.7, ratio));
  host.splitRatio = newRatio;
  host.applySettings({ ...host.settings, splitRatio: newRatio });
}

export async function changeBrandLogoFile(host: SidebarActionHost, file: File | null) {
  if (!file) {
    return;
  }
  try {
    const customBrandLogoDataUrl = await readCustomBrandLogoFile(file);
    host.applySettings({
      ...host.settings,
      customBrandLogoDataUrl,
    });
    host.workbenchBrandLogoError = null;
  } catch (error) {
    if (error instanceof BrandLogoError) {
      host.workbenchBrandLogoError =
        error.code === "unsupported"
          ? t("frontstage.workbench.surface.branding.errorUnsupported")
          : error.code === "too_large"
            ? t("frontstage.workbench.surface.branding.errorTooLarge")
            : t("frontstage.workbench.surface.branding.errorRead");
      return;
    }
    host.workbenchBrandLogoError = t("frontstage.workbench.surface.branding.errorRead");
  }
}

export function resetBrandLogo(host: SidebarActionHost) {
  if (!host.settings.customBrandLogoDataUrl && !host.workbenchBrandLogoError) {
    return;
  }
  host.applySettings({
    ...host.settings,
    customBrandLogoDataUrl: undefined,
  });
  host.workbenchBrandLogoError = null;
}
