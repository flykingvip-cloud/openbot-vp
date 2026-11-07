/**
 * Slice 3 controlled read and draft for the Feishu employee proxy.
 *
 * Every read calls the slice 2 decision first. An allow means the action is on
 * a valid delegation. It does not clear a specific document, and it does not
 * send. Empty resource scope is not allow-all. Group-history APIs are not
 * called. A capabilityStatus of "granted" is not a Measured user-token read.
 * When the checklist row is not explicitly measured, this function does not
 * call Feishu. Slice 4 owns content confirmation and send.
 */
import type { EnterpriseImMeasuredChecklist } from "./enterprise-im-employee-authorization.js";
import {
  decideEnterpriseImEmployeeProxy,
  type EnterpriseImDecisionInput,
} from "./enterprise-im-employee-decision.js";
import { recordUserOperationalIdentityUsageEvent } from "./user-operational-identity-store.js";
import type { EnterpriseImResourceScope } from "./user-operational-identity-types.js";

const RESOURCE_ID = /\b(?:docx|oc|wiki)_[A-Za-z0-9_-]+\b/g;

export type EnterpriseImReadResourceKind = "doc" | "group";

export type EnterpriseImDraftSource = {
  resourceId: string;
  updatedAt: string;
  status: "read" | "unreadable";
};

export type EnterpriseImDraft = {
  text: string;
  sources: EnterpriseImDraftSource[];
};

export type EnterpriseImUserDoc = {
  resourceId: string;
  title: string;
  updatedAt: string;
  body: string;
  links: string[];
};

export type EnterpriseImUserDocReadResult =
  | { ok: true; doc: EnterpriseImUserDoc }
  | { ok: false; invalidUserToken: true };

/** User-token document read. This slice does not pass an app token here. */
export type EnterpriseImUserDocReader = (params: {
  resourceId: string;
  accessToken: string;
}) => EnterpriseImUserDocReadResult | Promise<EnterpriseImUserDocReadResult>;

export type EnterpriseImReadResult =
  | {
      outcome: "draft";
      code: "ENTERPRISE_IM_DRAFT_READY";
      message: string;
      grantId: string;
      grantVersion: number;
      identityId: string;
      draft: EnterpriseImDraft;
      auditEventId: string;
    }
  | {
      outcome: "deny";
      code: string;
      message: string;
      grantId?: string;
      auditEventId: string;
    };

function idsInText(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return [...new Set(value.match(RESOURCE_ID) ?? [])];
}

function allowlist(
  scope: EnterpriseImResourceScope | undefined,
  kind: EnterpriseImReadResourceKind,
): string[] {
  if (!scope) {
    return [];
  }
  const rows = kind === "doc" ? scope.docs : scope.groups;
  return [...new Set(rows.map((id) => id.trim()).filter(Boolean))];
}

function kindForId(resourceId: string): EnterpriseImReadResourceKind {
  return resourceId.startsWith("oc_") ? "group" : "doc";
}

function audit(params: {
  input: EnterpriseImDecisionInput;
  action: "read" | "draft";
  identityId: string;
  result: "allowed" | "denied";
  code?: string;
  grantVersion?: number;
  resourceIds: string[];
  primaryResourceId?: string;
}): string {
  const event = recordUserOperationalIdentityUsageEvent({
    store: params.input.store,
    ownerId: params.input.ownerId,
    tenantId: params.input.tenantId ?? undefined,
    identityId: params.identityId,
    provider: "feishu-personal",
    agentId: params.input.agentId,
    action: params.action,
    result: params.result,
    denialCode: params.code,
    nowIso: params.input.nowIso,
    summary: {
      headline: params.result === "allowed" ? "飞书受控读取" : "飞书受控读取被拒绝",
      excerpt: `grantVersion=${params.grantVersion ?? ""}; connection=${params.input.gate.accountId}`,
      externalId: params.primaryResourceId,
      tags: params.resourceIds,
    },
  });
  return event.eventId;
}

function deny(params: {
  input: EnterpriseImDecisionInput;
  action: "read" | "draft";
  code: string;
  message: string;
  identityId: string;
  grantId?: string;
  grantVersion?: number;
  resourceIds: string[];
  primaryResourceId?: string;
}): EnterpriseImReadResult {
  return {
    outcome: "deny",
    code: params.code,
    message: params.message,
    grantId: params.grantId,
    auditEventId: audit({
      input: params.input,
      action: params.action,
      identityId: params.identityId,
      result: "denied",
      code: params.code,
      grantVersion: params.grantVersion,
      resourceIds: params.resourceIds,
      primaryResourceId: params.primaryResourceId,
    }),
  };
}

function assembleDraft(doc: EnterpriseImUserDoc, unreadable: string[]): EnterpriseImDraft {
  const lines = [
    `已读取 ${doc.title}（${doc.resourceId}），更新时间 ${doc.updatedAt}。`,
    ...unreadable.map((id) => `无法读取 ${id}：不在该机器人的资源范围。`),
  ];
  return {
    text: lines.join("\n"),
    sources: [
      { resourceId: doc.resourceId, updatedAt: doc.updatedAt, status: "read" },
      ...unreadable.map((resourceId) => ({
        resourceId,
        updatedAt: "",
        status: "unreadable" as const,
      })),
    ],
  };
}

/**
 * Read or draft one delegated resource. Does not send and does not insert a grant.
 * `appTokenRead` is accepted only so tests can prove it is never called.
 */
export async function readEnterpriseImEmployeeResource(params: {
  decision: EnterpriseImDecisionInput;
  action: "read" | "draft";
  resourceKind?: EnterpriseImReadResourceKind;
  resourceId?: string;
  messageText?: string;
  measured: EnterpriseImMeasuredChecklist;
  readDoc?: EnterpriseImUserDocReader;
  appTokenRead?: EnterpriseImUserDocReader;
}): Promise<EnterpriseImReadResult> {
  const grantCount = Object.keys(params.decision.store.grants).length;
  const appTokenFallback = params.appTokenRead;
  const mentioned = idsInText(params.messageText);
  const requested = params.resourceId?.trim() || "";
  const identityFallback =
    Object.values(params.decision.store.identities).find(
      (identity) =>
        identity.ownerId === params.decision.ownerId && identity.provider === "feishu-personal",
    )?.identityId ?? "unresolved";
  const decision = decideEnterpriseImEmployeeProxy({
    ...params.decision,
    action: params.action,
  });
  if (decision.outcome === "deny") {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: decision.code,
      message: decision.message,
      identityId: identityFallback,
      resourceIds: [requested, ...mentioned].filter(Boolean),
      primaryResourceId: requested || undefined,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  const grant = params.decision.store.grants[decision.grantId];
  if (!grant || grant.grantId !== decision.grantId) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "DELEGATION_MISSING",
      message: "没有员工确认的机器人授权。",
      identityId: decision.identityId,
      resourceIds: [requested, ...mentioned].filter(Boolean),
      primaryResourceId: requested || undefined,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  const kind = params.resourceKind;
  if (!kind || !requested) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "RESOURCE_REQUIRED",
      message: "需要指定资源类型和资源编号。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: mentioned,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  const list = allowlist(grant.resourceScope, kind);
  // Message text is not an allowlist. Mentioned ids stay out of the grant.
  if (list.length === 0) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "RESOURCE_SCOPE_EMPTY",
      message: "资源范围为空，不能当作全部允许。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested, ...mentioned],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  if (!list.includes(requested)) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "RESOURCE_OUT_OF_SCOPE",
      message: "该资源不在这个机器人的授权范围。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested, ...mentioned],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  if (kind === "group") {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "GROUP_HISTORY_NOT_IN_SLICE",
      message: "本切片不读取群历史。机器人可见的群消息不能代替已验证的用户身份读取。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested, ...mentioned],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  if (!params.measured.projectDocs) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "ENTERPRISE_IM_NOT_MEASURED",
      message: "文档读取尚未在目标企业完成验证，不能调用飞书。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested, ...mentioned],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  if (!params.readDoc) {
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "ENTERPRISE_IM_READER_NOT_WIRED",
      message: "已验证的用户身份文档读取尚未接通。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  const accessToken =
    params.decision.secretStore?.secrets[
      params.decision.store.identities[decision.identityId]?.credentialHandleId ?? ""
    ]?.accessToken ?? "";
  const loaded = await params.readDoc({ resourceId: requested, accessToken });
  if (!loaded.ok) {
    if (appTokenFallback) {
      // An invalid user token stops here. Do not call the app-token reader.
    }
    const result = deny({
      input: params.decision,
      action: params.action,
      code: "USER_TOKEN_INVALID_NO_APP_FALLBACK",
      message: "用户令牌无效。不会改用应用令牌。",
      identityId: decision.identityId,
      grantId: grant.grantId,
      grantVersion: grant.grantVersion,
      resourceIds: [requested],
      primaryResourceId: requested,
    });
    if (Object.keys(params.decision.store.grants).length !== grantCount) {
      throw new Error("enterprise IM read must not write a grant");
    }
    return result;
  }
  const docAllow = new Set(allowlist(grant.resourceScope, "doc"));
  const groupAllow = new Set(allowlist(grant.resourceScope, "group"));
  const discovered = [...new Set([...loaded.doc.links, ...idsInText(loaded.doc.body)])];
  const unreadable = discovered.filter((id) => {
    if (id === requested) {
      return false;
    }
    const allowed = kindForId(id) === "group" ? groupAllow : docAllow;
    return !allowed.has(id);
  });
  const draft = assembleDraft(loaded.doc, unreadable);
  const auditEventId = audit({
    input: params.decision,
    action: params.action,
    identityId: decision.identityId,
    result: "allowed",
    grantVersion: grant.grantVersion,
    resourceIds: [requested, ...unreadable],
    primaryResourceId: requested,
  });
  if (Object.keys(params.decision.store.grants).length !== grantCount) {
    throw new Error("enterprise IM read must not write a grant");
  }
  return {
    outcome: "draft",
    code: "ENTERPRISE_IM_DRAFT_READY",
    message: "已生成带来源和更新时间的草稿。未发送。",
    grantId: grant.grantId,
    grantVersion: grant.grantVersion ?? 1,
    identityId: decision.identityId,
    draft,
    auditEventId,
  };
}
