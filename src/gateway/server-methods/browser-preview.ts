import {
  endAccountComputer,
  peekAccountComputerBrowser,
  readAccountComputerPreview,
  rejectDeadAccountComputerIfNeeded,
  tryReattachAccountComputerFromRunningWorker,
  type AccountComputerPreviewPayload,
} from "../../agents/sandbox/account-computer-stream.js";
import { notifyHandoffReturned } from "../../agents/sandbox/secure-form-handoff-wait.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

const CLIENT_IDENTITY_KEYS = [
  "profile",
  "profilePath",
  "containerName",
  "cdpPort",
  "noVncPort",
  "password",
  "userDataDir",
  "accountId",
  "computerId",
] as const;

function resolveViewerAccount(
  client: GatewayClient | null,
): { tenantId: string; userId: string } | null {
  const tenantId = client?.sessionEnterpriseId?.trim() ?? "";
  // platformUserId is the stable employee id. client.user is the login email and is not a computer key.
  const userId = client?.platformUserId?.trim() ?? "";
  if (!tenantId || !userId || userId.includes("@")) {
    return null;
  }
  const hint = client?.sessionTenantId?.trim();
  if (hint && hint !== tenantId) {
    return null;
  }
  return { tenantId, userId };
}

function publicPayload(payload: AccountComputerPreviewPayload): AccountComputerPreviewPayload {
  const next: AccountComputerPreviewPayload = {
    tenantId: payload.tenantId,
    userId: payload.userId,
    status: payload.status,
    controlledBy: payload.controlledBy,
  };
  if (payload.streamUrl) {
    next.streamUrl = payload.streamUrl;
  }
  if (payload.failure) {
    next.failure = payload.failure;
  }
  return next;
}

export const browserPreviewHandlers: GatewayRequestHandlers = {
  "browser.preview": async ({ params, respond, client, context }) => {
    for (const key of CLIENT_IDENTITY_KEYS) {
      if (params[key] != null && params[key] !== "") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "browser preview does not accept a client profile or computer id",
          ),
        );
        return;
      }
    }
    const account = resolveViewerAccount(client);
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "browser preview requires the signed-in account"),
      );
      return;
    }
    const action = typeof params.action === "string" ? params.action.trim() : "status";
    if (action !== "status" && action !== "open" && action !== "end") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "action must be status, open, or end"),
      );
      return;
    }
    if (action === "end") {
      respond(true, publicPayload(await endAccountComputer(account)));
      return;
    }
    // A dead browser must not keep a stream URL. Gateway restart then reattaches
    // only when worker.json and the container are both still live.
    await rejectDeadAccountComputerIfNeeded(account);
    if (!peekAccountComputerBrowser(account.tenantId, account.userId)) {
      try {
        await tryReattachAccountComputerFromRunningWorker(account);
      } catch {
        // Keep COLD below when reattach fails; do not start containers here.
      }
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : undefined;
    const releaseControl = params.releaseControl === true;
    const takeControl = params.takeControl === true;
    // Only explicit「交给AI」/handback may wake await_return as manual_handback.
    // Ambient open-plan releaseControl (default AI control) must not abort a
    // mid-gate QR/SMS wait — that race caused live Zhihu resume=manual_handback.
    const explicitHandback = params.explicitHandback === true;
    // Snapshot control before release so we only emit handoff_returned when this
    // session actually returned control to the agent (decision E∪F).
    const heldByUserBefore =
      releaseControl && sessionKey
        ? readAccountComputerPreview({
            ...account,
            issueUrl: false,
            sessionKey,
          }).controlledBy?.kind === "user"
        : false;
    const payload = readAccountComputerPreview({
      ...account,
      issueUrl: action === "open",
      sessionKey,
      takeControl,
      releaseControl,
      operatorLabel: account.userId,
    });
    if (
      releaseControl &&
      explicitHandback &&
      sessionKey &&
      heldByUserBefore &&
      payload.controlledBy?.kind === "agent"
    ) {
      notifyHandoffReturned(sessionKey, Date.now(), "manual_handback");
      context.broadcast(
        "secure_form.handoff_returned",
        { sessionKey, resume: "manual_handback" },
        { dropIfSlow: true },
      );
    }
    respond(true, publicPayload(payload));
  },
};
