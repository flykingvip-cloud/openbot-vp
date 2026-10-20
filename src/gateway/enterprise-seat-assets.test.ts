import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import {
  CONTROL_UI_ENTERPRISE_BASE_PATH,
  CONTROL_UI_PLATFORM_AUTH_BASE_PATH,
} from "./control-ui-contract.js";
import { handleControlUiHttpRequest } from "./control-ui.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import { handleEnterpriseSeatAssetsHttpRequest } from "./enterprise-seat-assets.js";
import { makeMockHttpResponse } from "./test-http-response.js";
import { withTempConfig } from "./test-temp-config.js";

const NO_SMTP_ENV: Record<string, string | undefined> = {
  OPENBOT_SMTP_HOST: undefined,
  OPENBOT_SMTP_PORT: undefined,
  OPENBOT_SMTP_USER: undefined,
  OPENBOT_SMTP_PASS: undefined,
  OPENBOT_SMTP_FROM: undefined,
  OPENBOT_SMTP_REPLY_TO: undefined,
  OPENBOT_SMTP_SECURE: undefined,
  OPENBOT_SMTP_STARTTLS: undefined,
  OPENBOT_SMTP_TIMEOUT_MS: undefined,
  OPENCLAW_SMTP_HOST: undefined,
  OPENCLAW_SMTP_PORT: undefined,
  OPENCLAW_SMTP_USER: undefined,
  OPENCLAW_SMTP_PASS: undefined,
  OPENCLAW_SMTP_FROM: undefined,
  OPENCLAW_SMTP_REPLY_TO: undefined,
  OPENCLAW_SMTP_SECURE: undefined,
  OPENCLAW_SMTP_STARTTLS: undefined,
  OPENCLAW_SMTP_TIMEOUT_MS: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: undefined,
  SMTP_REPLY_TO: undefined,
  SMTP_SECURE: undefined,
  SMTP_STARTTLS: undefined,
  SMTP_TIMEOUT_MS: undefined,
};

function makeJsonRequest(params: {
  url: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  cookie?: string;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: params.method,
    headers: {
      host: "127.0.0.1:18789",
      ...(params.cookie ? { cookie: params.cookie } : {}),
    },
  });
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
    configurable: true,
  });
  return req;
}

function getPrimarySetCookie(
  setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"],
): string | undefined {
  const raw = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.find((value): value is string => typeof value === "string" && value.includes("="));
  }
  return undefined;
}

function parsePayload<T>(end: ReturnType<typeof makeMockHttpResponse>["end"]): T {
  return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as T;
}

/** Admin org creates the position first; invite then binds that stable id. */
async function createVacantPosition(params: {
  tenantId: string;
  title: string;
  cookie: string;
  resolvedAuth: ResolvedGatewayAuth;
}): Promise<string> {
  const response = await sendControlUiRequest(
    makeJsonRequest({
      url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${params.tenantId}/seats`,
      method: "POST",
      cookie: params.cookie,
      body: { title: params.title },
    }),
    params.resolvedAuth,
  );
  const payload = parsePayload<{ seat?: { seatId?: string; title?: string } }>(response.end);
  expect(payload.seat?.title).toBe(params.title);
  const seatId = payload.seat?.seatId?.trim();
  expect(seatId).toBeTruthy();
  return String(seatId);
}

async function sendControlUiRequest(req: IncomingMessage, resolvedAuth: ResolvedGatewayAuth) {
  const response = makeMockHttpResponse();
  const handled = await handleControlUiHttpRequest(req, response.res, {
    resolvedAuth,
  });
  expect(handled).toBe(true);
  return response;
}

describe("enterprise seat assets", () => {
  it("routes enterprise seat and handover commands through control-ui with updated snapshots", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-assets-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const resolvedAuth: ResolvedGatewayAuth = {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy,
      };

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          body: {
            email: "ops@example.com",
            password: "password-123",
            displayName: "Ops",
          },
        }),
        resolvedAuth,
      );

      const createResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
          method: "POST",
          body: {
            enterpriseName: "Acme",
            adminName: "Owner",
            adminEmail: "owner@example.com",
          },
        }),
        resolvedAuth,
      );
      const createPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(createResponse.end);
      const adminCode = createPayload.platformAuth?.pendingActivation?.code;
      expect(typeof adminCode).toBe("string");

      const activateResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
          method: "POST",
          body: {
            email: "owner@example.com",
            displayName: "Owner",
            password: "password-123",
            code: adminCode,
          },
        }),
        resolvedAuth,
      );
      const activatePayload = parsePayload<{
        session?: { tenantId?: string };
      }>(activateResponse.end);
      const tenantId = activatePayload.session?.tenantId;
      expect(typeof tenantId).toBe("string");
      const adminCookie = getPrimarySetCookie(activateResponse.setHeader);
      expect(typeof adminCookie).toBe("string");
      const adminSessionCookie = String(adminCookie).split(";")[0];

      const financeLeadId = await createVacantPosition({
        tenantId: String(tenantId),
        title: "Finance Lead",
        cookie: adminSessionCookie,
        resolvedAuth,
      });
      const aliceProvisionResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeName: "Alice",
            employeeEmail: "alice@example.com",
            positionId: financeLeadId,
          },
        }),
        resolvedAuth,
      );
      const aliceProvisionPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(aliceProvisionResponse.end);

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/register`,
          method: "POST",
          body: {
            email: "alice@example.com",
            displayName: "Alice",
            password: "password-123",
            code: aliceProvisionPayload.platformAuth?.pendingActivation?.code,
          },
        }),
        resolvedAuth,
      );

      const supportBackupId = await createVacantPosition({
        tenantId: String(tenantId),
        title: "Support Backup",
        cookie: adminSessionCookie,
        resolvedAuth,
      });
      const bobProvisionResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeName: "Bob",
            employeeEmail: "bob@example.com",
            positionId: supportBackupId,
          },
        }),
        resolvedAuth,
      );
      const bobProvisionPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(bobProvisionResponse.end);

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/register`,
          method: "POST",
          body: {
            email: "bob@example.com",
            displayName: "Bob",
            password: "password-123",
            code: bobProvisionPayload.platformAuth?.pendingActivation?.code,
          },
        }),
        resolvedAuth,
      );

      const seatsResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const seatsPayload = parsePayload<{
        seats: Array<{ seatId: string; title: string; status: string }>;
      }>(seatsResponse.end);
      const financeSeat = seatsPayload.seats.find((seat) => seat.title === "Finance Lead");
      const supportSeat = seatsPayload.seats.find((seat) => seat.title === "Support Backup");
      expect(financeSeat?.status).toBe("occupied");
      expect(supportSeat?.status).toBe("occupied");

      const handoverStartResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/handover/start`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            seatId: financeSeat?.seatId,
          },
        }),
        resolvedAuth,
      );
      const handoverStartPayload = parsePayload<{
        handover?: { handoverCaseId?: string; status?: string };
        updatedSnapshot?: { organization?: { handoverSeatCount?: number } };
      }>(handoverStartResponse.end);
      expect(handoverStartPayload.handover?.status).toBe("draft");
      expect(handoverStartPayload.updatedSnapshot?.organization?.handoverSeatCount).toBe(1);
      const handoverCaseId = handoverStartPayload.handover?.handoverCaseId;

      const nominateResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/handover/${handoverCaseId}/nominate`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeEmail: "bob@example.com",
          },
        }),
        resolvedAuth,
      );
      const nominatePayload = parsePayload<{
        handover?: { status?: string; incomingEmployeeId?: string };
      }>(nominateResponse.end);
      expect(nominatePayload.handover?.status).toBe("asset_review");
      expect(typeof nominatePayload.handover?.incomingEmployeeId).toBe("string");

      const reviewResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/handover/${handoverCaseId}/review`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            reviewSummary: "Finance workspace and shared memories are ready for successor review.",
            exceptionFlags: ["connector_rebind_required"],
          },
        }),
        resolvedAuth,
      );
      const reviewPayload = parsePayload<{
        handover?: { status?: string; exceptionFlags?: string[] };
        updatedSnapshot?: { organization?: { frozenSeatCount?: number } };
      }>(reviewResponse.end);
      expect(reviewPayload.handover?.status).toBe("pending_approval");
      expect(reviewPayload.handover?.exceptionFlags).toEqual(["connector_rebind_required"]);
      expect(reviewPayload.updatedSnapshot?.organization?.frozenSeatCount).toBe(1);

      const approveResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/handover/${handoverCaseId}/approve`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {},
        }),
        resolvedAuth,
      );
      const approvePayload = parsePayload<{
        handover?: { status?: string; approvedBy?: string };
      }>(approveResponse.end);
      expect(approvePayload.handover?.status).toBe("frozen");
      expect(typeof approvePayload.handover?.approvedBy).toBe("string");

      const rebindResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/handover/${handoverCaseId}/rebind`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeEmail: "bob@example.com",
          },
        }),
        resolvedAuth,
      );
      const rebindPayload = parsePayload<{
        updatedSnapshot?: {
          organization?: {
            occupiedSeatCount?: number;
            vacantSeatCount?: number;
          };
        };
      }>(rebindResponse.end);
      expect(rebindPayload.updatedSnapshot?.organization?.occupiedSeatCount).toBe(1);
      expect(rebindPayload.updatedSnapshot?.organization?.vacantSeatCount).toBe(1);

      const detailResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats/${financeSeat?.seatId}`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const detailPayload = parsePayload<{
        detail?: {
          seat?: { status?: string };
          currentEmployee?: { email?: string };
          handover?: { status?: string };
        };
      }>(detailResponse.end);
      expect(detailPayload.detail?.seat?.status).toBe("occupied");
      expect(detailPayload.detail?.currentEmployee?.email).toBe("bob@example.com");
      expect(detailPayload.detail?.handover?.status).toBe("completed");

      const accessResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/access/snapshot`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const accessPayload = parsePayload<{
        access: Array<{ subjectId: string; resourceId: string; revokedAt?: string }>;
        members: Array<{ userId: string; email: string }>;
      }>(accessResponse.end);
      const bob = accessPayload.members.find((member) => member.email === "bob@example.com");
      expect(bob).toBeTruthy();
      expect(
        accessPayload.access.some(
          (policy) =>
            policy.subjectId === bob?.userId &&
            policy.resourceId === financeSeat?.seatId &&
            !policy.revokedAt,
        ),
      ).toBe(true);
      expect(
        accessPayload.access.some(
          (policy) =>
            policy.subjectId === bob?.userId &&
            policy.resourceId === supportSeat?.seatId &&
            typeof policy.revokedAt === "string",
        ),
      ).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("routes seat assignment offers through enterprise admin and employee confirmation flows", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-offers-"));
    try {
      const platformStorePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: platformStorePath,
        },
      };
      const resolvedAuth: ResolvedGatewayAuth = {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy,
      };

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          body: {
            email: "ops@example.com",
            password: "password-123",
            displayName: "Ops",
          },
        }),
        resolvedAuth,
      );

      const createResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
          method: "POST",
          body: {
            enterpriseName: "Acme",
            adminName: "Owner",
            adminEmail: "owner@example.com",
          },
        }),
        resolvedAuth,
      );
      const createPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(createResponse.end);
      const adminCode = createPayload.platformAuth?.pendingActivation?.code;
      expect(typeof adminCode).toBe("string");

      const activateResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
          method: "POST",
          body: {
            email: "owner@example.com",
            displayName: "Owner",
            password: "password-123",
            code: adminCode,
          },
        }),
        resolvedAuth,
      );
      const activatePayload = parsePayload<{
        session?: { tenantId?: string };
      }>(activateResponse.end);
      const tenantId = activatePayload.session?.tenantId;
      expect(typeof tenantId).toBe("string");
      const adminCookie = getPrimarySetCookie(activateResponse.setHeader);
      expect(typeof adminCookie).toBe("string");
      const adminSessionCookie = String(adminCookie).split(";")[0];

      const primarySeatId = await createVacantPosition({
        tenantId: String(tenantId),
        title: "Primary Seat",
        cookie: adminSessionCookie,
        resolvedAuth,
      });
      const provisionResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeName: "Alice",
            employeeEmail: "alice@example.com",
            positionId: primarySeatId,
          },
        }),
        resolvedAuth,
      );
      const provisionPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(provisionResponse.end);
      const employeeCode = provisionPayload.platformAuth?.pendingActivation?.code;
      expect(typeof employeeCode).toBe("string");

      const registerResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/register`,
          method: "POST",
          body: {
            email: "alice@example.com",
            displayName: "Alice",
            password: "password-123",
            code: employeeCode,
          },
        }),
        resolvedAuth,
      );
      const employeeCookie = getPrimarySetCookie(registerResponse.setHeader);
      expect(typeof employeeCookie).toBe("string");
      const employeeSessionCookie = String(employeeCookie).split(";")[0];

      const createSeatResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            title: "Finance Successor",
            responsibility: "Own finance operations and reporting automations.",
          },
        }),
        resolvedAuth,
      );
      const createSeatPayload = parsePayload<{
        seat?: { seatId?: string; roleCode?: string; defaultAgentAssetIds?: string[] };
      }>(createSeatResponse.end);
      const offerSeatId = createSeatPayload.seat?.seatId;
      expect(typeof offerSeatId).toBe("string");
      expect(createSeatPayload.seat?.roleCode).toBe("FIN-L1-001");
      expect(createSeatPayload.seat?.defaultAgentAssetIds).toEqual([]);

      const offerResponse = await withEnvAsync(NO_SMTP_ENV, () =>
        sendControlUiRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats/${offerSeatId}/offers`,
            method: "POST",
            cookie: adminSessionCookie,
            body: {
              employeeEmail: "alice@example.com",
            },
          }),
          resolvedAuth,
        ),
      );
      const offerPayload = parsePayload<{
        offer?: { assignmentId?: string; offerId?: string; status?: string };
        emailDelivery?: { status?: string; reason?: string };
        updatedSnapshot?: {
          organization?: {
            pendingOfferCount?: number;
            offers?: Array<{
              assignmentId?: string;
              seatTitle?: string;
              targetEmployeeUser?: string;
              status?: string;
              agentIds?: string[];
            }>;
          };
        };
      }>(offerResponse.end);
      const offerId = offerPayload.offer?.offerId;
      const assignmentId = offerPayload.offer?.assignmentId;
      expect(offerPayload.offer?.status).toBe("pending");
      expect(typeof assignmentId).toBe("string");
      expect(offerPayload.emailDelivery).toMatchObject({
        status: "queued",
        reason: "smtp_not_configured",
      });
      expect(offerPayload.updatedSnapshot?.organization?.pendingOfferCount).toBe(1);
      expect(offerPayload.updatedSnapshot?.organization?.offers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignmentId,
            seatTitle: "Finance Successor",
            targetEmployeeUser: "alice@example.com",
            status: "pending",
          }),
        ]),
      );

      const remindResponse = await withEnvAsync(NO_SMTP_ENV, () =>
        sendControlUiRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/offers/${offerId}/remind`,
            method: "POST",
            cookie: adminSessionCookie,
            body: {},
          }),
          resolvedAuth,
        ),
      );
      const remindPayload = parsePayload<{
        offer?: { assignmentId?: string; status?: string };
        emailDelivery?: { status?: string; reason?: string };
        updatedSnapshot?: { organization?: { pendingOfferCount?: number } };
      }>(remindResponse.end);
      expect(remindPayload.offer?.status).toBe("pending");
      expect(remindPayload.offer?.assignmentId).toBe(assignmentId);
      expect(remindPayload.emailDelivery).toMatchObject({
        status: "queued",
        reason: "smtp_not_configured",
      });
      expect(remindPayload.updatedSnapshot?.organization?.pendingOfferCount).toBe(1);

      const storeAfterReminder = JSON.parse(await fs.readFile(platformStorePath, "utf8")) as {
        leadNotifications?: Record<
          string,
          {
            type?: string;
            email?: string;
            payload?: {
              assignmentId?: string;
              confirmationUrl?: string;
              offerId?: string;
              agentIds?: string[];
            };
          }
        >;
      };
      expect(Object.values(storeAfterReminder.leadNotifications ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "seat-assignment-offer-email",
            email: "alice@example.com",
            payload: expect.objectContaining({
              assignmentId,
              offerId,
              agentIds: [],
              confirmationUrl: expect.stringContaining("seatOffer="),
            }),
          }),
          expect.objectContaining({
            type: "seat-assignment-offer-reminder-email",
            email: "alice@example.com",
            payload: expect.objectContaining({
              assignmentId,
              offerId,
              agentIds: [],
              confirmationUrl: expect.stringContaining("workbench=settings"),
            }),
          }),
        ]),
      );

      const acceptResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee-access/offer/accept`,
          method: "POST",
          cookie: employeeSessionCookie,
          body: {
            offerId,
          },
        }),
        resolvedAuth,
      );
      const acceptPayload = parsePayload<{
        platformAuth?: {
          employeeAccess?: {
            currentSeat?: { title?: string };
            pendingOffer?: { assignmentId?: string };
            agentIds?: string[];
          };
        };
      }>(acceptResponse.end);
      expect(acceptPayload.platformAuth?.employeeAccess?.currentSeat?.title).toBe(
        "Finance Successor",
      );
      expect(acceptPayload.platformAuth?.employeeAccess?.agentIds).toEqual(["main"]);
      expect(acceptPayload.platformAuth?.employeeAccess?.pendingOffer).toBeFalsy();

      const accessResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/access/snapshot`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const accessPayload = parsePayload<{
        access: Array<{
          subjectType?: string;
          subjectId: string;
          resourceType?: string;
          resourceId: string;
          action?: string;
          revokedAt?: string;
        }>;
        members: Array<{ userId: string; email: string }>;
      }>(accessResponse.end);
      const alice = accessPayload.members.find((member) => member.email === "alice@example.com");
      expect(alice).toBeTruthy();
      expect(
        accessPayload.access.some(
          (policy) =>
            policy.subjectId === alice?.userId &&
            policy.resourceType === "agent" &&
            policy.resourceId === "main" &&
            !policy.revokedAt,
        ),
      ).toBe(true);

      const declineSeatResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            title: "Support Successor",
          },
        }),
        resolvedAuth,
      );
      const declineSeatPayload = parsePayload<{
        seat?: { seatId?: string };
      }>(declineSeatResponse.end);
      const declineSeatId = declineSeatPayload.seat?.seatId;

      const declineOfferResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats/${declineSeatId}/offers`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeEmail: "alice@example.com",
          },
        }),
        resolvedAuth,
      );
      const declineOfferPayload = parsePayload<{
        offer?: { offerId?: string };
      }>(declineOfferResponse.end);

      const declineResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee-access/offer/decline`,
          method: "POST",
          cookie: employeeSessionCookie,
          body: {
            offerId: declineOfferPayload.offer?.offerId,
          },
        }),
        resolvedAuth,
      );
      const declinePayload = parsePayload<{
        platformAuth?: {
          employeeAccess?: {
            currentSeat?: { title?: string };
            pendingOffer?: unknown;
          };
        };
      }>(declineResponse.end);
      expect(declinePayload.platformAuth?.employeeAccess?.currentSeat?.title).toBe(
        "Finance Successor",
      );
      expect(declinePayload.platformAuth?.employeeAccess?.pendingOffer).toBeFalsy();

      const cancelSeatResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            title: "Revokable Offer Seat",
          },
        }),
        resolvedAuth,
      );
      const cancelSeatPayload = parsePayload<{
        seat?: { seatId?: string };
      }>(cancelSeatResponse.end);

      const cancelOfferResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats/${cancelSeatPayload.seat?.seatId}/offers`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeEmail: "alice@example.com",
          },
        }),
        resolvedAuth,
      );
      const cancelOfferPayload = parsePayload<{
        offer?: { offerId?: string };
      }>(cancelOfferResponse.end);

      const cancelResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/offers/${cancelOfferPayload.offer?.offerId}/cancel`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {},
        }),
        resolvedAuth,
      );
      const cancelPayload = parsePayload<{
        offer?: { status?: string };
        updatedSnapshot?: { organization?: { pendingOfferCount?: number } };
      }>(cancelResponse.end);
      expect(cancelPayload.offer?.status).toBe("canceled");
      expect(cancelPayload.updatedSnapshot?.organization?.pendingOfferCount).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the configured public app base URL for seat-offer confirmation links", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-offers-"));
    try {
      const platformStorePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: platformStorePath,
        },
      };
      const resolvedAuth: ResolvedGatewayAuth = {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy,
      };

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          body: {
            email: "ops@example.com",
            password: "password-123",
            displayName: "Ops",
          },
        }),
        resolvedAuth,
      );

      const createResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
          method: "POST",
          body: {
            enterpriseName: "Acme",
            adminName: "Owner",
            adminEmail: "owner@example.com",
          },
        }),
        resolvedAuth,
      );
      const createPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(createResponse.end);
      const adminCode = createPayload.platformAuth?.pendingActivation?.code;
      const activateResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
          method: "POST",
          body: {
            email: "owner@example.com",
            displayName: "Owner",
            password: "password-123",
            code: adminCode,
          },
        }),
        resolvedAuth,
      );
      const activatePayload = parsePayload<{ session?: { tenantId?: string } }>(
        activateResponse.end,
      );
      const tenantId = activatePayload.session?.tenantId;
      const adminSessionCookie = String(getPrimarySetCookie(activateResponse.setHeader)).split(
        ";",
      )[0];

      const primarySeatId = await createVacantPosition({
        tenantId: String(tenantId),
        title: "Primary Seat",
        cookie: adminSessionCookie,
        resolvedAuth,
      });
      const provisionResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeName: "Alice",
            employeeEmail: "alice@example.com",
            positionId: primarySeatId,
          },
        }),
        resolvedAuth,
      );
      const provisionPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(provisionResponse.end);
      const employeeCode = provisionPayload.platformAuth?.pendingActivation?.code;
      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/register`,
          method: "POST",
          body: {
            email: "alice@example.com",
            displayName: "Alice",
            password: "password-123",
            code: employeeCode,
          },
        }),
        resolvedAuth,
      );

      const createSeatResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            title: "Finance Successor",
          },
        }),
        resolvedAuth,
      );
      const createSeatPayload = parsePayload<{ seat?: { seatId?: string } }>(
        createSeatResponse.end,
      );
      const offerSeatId = createSeatPayload.seat?.seatId;

      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love",
          ...NO_SMTP_ENV,
        },
        async () => {
          const offerResponse = await sendControlUiRequest(
            makeJsonRequest({
              url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats/${offerSeatId}/offers`,
              method: "POST",
              cookie: adminSessionCookie,
              body: {
                employeeEmail: "alice@example.com",
              },
            }),
            resolvedAuth,
          );
          const offerPayload = parsePayload<{
            emailDelivery?: { status?: string; reason?: string };
          }>(offerResponse.end);
          expect(offerPayload.emailDelivery).toMatchObject({
            status: "queued",
            reason: "smtp_not_configured",
          });
          const storeAfterOffer = JSON.parse(await fs.readFile(platformStorePath, "utf8")) as {
            leadNotifications?: Record<string, { payload?: { confirmationUrl?: string } }>;
          };
          expect(Object.values(storeAfterOffer.leadNotifications ?? {})).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                payload: expect.objectContaining({
                  confirmationUrl: expect.stringContaining(
                    "https://www.openbot.love/enterprise/login?workbench=settings&settingsView=personal&seatOffer=",
                  ),
                }),
              }),
            ]),
          );
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("canonicalizes legacy tenant ids when loading enterprise seat assets store", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-assets-"));
    try {
      const storePath = path.join(tempDir, "seat-assets.json");
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            version: 1,
            seats: {
              "seat-1": {
                seatId: "seat-1",
                tenantId: "upbeyond-91aeea3c",
                title: "销售经理",
                status: "vacant",
                defaultSpaceIds: [],
                defaultAgentAssetIds: [],
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              },
            },
            bindings: {},
            accessPolicies: {},
            handovers: {},
            offers: {},
          },
          null,
          2,
        ),
        "utf8",
      );

      const { loadEnterpriseSeatAssetsStore } = await import("./enterprise-seat-assets-store.js");
      const loaded = await loadEnterpriseSeatAssetsStore(storePath);
      expect(loaded.seats["seat-1"]?.tenantId).toBe("001");
      expect(loaded.assetBindings).toEqual({});
      expect(loaded.credentialBindings).toEqual({});
      expect(loaded.auditEvents).toEqual({});
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads and saves enterprise seat assets through a backend adapter", async () => {
    const {
      createEnterpriseSeatAssetsJsonBackend,
      createEnterpriseSeatAssetsSqliteBackend,
      migrateEnterpriseSeatAssetsJsonToSqlite,
      normalizeEnterpriseSeatAssetsStore,
    } = await import("./enterprise-seat-assets-backend.js");
    const { loadEnterpriseSeatAssetsStoreFromBackend, saveEnterpriseSeatAssetsStoreToBackend } =
      await import("./enterprise-seat-assets-store.js");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-backend-"));
    try {
      const storePath = path.join(tempDir, "seat-assets.json");
      const backend = createEnterpriseSeatAssetsJsonBackend({ storePath });
      const initial = normalizeEnterpriseSeatAssetsStore(null, 2);
      initial.seats["seat-1"] = {
        seatId: "seat-1",
        tenantId: "001",
        title: "Finance Lead",
        status: "vacant",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      };
      await saveEnterpriseSeatAssetsStoreToBackend(backend, initial);

      const loaded = await loadEnterpriseSeatAssetsStoreFromBackend(backend);
      expect(loaded.seats["seat-1"]).toMatchObject({
        tenantId: "001",
        title: "Finance Lead",
        status: "vacant",
      });

      const sqliteBackend = createEnterpriseSeatAssetsSqliteBackend({
        storePath: path.join(tempDir, "seat-assets.sqlite"),
      });
      await saveEnterpriseSeatAssetsStoreToBackend(sqliteBackend, initial);
      const sqliteLoaded = await loadEnterpriseSeatAssetsStoreFromBackend(sqliteBackend);
      expect(sqliteLoaded.seats["seat-1"]).toMatchObject({
        tenantId: "001",
        title: "Finance Lead",
        status: "vacant",
      });

      const migrated = await migrateEnterpriseSeatAssetsJsonToSqlite({
        sourcePath: storePath,
        targetPath: path.join(tempDir, "seat-assets-migrated.sqlite"),
      });
      expect(migrated).toMatchObject({
        seats: 1,
        bindings: 0,
        accessPolicies: 0,
        assetBindings: 0,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses sqlite backend from config when loading and saving without an explicit store path", async () => {
    const { loadEnterpriseSeatAssetsStore, saveEnterpriseSeatAssetsStore } =
      await import("./enterprise-seat-assets-store.js");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-enterprise-backend-config-"));
    try {
      const sqlitePath = path.join(tempDir, "seat-assets.sqlite");
      await withTempConfig({
        cfg: {
          gateway: {
            enterpriseSeatAssets: {
              backend: "sqlite",
              store: sqlitePath,
            },
          },
        },
        run: async () => {
          const store = await loadEnterpriseSeatAssetsStore();
          store.seats["seat-1"] = {
            seatId: "seat-1",
            tenantId: "001",
            title: "Ops Lead",
            status: "vacant",
            defaultSpaceIds: [],
            defaultAgentAssetIds: [],
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
          };
          await saveEnterpriseSeatAssetsStore(undefined, store);

          const reloaded = await loadEnterpriseSeatAssetsStore();
          expect(reloaded.seats["seat-1"]).toMatchObject({
            tenantId: "001",
            title: "Ops Lead",
            status: "vacant",
          });
        },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("governs position-owned memory and connector credentials through handover succession", async () => {
    const {
      acceptSeatAssignmentOffer,
      assignSeatToEmployee,
      configureSeatProfile,
      createSeatAssignmentOffer,
      ensureSeatForProvision,
      registerConnectorCredentialBinding,
      resolveSeatMemoryScopeId,
      nominateSeatHandoverSuccessor,
      startSeatHandover,
      validateEnterpriseAssetGovernance,
    } = await import("./enterprise-seat-assets-store.js");
    const nowIso = "2026-06-03T00:00:00.000Z";
    const store: EnterpriseSeatAssetsStore = {
      version: 2,
      seats: {},
      bindings: {},
      accessPolicies: {},
      assetBindings: {},
      credentialBindings: {},
      handovers: {},
      offers: {},
      auditEvents: {},
      enterpriseIdentities: {},
      identityUsagePolicies: {},
      dataSourceIdentityBindings: {},
      employeeIdentityEnrollments: {},
    };

    const seat = ensureSeatForProvision({
      store,
      tenantId: "tenant-1",
      seatTitle: "Sales Manager",
      defaultAgentId: "agent-sales",
      defaultSpaceIds: ["space-sales"],
      nowIso,
      actorEmployeeId: "admin-1",
      auditId: "audit-create-seat",
    });
    const memoryScopeId = resolveSeatMemoryScopeId(seat.seatId);
    expect(
      Object.values(store.assetBindings).some(
        (binding) =>
          binding.assetType === "memory" &&
          binding.assetId === memoryScopeId &&
          binding.status === "active",
      ),
    ).toBe(true);

    assignSeatToEmployee({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      employeeId: "employee-out",
      nowIso: "2026-06-03T01:00:00.000Z",
      actorEmployeeId: "admin-1",
      auditId: "audit-assign-out",
    });
    configureSeatProfile({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      agentIds: ["agent-sales", "agent-backup"],
      defaultAgentId: "agent-sales",
      nowIso: "2026-06-03T01:02:00.000Z",
      actorEmployeeId: "admin-1",
      auditId: "audit-configure-agents",
    });
    registerConnectorCredentialBinding({
      store,
      tenantId: "tenant-1",
      connectorId: "gmail-sales",
      ownerType: "employee",
      ownerId: "employee-out",
      createdBy: "employee-out",
      nowIso: "2026-06-03T01:05:00.000Z",
      auditId: "audit-credential",
    });

    const handover = startSeatHandover({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      nowIso: "2026-06-03T02:00:00.000Z",
      actorEmployeeId: "admin-1",
      auditId: "audit-handover",
    });
    expect(handover.status).toBe("draft");
    expect(handover.assetSnapshot).toBeUndefined();

    const nominated = nominateSeatHandoverSuccessor({
      store,
      tenantId: "tenant-1",
      handoverCaseId: handover.handoverCaseId,
      incomingEmployeeId: "employee-in",
      nowIso: "2026-06-03T02:10:00.000Z",
      actorEmployeeId: "admin-1",
      auditId: "audit-nominate",
    });
    expect(nominated.status).toBe("asset_review");
    expect(nominated.assetSnapshot?.memoryScopeIds).toEqual([memoryScopeId]);
    expect(nominated.assetSnapshot?.credentialBindings).toEqual([
      expect.objectContaining({
        connectorId: "gmail-sales",
        ownerType: "employee",
        status: "reauthorization_required",
      }),
    ]);

    const { reviewSeatHandover } = await import("./enterprise-seat-assets-store.js");
    const reviewed = reviewSeatHandover({
      store,
      tenantId: "tenant-1",
      handoverCaseId: nominated.handoverCaseId,
      reviewSummary: "Transfer only the sales agent; exclude shared memory.",
      transferSelection: {
        agentIds: ["agent-sales"],
        spaceIds: ["space-sales"],
        dataKeys: ["recent_sessions", "knowledge"],
        policyIds: [],
      },
      nowIso: "2026-06-03T02:20:00.000Z",
      actorEmployeeId: "admin-1",
      auditId: "audit-review",
    });
    expect(reviewed.status).toBe("pending_approval");
    expect(reviewed.transferSelection).toEqual({
      agentIds: ["agent-sales"],
      spaceIds: ["space-sales"],
      dataKeys: ["recent_sessions", "knowledge"],
      policyIds: [],
    });
    expect(reviewed.assetSnapshot?.agentIds).toEqual(["agent-sales"]);
    expect(reviewed.assetSnapshot?.spaceIds).toEqual(["space-sales"]);
    expect(reviewed.assetSnapshot?.dataKeys).toEqual(["recent_sessions", "knowledge"]);
    expect(reviewed.assetSnapshot?.memoryScopeIds).toEqual([memoryScopeId]);
    expect(reviewed.assetSnapshot?.sessionDataTransfer).toEqual({
      recentSessions: true,
      historyArchive: false,
      coveredAgentIds: ["agent-sales"],
    });
    expect(store.seats[seat.seatId]?.defaultAgentAssetIds).toEqual(["agent-sales"]);
    expect(
      Object.values(store.assetBindings).find(
        (binding) =>
          binding.seatId === seat.seatId &&
          binding.assetType === "agent" &&
          binding.assetId === "agent-backup",
      )?.status,
    ).toBe("revoked");

    expect(
      Object.values(store.assetBindings).find(
        (binding) =>
          binding.seatId === seat.seatId &&
          binding.assetType === "agent" &&
          binding.assetId === "agent-sales",
      )?.status,
    ).toBe("active");

    const offer = createSeatAssignmentOffer({
      store,
      tenantId: "tenant-1",
      seatId: seat.seatId,
      targetEmployeeId: "employee-in",
      offeredByEmployeeId: "admin-1",
      assignmentType: "internal",
      handoverCaseId: nominated.handoverCaseId,
      nowIso: "2026-06-03T03:00:00.000Z",
      auditId: "audit-offer",
    });
    expect(store.seats[seat.seatId]?.status).toBe("assigned");
    expect(offer.packageSnapshot.memoryScopeIds).toEqual([memoryScopeId]);

    acceptSeatAssignmentOffer({
      store,
      tenantId: "tenant-1",
      offerId: offer.offerId,
      employeeId: "employee-in",
      nowIso: "2026-06-03T04:00:00.000Z",
      auditId: "audit-accept",
    });
    expect(store.seats[seat.seatId]?.currentEmployeeId).toBe("employee-in");
    expect(
      Object.values(store.assetBindings).find(
        (binding) => binding.assetType === "memory" && binding.assetId === memoryScopeId,
      )?.status,
    ).toBe("active");
    expect(
      Object.values(store.credentialBindings).find(
        (binding) => binding.connectorId === "gmail-sales",
      )?.status,
    ).toBe("reauthorization_required");
    expect(validateEnterpriseAssetGovernance(store, "tenant-1")).toEqual([]);
    expect(Object.values(store.auditEvents).map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "seat.created",
        "seat.assigned",
        "credential.registered",
        "handover.started",
        "assignment.created",
        "seat.assets_configured",
        "asset.inheritance.applied",
        "assignment.accepted",
        "handover.completed",
      ]),
    );
  });

  it("allows enterprise seat writes on configured public reverse-proxy entry", async () => {
    await withEnvAsync({ OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love" }, async () => {
      const req = makeJsonRequest({
        url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/001/seats`,
        method: "POST",
        body: { title: "Public Seat" },
      });
      Object.assign(req.headers, {
        host: "www.openbot.love",
        "x-forwarded-host": "www.openbot.love",
        "x-forwarded-proto": "https",
      });
      Object.defineProperty(req, "socket", {
        value: { remoteAddress: "127.0.0.1" },
        configurable: true,
      });
      const response = makeMockHttpResponse();
      const handled = await handleEnterpriseSeatAssetsHttpRequest(req, response.res, {
        trustedProxy: undefined,
        localDirect: false,
      });
      expect(handled).toBe(true);
      const payload = parsePayload<{ code?: string }>(response.end);
      expect(payload.code).not.toBe("ENTERPRISE_ASSETS_LOCAL_ONLY");
    });
  });

  it("deletes a pending-activation seat and revokes its employee provision", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-delete-pending-seat-"));
    try {
      const platformStorePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: platformStorePath,
        },
      };
      const resolvedAuth: ResolvedGatewayAuth = {
        mode: "trusted-proxy",
        allowTailscale: false,
        trustedProxy,
      };

      await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          body: {
            email: "ops@example.com",
            password: "password-123",
            displayName: "Ops",
          },
        }),
        resolvedAuth,
      );

      const createResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
          method: "POST",
          body: {
            enterpriseName: "Acme",
            adminName: "Owner",
            adminEmail: "owner@example.com",
          },
        }),
        resolvedAuth,
      );
      const createPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
      }>(createResponse.end);
      const adminCode = createPayload.platformAuth?.pendingActivation?.code;
      expect(typeof adminCode).toBe("string");

      const activateResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
          method: "POST",
          body: {
            email: "owner@example.com",
            displayName: "Owner",
            password: "password-123",
            code: adminCode,
          },
        }),
        resolvedAuth,
      );
      const activatePayload = parsePayload<{
        session?: { tenantId?: string };
      }>(activateResponse.end);
      const tenantId = activatePayload.session?.tenantId;
      expect(typeof tenantId).toBe("string");
      const adminCookie = getPrimarySetCookie(activateResponse.setHeader);
      expect(typeof adminCookie).toBe("string");
      const adminSessionCookie = String(adminCookie).split(";")[0];

      const pendingSeatId = await createVacantPosition({
        tenantId: String(tenantId),
        title: "Pending Seat",
        cookie: adminSessionCookie,
        resolvedAuth,
      });
      const provisionResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/provision`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            employeeName: "Pending Hire",
            employeeEmail: "pending-hire@example.com",
            positionId: pendingSeatId,
          },
        }),
        resolvedAuth,
      );
      const provisionPayload = parsePayload<{
        platformAuth?: { pendingActivation?: { code?: string } };
        ok?: boolean;
      }>(provisionResponse.end);
      expect(provisionPayload.ok).toBe(true);
      expect(typeof provisionPayload.platformAuth?.pendingActivation?.code).toBe("string");

      const seatsResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const seatsPayload = parsePayload<{
        seats: Array<{ seatId: string; title: string; status: string }>;
      }>(seatsResponse.end);
      const pendingSeat = seatsPayload.seats.find((seat) => seat.title === "Pending Seat");
      expect(pendingSeat?.seatId).toBeTruthy();
      expect(pendingSeat?.status).toBe("assigned");

      const storeBeforeDelete = JSON.parse(await fs.readFile(platformStorePath, "utf8")) as {
        employeeProvisions?: Record<
          string,
          { seatId?: string; status?: string; normalizedEmployeeEmail?: string }
        >;
        activationCodes?: Record<string, { provisionId?: string; status?: string }>;
      };
      const pendingProvision = Object.values(storeBeforeDelete.employeeProvisions ?? {}).find(
        (entry) => entry.seatId === pendingSeat?.seatId && entry.status === "pending_activation",
      );
      expect(pendingProvision?.normalizedEmployeeEmail).toBe("pending-hire@example.com");

      const deleteResponse = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/organization/departments`,
          method: "POST",
          cookie: adminSessionCookie,
          body: {
            action: "delete-seat",
            seatId: pendingSeat?.seatId,
          },
        }),
        resolvedAuth,
      );
      const deletePayload = parsePayload<{
        ok?: boolean;
        affectedSeatIds?: string[];
      }>(deleteResponse.end);
      expect(deletePayload.ok).toBe(true);
      expect(deletePayload.affectedSeatIds).toEqual([pendingSeat?.seatId]);

      const seatsAfter = await sendControlUiRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_ENTERPRISE_BASE_PATH}/${tenantId}/seats`,
          method: "GET",
          cookie: adminSessionCookie,
        }),
        resolvedAuth,
      );
      const seatsAfterPayload = parsePayload<{
        seats: Array<{ seatId: string; title: string }>;
      }>(seatsAfter.end);
      expect(
        seatsAfterPayload.seats.find((seat) => seat.seatId === pendingSeat?.seatId),
      ).toBeUndefined();

      const storeAfterDelete = JSON.parse(await fs.readFile(platformStorePath, "utf8")) as {
        employeeProvisions?: Record<
          string,
          { id?: string; seatId?: string; status?: string; revokedReason?: string }
        >;
        activationCodes?: Record<string, { provisionId?: string; status?: string }>;
      };
      const revokedProvision = Object.values(storeAfterDelete.employeeProvisions ?? {}).find(
        (entry) => entry.seatId === pendingSeat?.seatId,
      );
      expect(revokedProvision?.status).toBe("revoked");
      expect(revokedProvision?.revokedReason).toBe("seat_deleted");
      const relatedCodes = Object.values(storeAfterDelete.activationCodes ?? {}).filter(
        (entry) => entry.provisionId === revokedProvision?.id,
      );
      expect(relatedCodes.length).toBeGreaterThan(0);
      expect(relatedCodes.every((entry) => entry.status === "revoked")).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
