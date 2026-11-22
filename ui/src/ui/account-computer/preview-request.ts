import { t } from "../../i18n/index.ts";
import type { OpenBotApp } from "../app.ts";

export async function refreshAccountComputerPreview(
  host: OpenBotApp,
  action: "open" | "status" | "end",
) {
  const {
    applyServerComputerPreview,
    clearComputerPreviewStreamError,
    computerPreviewNeedsStreamRetry,
    computerPreviewOpenPlan,
    computerSessionRequestsInput,
    endComputerPreview,
    noteComputerPreviewInputClaim,
    noteComputerPreviewStreamError,
    readComputerPreviewModel,
    scheduleComputerPreviewStreamRetry,
    suspendComputerPreviewInput,
  } = await import("../views/account-computer-preview.ts");
  if (action === "end") {
    endComputerPreview(host);
  } else if (action === "open") {
    // M1: opening preview always focuses the 电脑 tab (visible ≤5s connecting).
    host.sidebarOpen = true;
    host.sidebarSurface = "computer";
    host.computerNarrowChat = false;
  }
  if (!host.client || !host.connected) {
    host.computerPreviewRevision += 1;
    return;
  }
  const { resolveWorkbenchChatSessionKey } = await import("../chat/workbench-visible-messages.ts");
  const sessionKey = resolveWorkbenchChatSessionKey({
    selectedKey: host.workbenchTeamSelectedKey,
    sessionKey: host.sessionKey,
  });
  // Keep computer preview keyed to the header chat when selection raced ahead.
  if (sessionKey && sessionKey !== host.sessionKey) {
    host.sessionKey = sessionKey;
  }
  const userLabel = t("chat.computerYou");
  const formLocked = Boolean(host.secureFormOffered);
  const authHandoffActive = Boolean(
    host.secureFormHandoff && host.secureFormHandoff.sessionKey === sessionKey,
  );
  const plan = computerPreviewOpenPlan(host, {
    action,
    formLocked,
    userLabel,
    authHandoffActive,
  });
  if (plan.takeControl) {
    noteComputerPreviewInputClaim(host, userLabel);
  } else if (formLocked && computerSessionRequestsInput(sessionKey)) {
    suspendComputerPreviewInput(host);
  }
  try {
    const payload = await host.client.request<{
      tenantId: string;
      userId: string;
      status: "COLD" | "STARTING" | "READY" | "REAUTH_REQUIRED" | "DISCONNECTED";
      streamUrl?: string;
      failure?: string;
      controlledBy?: { kind: "agent" | "user"; label: string } | null;
    }>("browser.preview", {
      action: plan.action,
      sessionKey,
      ...(plan.takeControl ? { takeControl: true } : {}),
      ...(plan.releaseControl ? { releaseControl: true } : {}),
      ...(plan.explicitHandback ? { explicitHandback: true } : {}),
    });
    clearComputerPreviewStreamError();
    applyServerComputerPreview({
      tenantId: payload.tenantId,
      userId: payload.userId,
      sessionKey,
      action: plan.action,
      status: payload.status,
      streamUrl: payload.streamUrl,
      failure: payload.failure,
      controlledBy: payload.controlledBy,
      grantsInput: plan.takeControl,
    });
  } catch (err) {
    // Keep the local tab; surface a retryable connecting/error state instead of a white stage.
    const message = err instanceof Error ? err.message : "preview failed";
    noteComputerPreviewStreamError(message);
  }
  host.computerPreviewRevision += 1;
  if (action !== "end") {
    const model = readComputerPreviewModel(host, null);
    if (computerPreviewNeedsStreamRetry(model)) {
      scheduleComputerPreviewStreamRetry(host);
    }
  }
}
