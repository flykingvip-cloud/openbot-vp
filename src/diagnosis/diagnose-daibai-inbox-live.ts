/**
 * Live Path A conversation write. System self-check reports land in the
 * designated person's Da Bai conversation via chat.inject — the same
 * workbench surface as scheduled/cron results. No mailbox, no ask/execute,
 * no chat.send.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { BUILTIN_STEWARD_AGENT_ID } from "../agents/builtin-steward/identity.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionTranscriptFile,
  resolveStorePath,
  updateSessionStore,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { findActiveOwnershipRecord } from "../gateway/ownership-store.js";
import {
  extractSpaceGroupId,
  ownerStewardInboxRecipient,
  type DiagnoseConversationOwnerResolver,
  type DiagnoseConversationSend,
  type DiagnoseConversationTarget,
} from "./diagnose-daibai-inbox.js";
import { DIAGNOSIS_WRITE_POLICY } from "./write-policy.js";

export type DiagnoseConversationInjectOptions = {
  inject?: typeof callGateway;
  ensureSession?: (sessionKey: string) => Promise<void>;
};

export async function ensureStewardConversationSession(sessionKey: string): Promise<void> {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    throw new Error("missing steward sessionKey");
  }
  const cfg = loadConfig();
  const storePath = resolveStorePath(cfg.session?.store, { agentId: BUILTIN_STEWARD_AGENT_ID });
  await updateSessionStore(storePath, (store) => {
    if (store[trimmed]?.sessionId) {
      return;
    }
    store[trimmed] = {
      sessionId: randomUUID(),
      updatedAt: Date.now(),
      systemSent: false,
    };
  });
  const store = loadSessionStore(storePath, { skipCache: true });
  const entry = store[trimmed];
  if (!entry?.sessionId) {
    throw new Error("failed to ensure steward session");
  }
  const resolved = await resolveSessionTranscriptFile({
    sessionId: entry.sessionId,
    sessionKey: trimmed,
    sessionEntry: entry,
    sessionStore: store,
    storePath,
    agentId: BUILTIN_STEWARD_AGENT_ID,
  });
  if (fs.existsSync(resolved.sessionFile)) {
    return;
  }
  await fs.promises.mkdir(path.dirname(resolved.sessionFile), { recursive: true });
  await fs.promises.writeFile(
    resolved.sessionFile,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: entry.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    })}\n`,
    { encoding: "utf-8", mode: 0o600 },
  );
}

export function createDiagnoseConversationInject(
  options?: DiagnoseConversationInjectOptions,
): DiagnoseConversationSend {
  const inject = options?.inject ?? callGateway;
  const ensure = options?.ensureSession ?? ensureStewardConversationSession;
  return async (input) => {
    if (!DIAGNOSIS_WRITE_POLICY.conversationDelivery) {
      return "unavailable";
    }
    try {
      await ensure(input.sessionKey);
      await inject({
        method: "chat.inject",
        params: {
          sessionKey: input.sessionKey,
          message: input.text,
          label: "诊断报告",
        },
        timeoutMs: 20_000,
      });
      return "accepted";
    } catch {
      return "unavailable";
    }
  };
}

export function createOwnershipConversationOwnerResolver(): DiagnoseConversationOwnerResolver {
  return ({ locator, tenantId }) => {
    if (!tenantId) {
      return [];
    }
    const targets: DiagnoseConversationTarget[] = [];
    const seen = new Set<string>();
    const pushOwner = (userId: string | null | undefined) => {
      const owner = userId?.trim();
      if (!owner) {
        return;
      }
      const target = ownerStewardInboxRecipient({ tenantId, userId: owner });
      if (seen.has(target.sessionKey)) {
        return;
      }
      seen.add(target.sessionKey);
      targets.push(target);
    };
    pushOwner(
      findActiveOwnershipRecord({
        tenantId,
        subjectKind: "agent",
        subjectId: locator.agentId,
      })?.currentManagerUserId,
    );
    const groupId = extractSpaceGroupId(locator.sessionKey);
    if (groupId) {
      pushOwner(
        findActiveOwnershipRecord({
          tenantId,
          subjectKind: "group",
          subjectId: groupId,
        })?.currentManagerUserId,
      );
    }
    return targets;
  };
}
