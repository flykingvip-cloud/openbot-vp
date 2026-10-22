import { i18n } from "../../../../i18n/index.ts";

type Copy = {
  breadcrumb: string;
  title: string;
  subtitle: string;
  add: string;
  createTitle: string;
  editTitle: string;
  footnote: string;
  loading: string;
  unauthorized: string;
  loadFailed: string;
  retry: string;
  empty: string;
  emptyFilter: string;
  filtersLabel: string;
  filters: { all: string; enabled: string; abnormal: string };
  columns: {
    name: string;
    id: string;
    environment: string;
    enabled: string;
    health: string;
    maturity: string;
    lastProbe: string;
    actions: string;
  };
  enabled: string;
  disabled: string;
  lastProbe: string;
  test: string;
  edit: string;
  cancel: string;
  save: string;
  disable: string;
  sectionBasic: string;
  sectionIntegration: string;
  sectionSecurity: string;
  advancedAllowlist: string;
  fields: {
    displayName: string;
    platformId: string;
    environment: string;
    registrationNotes: string;
    serviceBaseUrl: string;
    contractVersion: string;
    clientIdentity: string;
    serviceClientId: string;
    credentialRef: string;
    callbackAllowlist: string;
    serviceSecret: string;
    rotateSecret: string;
  };
  placeholders: {
    displayName: string;
    platformId: string;
    registrationNotes: string;
    serviceBaseUrl: string;
    callbackAllowlist: string;
    secretNew: string;
    secretRotate: string;
    secretSaved: string;
  };
  validation: {
    displayName: string;
    platformId: string;
    serviceBaseUrl: string;
    secret: string;
  };
  saved: string;
  disabledNotice: string;
  probeOk: string;
  probePartial: string;
  probeFailed: string;
  probeError: string;
  probeNever: string;
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
  requestFailed: string;
  saveFailed: string;
};

const en: Copy = {
  breadcrumb: "System Settings · Device Platform Connection",
  title: "Device Platform Connection",
  subtitle: "Manage connector partner connection and reachability, not individual devices.",
  add: "Add connection",
  createTitle: "Add connection",
  editTitle: "Edit connection · {name}",
  footnote: "Device list and authorization live in enterprise 「Connected Devices」.",
  loading: "Loading device platform connections…",
  unauthorized:
    "Only platform administrators can configure device platform connections. Enterprise admins and members do not have this entry.",
  loadFailed: "Failed to load device platform connections.",
  retry: "Retry",
  empty: "No device platform connections yet. Use Add connection to create one.",
  emptyFilter: "No connections match this filter.",
  filtersLabel: "Connection filters",
  filters: { all: "All", enabled: "Enabled", abnormal: "Abnormal" },
  columns: {
    name: "Name",
    id: "ID",
    environment: "Environment",
    enabled: "Enabled",
    health: "Health",
    maturity: "Maturity",
    lastProbe: "Last probe",
    actions: "Actions",
  },
  enabled: "Enabled",
  disabled: "Disabled",
  lastProbe: "Last probe",
  test: "Test connection",
  edit: "Edit",
  cancel: "Cancel",
  save: "Save",
  disable: "Disable connection",
  sectionBasic: "Basic information",
  sectionIntegration: "Integration parameters",
  sectionSecurity: "Security",
  advancedAllowlist: "Advanced · Callback allowlist",
  fields: {
    displayName: "Platform name",
    platformId: "Stable ID",
    environment: "Environment",
    registrationNotes: "Capability notes",
    serviceBaseUrl: "Control API origin",
    contractVersion: "Contract version",
    clientIdentity: "Client identity",
    serviceClientId: "Service client ID",
    credentialRef: "Credential reference",
    callbackAllowlist: "Callback allowlist",
    serviceSecret: "Service secret",
    rotateSecret: "Rotate secret",
  },
  placeholders: {
    displayName: "e.g. Local joint mock",
    platformId: "e.g. plat-local",
    registrationNotes: "Optional capability registration notes. Do not paste secrets.",
    serviceBaseUrl: "http://127.0.0.1:8791",
    callbackAllowlist: "One https callback URL per line",
    secretNew: "Write once. It will not be shown again.",
    secretRotate: "Enter the new secret to rotate.",
    secretSaved: "Saved. Leave blank to keep unchanged.",
  },
  validation: {
    displayName: "Platform name is required.",
    platformId: "Stable ID is required.",
    serviceBaseUrl: "Control API origin is required.",
    secret: "Service secret is required.",
  },
  saved: "Saved. The secret is never echoed back.",
  disabledNotice:
    "Connection disabled. New grants and executions are rejected; existing device relations stay until users revoke them.",
  probeOk: "Connection is healthy.",
  probePartial:
    "Health passed, but capabilities or contract are incompatible. The connection was not marked healthy.",
  probeFailed: "Probe failed. The connection was not marked healthy.",
  probeError: "Probe failed.",
  probeNever: "Never",
  justNow: "Just now",
  minutesAgo: "{count}m ago",
  hoursAgo: "{count}h ago",
  daysAgo: "{count}d ago",
  requestFailed: "Device platform request failed",
  saveFailed: "Save failed",
};

const zhCN: Copy = {
  breadcrumb: "系统设置 · 设备平台连接",
  title: "设备平台连接",
  subtitle: "管理接入伙伴的连接与可达性，不管理单台设备",
  add: "添加连接",
  createTitle: "添加连接",
  editTitle: "编辑连接 · {name}",
  footnote: "设备列表与授权在企业侧「已连接设备」",
  loading: "正在读取设备平台连接",
  unauthorized: "仅平台管理员可以配置设备平台连接。企业管理员和普通用户没有这个入口。",
  loadFailed: "读取设备平台连接失败。",
  retry: "重试",
  empty: "还没有设备平台连接。点击「添加连接」开始配置。",
  emptyFilter: "当前筛选下没有连接。",
  filtersLabel: "连接筛选",
  filters: { all: "全部", enabled: "已启用", abnormal: "异常" },
  columns: {
    name: "名称",
    id: "ID",
    environment: "环境",
    enabled: "已启用",
    health: "健康度",
    maturity: "成熟度",
    lastProbe: "最近探针",
    actions: "操作",
  },
  enabled: "已启用",
  disabled: "已停用",
  lastProbe: "上次探测",
  test: "测试连接",
  edit: "编辑",
  cancel: "取消",
  save: "保存",
  disable: "禁用连接",
  sectionBasic: "基本信息",
  sectionIntegration: "对接参数",
  sectionSecurity: "安全",
  advancedAllowlist: "高级 · 回调允许列表",
  fields: {
    displayName: "平台名称",
    platformId: "稳定 ID",
    environment: "环境",
    registrationNotes: "能力说明",
    serviceBaseUrl: "控制 API 源",
    contractVersion: "契约版本",
    clientIdentity: "客户端身份",
    serviceClientId: "服务客户端 ID",
    credentialRef: "凭证引用",
    callbackAllowlist: "回调允许列表",
    serviceSecret: "服务密钥",
    rotateSecret: "轮换密钥",
  },
  placeholders: {
    displayName: "例如 本地 joint mock",
    platformId: "例如 plat-local",
    registrationNotes: "选填。能力登记说明，不要填写密钥。",
    serviceBaseUrl: "http://127.0.0.1:8791",
    callbackAllowlist: "每行一个 https 回调地址",
    secretNew: "只写入一次，保存后不再显示",
    secretRotate: "填写新密钥以完成轮换。",
    secretSaved: "已保存。留空不改。",
  },
  validation: {
    displayName: "请填写平台名称。",
    platformId: "请填写稳定 ID。",
    serviceBaseUrl: "请填写控制 API 源。",
    secret: "请填写服务密钥。",
  },
  saved: "已保存。密钥不会回显。",
  disabledNotice: "已禁用连接。新的授权和执行会被拒绝；已有设备关系会保留到用户自己解除。",
  probeOk: "连接可用。",
  probePartial: "健康检查已通过，但能力或契约不兼容。连接没有标记为健康。",
  probeFailed: "测试未通过。连接没有标记为健康。",
  probeError: "测试失败",
  probeNever: "从未",
  justNow: "刚刚",
  minutesAgo: "{count} 分钟前",
  hoursAgo: "{count} 小时前",
  daysAgo: "{count} 天前",
  requestFailed: "设备平台请求失败",
  saveFailed: "保存失败",
};

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}

/** zh-CN + en copy for device-platform admin (keeps strings on this landing stream). */
export function devicePlatformCopy(): Copy {
  return i18n.getLocale() === "en" ? en : zhCN;
}

export function dp(pick: (copy: Copy) => string, params?: Record<string, string | number>): string {
  return fill(pick(devicePlatformCopy()), params);
}
