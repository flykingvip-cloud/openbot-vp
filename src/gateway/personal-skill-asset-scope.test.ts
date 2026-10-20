import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "./protocol/client-info.js";
import { ErrorCodes, validateConnectParams } from "./protocol/index.js";
import type { GatewayClient, GatewayRequestHandlerOptions } from "./server-methods/types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-personal-scope-${process.pid}-${Date.now()}`);
const getPairedDeviceMock = vi.hoisted(() => vi.fn());

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../infra/device-pairing.js", () => ({
  getPairedDevice: getPairedDeviceMock,
}));

const { isEmployeeMyAccumulationAsset } = await import("./personal-skill-asset-scope.js");
const { SkillAssetStoreError } = await import("./skill-lifecycle-store.js");
const {
  requirePersonalAssetOwner,
  resolvePersonalAssetOwnerIdentities,
  resolvePersonalAssetOwnerUserId,
} = await import("./personal-skill-asset-scope.js");
const { skillLifecycleHandlers } = await import("./server-methods/skill-lifecycle.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

const draftProfile = {
  name: "Gate skill",
  summary: "A draft.",
  assetType: "capability",
  visibility: "private",
};

function connectWithoutUser(): GatewayClient["connect"] {
  return {
    minProtocol: 1,
    maxProtocol: 1,
    client: {
      id: GATEWAY_CLIENT_IDS.CONTROL_UI,
      version: "dev",
      platform: "macos",
      mode: GATEWAY_CLIENT_MODES.WEBCHAT,
    },
    role: "operator",
    scopes: ["operator.write"],
    auth: { token: "gateway-token" },
  };
}

function client(partial: Partial<GatewayClient> = {}): GatewayClient {
  return {
    connect: connectWithoutUser(),
    ...partial,
  };
}

async function invoke(
  method: string,
  params: Record<string, unknown>,
  caller: GatewayClient | null,
): Promise<HandlerResponse> {
  const handler = skillLifecycleHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: caller,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("isEmployeeMyAccumulationAsset", () => {
  it("keeps user-saved executable capabilities", () => {
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "", assetType: "capability" },
        sourceLineageId: "customer-summary",
      }),
    ).toBe(true);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "稳定模式", assetType: "workflow" },
        sourceLineageId: "pattern-candidate:abc",
      }),
    ).toBe(true);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "", assetType: "tool" },
      }),
    ).toBe(true);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "", assetType: "mcp" },
      }),
    ).toBe(true);
  });

  it("hides knowledge-library documents that already live in 知识库", () => {
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "知识收录", assetType: "knowledge" },
        sourceLineageId: null,
      }),
    ).toBe(false);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "上传文档", assetType: "knowledge" },
      }),
    ).toBe(false);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "", assetType: "knowledge" },
      }),
    ).toBe(false);
  });

  it("hides auto-captured deliverables that belong in 成果中心", () => {
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "对话成果", assetType: "knowledge" },
        sourceLineageId: "agent:main:session",
      }),
    ).toBe(false);
  });

  it("hides enterprise and pack install copies", () => {
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "企业能力", assetType: "capability" },
        sourceLineageId: "enterprise-capability:manifest-1",
      }),
    ).toBe(false);
    expect(
      isEmployeeMyAccumulationAsset({
        profile: { category: "能力包", assetType: "capability" },
        sourceLineageId: "pack-install:starter",
      }),
    ).toBe(false);
  });
});

describe("personal asset owner identity", () => {
  beforeEach(() => {
    getPairedDeviceMock.mockReset();
    fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws SkillAssetStoreError when no authenticated owner is present", async () => {
    await expect(resolvePersonalAssetOwnerUserId(null)).resolves.toBeNull();
    await expect(resolvePersonalAssetOwnerUserId(client())).resolves.toBeNull();
    expect(() => requirePersonalAssetOwner(null)).toThrow(SkillAssetStoreError);
    expect(() => requirePersonalAssetOwner(null)).toThrow(
      "authenticated user required to save personal assets",
    );
  });

  it("rejects save and finalize without a server-stamped user", async () => {
    const anonymous = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      client(),
    );
    expect(anonymous.ok).toBe(false);
    expect(anonymous.error).toMatchObject({
      code: ErrorCodes.INVALID_REQUEST,
      message: "authenticated user required to save personal assets",
    });

    const saved = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      client({ user: "alice@example.com" }),
    );
    const skillId = (saved.payload as { skillId: string }).skillId;
    const finalized = await invoke("personal-skills.finalize-draft", { skillId }, null);
    expect(finalized.ok).toBe(false);
    expect(finalized.error).toMatchObject({
      code: ErrorCodes.INVALID_REQUEST,
      message: "authenticated user required for personal asset access",
    });
  });

  it("saves and finalizes for a platform user id without a connect user field", async () => {
    const caller = client({ platformUserId: "user-platform-1" });
    const saved = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      caller,
    );
    expect(saved.ok).toBe(true);
    const skillId = (saved.payload as { skillId: string }).skillId;
    const detail = await invoke("personal-skills.detail", { skillId }, caller);
    expect(detail.ok).toBe(true);
    expect((detail.payload as { ownerUserId?: string }).ownerUserId).toBe("user-platform-1");

    const finalized = await invoke("personal-skills.finalize-draft", { skillId }, caller);
    expect(finalized.ok).toBe(true);
    expect((finalized.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe("private");
  });

  it("stamps the platform user id ahead of the session email", async () => {
    const ids = await resolvePersonalAssetOwnerIdentities(
      client({ platformUserId: "user-platform-1", user: "Alice@Example.com" }),
    );
    expect(ids[0]).toBe("user-platform-1");
    expect(ids).toContain("alice@example.com");
  });

  it("rejects a connect device id that the handshake did not stamp as pairedDeviceId", async () => {
    getPairedDeviceMock.mockResolvedValue({ ownerId: "user-victim" });
    const caller = client({
      connect: {
        ...connectWithoutUser(),
        device: {
          id: "device-victim",
          publicKey: "pk",
          signature: "sig",
          signedAt: 1,
          nonce: "nonce",
        },
      },
    });
    const saved = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      caller,
    );
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatchObject({
      code: ErrorCodes.INVALID_REQUEST,
      message: "authenticated user required to save personal assets",
    });
    expect(getPairedDeviceMock).not.toHaveBeenCalled();
    expect(caller.platformUserId).toBeUndefined();
  });

  it("saves and finalizes from the server-set pairedDeviceId owner", async () => {
    getPairedDeviceMock.mockResolvedValue({ ownerId: "user-device-owner" });
    const caller = client({ pairedDeviceId: "device-mac" });
    const saved = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      caller,
    );
    expect(saved.ok).toBe(true);
    expect(getPairedDeviceMock).toHaveBeenCalledWith("device-mac");
    expect(caller.platformUserId).toBe("user-device-owner");
    const skillId = (saved.payload as { skillId: string }).skillId;
    const detail = await invoke("personal-skills.detail", { skillId }, caller);
    expect((detail.payload as { ownerUserId?: string }).ownerUserId).toBe("user-device-owner");
    const finalized = await invoke("personal-skills.finalize-draft", { skillId }, caller);
    expect(finalized.ok).toBe(true);
    expect((finalized.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe("private");
  });

  it("does not accept a top-level connect user as personal-asset identity", async () => {
    const valid = connectWithoutUser();
    expect(validateConnectParams(valid)).toBe(true);
    // connect.user is allowed as claimed identity (Control UI A+B), but must not
    // substitute for authenticated session subjects on personal-asset RPCs.
    const withUser = { ...valid, user: "alice@example.com" };
    expect(validateConnectParams(withUser)).toBe(true);

    const smuggled = await invoke(
      "skill-lifecycle.save",
      { sourceAgentId: "robot-alpha", profile: draftProfile },
      client({
        connect: { ...valid, user: "alice@example.com" } as GatewayClient["connect"],
      }),
    );
    expect(smuggled.ok).toBe(false);
    expect(smuggled.error).toMatchObject({
      code: ErrorCodes.INVALID_REQUEST,
      message: "authenticated user required to save personal assets",
    });
  });
});
