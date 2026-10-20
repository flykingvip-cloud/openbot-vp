import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import { tryGetOperationalIdentityProviderAdapter } from "./adapters.js";

/** 动作风险等级：供策略设计与后续审批扩展使用；v1 不强制 UI 展示。 */
export type OperationalIdentityActionRisk = "low" | "medium" | "high";

export type OperationalIdentityCapabilityRegistryEntry = {
  action: string;
  label: string;
  risk: OperationalIdentityActionRisk;
  /** 规范别名（如 email.send）；运行时仍以 action 为准。 */
  alias?: string;
};

const P0_CAPABILITY_REGISTRY: Partial<
  Record<EnterpriseOperationalIdentityProvider, OperationalIdentityCapabilityRegistryEntry[]>
> = {
  "wechat-official": [
    { action: "upload_thumb", label: "上传封面", risk: "low", alias: "thumb.upload" },
    {
      action: "upload_content_image",
      label: "上传正文图片",
      risk: "low",
      alias: "content.uploadimg",
    },
    { action: "publish_draft", label: "创建草稿", risk: "low", alias: "draft.create" },
    { action: "publish_article", label: "发布文章", risk: "high", alias: "article.publish" },
    { action: "get_publish_status", label: "查询发布状态", risk: "low", alias: "publish.status" },
    { action: "broadcast_article", label: "群发图文", risk: "high", alias: "broadcast.send" },
  ],
  "github-org": [
    { action: "create_issue", label: "创建 Issue", risk: "medium", alias: "issue.create" },
    { action: "create_comment", label: "发表评论", risk: "low", alias: "issue.comment" },
  ],
  notion: [
    { action: "create_page", label: "创建页面", risk: "low", alias: "page.create" },
    { action: "update_page", label: "更新页面", risk: "medium", alias: "page.update" },
    { action: "publish_page", label: "发布页面", risk: "medium", alias: "page.publish" },
  ],
  "tencent-meeting": [
    { action: "schedule_meeting", label: "预约会议", risk: "high", alias: "meeting.schedule" },
    { action: "cancel_meeting", label: "取消会议", risk: "high", alias: "meeting.cancel" },
    { action: "get_meeting", label: "查询会议", risk: "low", alias: "meeting.get" },
    {
      action: "get_meeting_by_code",
      label: "按会议号查询",
      risk: "low",
      alias: "meeting.get_by_code",
    },
    { action: "list_meetings", label: "列出会议", risk: "low", alias: "meeting.list" },
  ],
};

export function listOperationalIdentityCapabilityRegistry(
  provider: EnterpriseOperationalIdentityProvider,
): OperationalIdentityCapabilityRegistryEntry[] {
  const explicit = P0_CAPABILITY_REGISTRY[provider];
  if (explicit) {
    return explicit;
  }
  const adapter = tryGetOperationalIdentityProviderAdapter(provider);
  if (!adapter) {
    return [];
  }
  return adapter.actions
    .filter((entry) => entry.kind === "operational")
    .map((entry) => ({
      action: entry.action,
      label: entry.label,
      risk: "medium" as const,
    }));
}

export function resolveOperationalIdentityActionRisk(
  provider: EnterpriseOperationalIdentityProvider,
  action: string,
): OperationalIdentityActionRisk | undefined {
  const normalized = action.trim();
  if (!normalized) {
    return undefined;
  }
  const entry = listOperationalIdentityCapabilityRegistry(provider).find(
    (candidate) => candidate.action === normalized || candidate.alias === normalized,
  );
  return entry?.risk;
}

export function enrichOperationalIdentityCapabilities(params: {
  provider: EnterpriseOperationalIdentityProvider;
  granted: string[];
  missing: string[];
}): Array<{
  action: string;
  label: string;
  risk: OperationalIdentityActionRisk;
  enabled: boolean;
  alias?: string;
}> {
  const registry = listOperationalIdentityCapabilityRegistry(params.provider);
  const registryByAction = new Map(registry.map((entry) => [entry.action, entry]));
  const allActions = new Set([...params.granted, ...params.missing]);
  for (const action of params.granted) {
    allActions.add(action);
  }
  for (const action of params.missing) {
    allActions.add(action);
  }
  if (allActions.size === 0) {
    return registry.map((entry) => ({
      action: entry.action,
      label: entry.label,
      risk: entry.risk,
      enabled: false,
      ...(entry.alias ? { alias: entry.alias } : {}),
    }));
  }
  return [...allActions].map((action) => {
    const entry = registryByAction.get(action);
    return {
      action,
      label: entry?.label ?? action,
      risk: entry?.risk ?? "medium",
      enabled: params.granted.includes(action),
      ...(entry?.alias ? { alias: entry.alias } : {}),
    };
  });
}
