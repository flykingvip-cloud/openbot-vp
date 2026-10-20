import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseIdentity } from "./enterprise-operational-identity-types.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";

const sendEmailMock = vi.fn();
const loadSecretStoreMock = vi.fn();
const readEmailsMock = vi.fn();
const searchEmailsMock = vi.fn();
const replyEmailMock = vi.fn();
const wechatExecuteMock = vi.fn();

vi.mock("./enterprise-operational-identity-smtp-send.js", () => ({
  sendEnterpriseOperationalIdentityEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("./enterprise-operational-identity-imap-read.js", () => ({
  parseEnterpriseOperationalIdentityImapPayload: (value: unknown) => value,
  readEnterpriseOperationalIdentityEmails: (...args: unknown[]) => readEmailsMock(...args),
  searchEnterpriseOperationalIdentityEmails: (...args: unknown[]) => searchEmailsMock(...args),
  replyEnterpriseOperationalIdentityEmail: (...args: unknown[]) => replyEmailMock(...args),
}));

vi.mock("./enterprise-operational-identity-wechat-official-execution.js", () => ({
  parseEnterpriseOperationalIdentityWechatPayload: (value: unknown) => value,
  executeWechatOfficialOperationalAction: (...args: unknown[]) => wechatExecuteMock(...args),
}));

vi.mock("./enterprise-operational-identity-oauth/credential-secrets-persistence.js", () => ({
  loadEnterpriseOperationalIdentityCredentialSecretStore: () => loadSecretStoreMock(),
}));

const {
  parseEnterpriseOperationalIdentityExecutionPayload,
  executeEnterpriseOperationalIdentityAction,
} = await import("./enterprise-operational-identity-execution.js");

describe("parseEnterpriseOperationalIdentityExecutionPayload", () => {
  it("normalizes send_email and imap fields", () => {
    expect(
      parseEnterpriseOperationalIdentityExecutionPayload({
        to: " user@example.com ",
        subject: " Hello ",
        body: " World ",
        mailbox: " INBOX ",
        uid: "42",
        query: "invoice",
        unseen: "true",
        includeBody: "1",
      }),
    ).toMatchObject({
      to: "user@example.com",
      subject: "Hello",
      body: "World",
      mailbox: "INBOX",
      uid: 42,
      query: "invoice",
      unseen: true,
      includeBody: true,
    });
  });

  it("returns empty object for invalid input", () => {
    expect(parseEnterpriseOperationalIdentityExecutionPayload(null)).toEqual({});
  });
});

describe("executeEnterpriseOperationalIdentityAction", () => {
  const baseIdentity: EnterpriseIdentity = {
    identityId: "id-1",
    tenantId: "acme",
    displayName: "Mail",
    provider: "enterprise-email",
    credentialBindingId: "cred-1",
    status: "active",
    capabilities: ["send_email", "read_email", "search_email", "reply_email"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    loadSecretStoreMock.mockResolvedValue({
      secrets: {
        "cred-1": { accessToken: "secret", updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    });
  });

  it("rejects actions outside verified capabilities", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity: { ...baseIdentity, capabilities: ["send_email"] },
      action: "read_email",
      payload: {},
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("IDENTITY_005");
    expect(result.message).toContain("read_email");
    expect(readEmailsMock).not.toHaveBeenCalled();
  });

  it("executes send_email when capability and payload are valid", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    sendEmailMock.mockResolvedValue({
      messageId: "msg-1",
      from: "bot@example.com",
      status: "sent",
    });

    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity: baseIdentity,
      action: "send_email",
      payload: {
        to: "user@example.com",
        subject: "Hi",
        message: "Hello",
      },
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it("executes read_email via imap read layer", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    readEmailsMock.mockResolvedValue({
      mailbox: "INBOX",
      count: 1,
      messages: [{ uid: 42, subject: "Hello" }],
    });

    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity: baseIdentity,
      action: "read_email",
      payload: { uid: 42, includeBody: true },
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(readEmailsMock).toHaveBeenCalledOnce();
    expect(result.output.count).toBe(1);
  });

  it("executes search_email via imap search layer", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    searchEmailsMock.mockResolvedValue({
      mailbox: "INBOX",
      count: 0,
      messages: [],
    });

    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity: baseIdentity,
      action: "search_email",
      payload: { query: "invoice" },
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(searchEmailsMock).toHaveBeenCalledOnce();
  });

  it("executes reply_email via imap read + smtp reply", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    replyEmailMock.mockResolvedValue({
      uid: 42,
      to: "alice@example.com",
      subject: "Re: Hello",
      messageId: "reply-1",
      status: "sent",
    });

    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity: baseIdentity,
      action: "reply_email",
      payload: { uid: 42, message: "Thanks" },
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(replyEmailMock).toHaveBeenCalledOnce();
  });

  it("executes wechat-official publish_draft", async () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    wechatExecuteMock.mockResolvedValue({
      authorizerAppId: "wx-app",
      mediaId: "media-1",
      status: "draft_created",
    });
    const identity: EnterpriseIdentity = {
      identityId: "id-1",
      tenantId: "acme",
      displayName: "Official",
      provider: "wechat-official",
      credentialBindingId: "cred-1",
      status: "active",
      capabilities: ["publish_draft"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = await executeEnterpriseOperationalIdentityAction({
      store,
      tenantId: "acme",
      identity,
      action: "publish_draft",
      payload: {
        title: "Hi",
        content: "<p>Hello</p>",
        thumbMediaId: "thumb-1",
      },
      seatId: "seat-1",
      agentId: "agent-1",
      policyId: "policy-1",
      nowIso: "2026-06-06T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(wechatExecuteMock).toHaveBeenCalledOnce();
  });
});
