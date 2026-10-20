/**
 * Agent Install Request Handlers — 机器人自装与 Da Bai 代理安装请求 RPC 网关方法。
 *
 * 模块定位：
 * 本文件承载 Phase 2 的跨机器人安装请求流：
 * 1. 机器人自装请求（robot-self-install）
 * 2. Da Bai 代理安装请求（dabai-proxy-request）
 * 当前为 stub 实现，返回合理默认值以支撑 UI 闭环验证。
 *
 * 方法清单：
 * 1. agent-install.request-send           — 发送安装请求到目标机器人
 * 2. agent-install.request-review         — 目标机器人获取待审核请求
 * 3. agent-install.request-accept         — 目标机器人接受请求
 * 4. agent-install.request-reject         — 目标机器人拒绝请求
 * 5. agent-install.request-suggest-alternative — 目标机器人建议替代能力
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { createInstallRequest, executeInstallConfirmation } from "./employee-install.js";
import {
  resolvePackSkillInstallBlock,
  respondIfPackSkillReviewBlocked,
} from "./pack-skill-review-install.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const STORE_DIR = path.join(os.homedir(), ".config", "openbot", "stores");
const AGENT_INSTALL_STORE_FILE = path.join(STORE_DIR, "agent-install-request.json");

let loadAttempted = false;

interface SerializedAgentInstallStore {
  requests: Array<[string, StubAgentInstallRequest]>;
}

function ensureLoaded(): void {
  if (loadAttempted) {
    return;
  }
  loadAttempted = true;
  try {
    if (!fs.existsSync(AGENT_INSTALL_STORE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(AGENT_INSTALL_STORE_FILE, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as SerializedAgentInstallStore;
    if (parsed.requests) {
      for (const [key, value] of parsed.requests) {
        stubAgentInstallRequests.set(key, value);
      }
    }
  } catch (err) {
    console.warn("[agent-install-request] load failed:", err);
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    const payload: SerializedAgentInstallStore = {
      requests: Array.from(stubAgentInstallRequests.entries()),
    };
    fs.writeFileSync(AGENT_INSTALL_STORE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    console.warn("[agent-install-request] persist failed:", err);
  }
}

// 导出测试辅助以便集成测试可以重置 store
export const __agentInstallRequestStoreInternals = {
  reset: () => {
    loadAttempted = false;
    stubAgentInstallRequests.clear();
    try {
      if (fs.existsSync(AGENT_INSTALL_STORE_FILE)) {
        fs.unlinkSync(AGENT_INSTALL_STORE_FILE);
      }
    } catch {
      // ignore
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function requiredString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | undefined {
  const value = params[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `missing or empty param: ${key}`),
  );
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Stub install request store (with file persistence)
// ─────────────────────────────────────────────────────────────────────────

type StubAgentInstallRequest = {
  requestId: string;
  actorType: "dabai-proxy" | "robot-self";
  actorId: string;
  targetRobotId: string;
  targetRobotName: string;
  capabilityId: string;
  capabilityName: string;
  capabilityVersion: string;
  capabilitySource: "platform-marketplace" | "enterprise-distributed" | "external-local";
  status: string;
  targetReviewStatus: string;
  targetReviewNote?: string;
  rejectionReason?: string;
  alternativeSuggestion?: {
    capabilityId: string;
    capabilityName: string;
    reason: string;
  };
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

const stubAgentInstallRequests = new Map<string, StubAgentInstallRequest>();

function generateRequestId(): string {
  return `ai-${randomUUID()}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

export const agentInstallRequestHandlers: GatewayRequestHandlers = {
  "agent-install.request-send": ({ params, respond, client }) => {
    ensureLoaded();
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    if (!targetRobotId || !capabilityId) {
      return;
    }
    const capabilityName =
      typeof params.capabilityName === "string" ? params.capabilityName : capabilityId;
    const actorType =
      params.actorType === "dabai-proxy" || params.actorType === "robot-self"
        ? params.actorType
        : "robot-self";
    const actorId =
      typeof params.actorId === "string" ? params.actorId : (client?.user ?? "anonymous");

    const requestId = generateRequestId();
    const now = Date.now();
    const request: StubAgentInstallRequest = {
      requestId,
      actorType,
      actorId,
      targetRobotId,
      targetRobotName:
        typeof params.targetRobotName === "string" ? params.targetRobotName : targetRobotId,
      capabilityId,
      capabilityName,
      capabilityVersion:
        typeof params.capabilityVersion === "string" ? params.capabilityVersion : "1.0.0",
      capabilitySource:
        params.capabilitySource === "platform-marketplace" ||
        params.capabilitySource === "enterprise-distributed" ||
        params.capabilitySource === "external-local"
          ? params.capabilitySource
          : "platform-marketplace",
      status: "pending-target-review",
      targetReviewStatus: "sent",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    stubAgentInstallRequests.set(requestId, request);
    persist();

    respond(
      true,
      {
        requestId,
        status: request.status,
        targetReviewStatus: request.targetReviewStatus,
        message: "安装请求已发送至目标机器人等待审核",
      },
      undefined,
    );
  },

  "agent-install.request-review": ({ params, respond }) => {
    ensureLoaded();
    const targetRobotId = requiredString(params, "targetRobotId", respond);
    if (!targetRobotId) {
      return;
    }

    const pending = Array.from(stubAgentInstallRequests.values()).filter(
      (r) => r.targetRobotId === targetRobotId && r.targetReviewStatus === "sent",
    );

    respond(
      true,
      {
        targetRobotId,
        pendingRequests: pending.map((r) => ({
          requestId: r.requestId,
          actorType: r.actorType,
          actorId: r.actorId,
          capabilityId: r.capabilityId,
          capabilityName: r.capabilityName,
          capabilityVersion: r.capabilityVersion,
          capabilitySource: r.capabilitySource,
          sentAt: r.createdAt,
        })),
        totalPending: pending.length,
      },
      undefined,
    );
  },

  "agent-install.request-accept": async ({ params, respond, client }) => {
    ensureLoaded();
    const requestId = requiredString(params, "requestId", respond);
    if (!requestId) {
      return;
    }

    const request = stubAgentInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const reviewBlock = await resolvePackSkillInstallBlock({
      client,
      capabilityId: request.capabilityId,
      targetRobotId: request.targetRobotId,
    });
    if (reviewBlock) {
      respondIfPackSkillReviewBlocked(respond, reviewBlock);
      return;
    }

    const now = Date.now();
    request.targetReviewStatus = "accepted";
    request.status = "installing";
    request.updatedAt = now;

    // P0-4: route into unified employee-install service
    const userEmail = typeof client?.user === "string" ? client.user : null;
    const installRequestId = `ei-${request.requestId}`;
    const installRequest = createInstallRequest({
      requestId: installRequestId,
      employeeId: request.actorId,
      targetRobotId: request.targetRobotId,
      targetRobotName: request.targetRobotName,
      capabilityId: request.capabilityId,
      capabilityName: request.capabilityName,
      source: request.actorType === "dabai-proxy" ? "dabai-proxy" : "robot-self",
    });

    try {
      const result = await executeInstallConfirmation(installRequest, userEmail, { client });
      request.status = result.status;
      request.completedAt = result.completedAt ?? now;
      persist();
      respond(
        true,
        {
          requestId,
          status: request.status,
          targetReviewStatus: request.targetReviewStatus,
          runtimeAgentId: request.targetRobotId,
          installRequestId,
          bindingId: result.bindingId,
          message: "目标机器人已接受安装请求，统一安装服务已完成运行时绑定",
        },
        undefined,
      );
    } catch (err) {
      request.status = "failed";
      request.completedAt = now;
      persist();
      if (respondIfPackSkillReviewBlocked(respond, err)) {
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "unified install confirmation failed",
        ),
      );
    }
  },

  "agent-install.request-reject": ({ params, respond }) => {
    ensureLoaded();
    const requestId = requiredString(params, "requestId", respond);
    if (!requestId) {
      return;
    }

    const request = stubAgentInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const now = Date.now();
    request.targetReviewStatus = "rejected";
    request.status = "rejected";
    request.rejectionReason =
      typeof params.rejectionReason === "string" ? params.rejectionReason : "目标机器人拒绝安装";
    request.updatedAt = now;
    request.completedAt = now;
    persist();

    respond(
      true,
      {
        requestId,
        status: request.status,
        targetReviewStatus: request.targetReviewStatus,
        rejectionReason: request.rejectionReason,
        message: "目标机器人已拒绝安装请求",
      },
      undefined,
    );
  },

  "agent-install.request-suggest-alternative": ({ params, respond }) => {
    ensureLoaded();
    const requestId = requiredString(params, "requestId", respond);
    const alternativeCapabilityId = requiredString(params, "alternativeCapabilityId", respond);
    if (!requestId || !alternativeCapabilityId) {
      return;
    }

    const request = stubAgentInstallRequests.get(requestId);
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `install request not found: ${requestId}`),
      );
      return;
    }

    const now = Date.now();
    request.targetReviewStatus = "alternative-suggested";
    request.alternativeSuggestion = {
      capabilityId: alternativeCapabilityId,
      capabilityName:
        typeof params.alternativeCapabilityName === "string"
          ? params.alternativeCapabilityName
          : alternativeCapabilityId,
      reason: typeof params.reason === "string" ? params.reason : "目标机器人建议替代能力",
    };
    request.updatedAt = now;
    persist();

    respond(
      true,
      {
        requestId,
        status: request.status,
        targetReviewStatus: request.targetReviewStatus,
        alternativeSuggestion: request.alternativeSuggestion,
        message: "目标机器人已建议替代能力",
      },
      undefined,
    );
  },
};
