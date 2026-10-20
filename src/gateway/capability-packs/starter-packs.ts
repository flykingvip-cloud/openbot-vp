/**
 * Official capability packs for platform → tenant inheritance.
 *
 * Packs reference skillKey values that match bundled `skills/<key>/` directories
 * (or synthetic registry keys only when a real skill exists on disk).
 *
 * Employee-open policy (A/B/C):
 * - A starter: auto-entitle all plans; direct_employee_visible (全员直接可用)
 * - B cn-office: auto-entitle tenants; enterprise_review_required (岗位审核后开放)
 * - C channels / local-dev / platform-ops: not auto-entitled; enterprise_only (不对全员开放)
 *
 * - starter (S0): A — universal employee-direct
 * - cn-office (S1): B — role/market skills after enterprise review
 * - channels (S2): C — opt-in integrations
 * - local-dev (S3): C — host/Mac/IDE utilities
 * - platform-ops (S4): C — platform-internal only
 */

export type CapabilityPackId = "starter" | "cn-office" | "channels" | "local-dev" | "platform-ops";

export type PackEmployeeVisibility =
  | "direct_employee_visible"
  | "enterprise_review_required"
  | "enterprise_only";

export type PackSkillDef = {
  skillKey: string;
  /** Display name override (zh/en). Falls back to skillKey. */
  name?: string;
  description?: string;
  categoryId?: string;
  riskLevel?: "low" | "medium" | "high";
  network?: boolean;
  filesystem?: boolean;
  subprocess?: boolean;
  secrets?: boolean;
  /** Capability verbs this pack skill fulfills (e.g. text.summarize). */
  capabilities?: string[];
};

export type PackRecipeDef = {
  id: string;
  titleZh: string;
  capabilities: string[];
};

export type CapabilityPackDef = {
  id: CapabilityPackId;
  title: string;
  titleZh: string;
  summary: string;
  /** Auto-grant on enterprise create for these plans (empty = never auto). */
  autoEntitlePlans: Array<"trial" | "business" | "custom" | "*">;
  defaultEnabled: boolean;
  employeeVisibilityMode: PackEmployeeVisibility;
  skills: PackSkillDef[];
  /** Scene recipes: install by capability set rather than the whole pack. */
  recipes?: PackRecipeDef[];
};

/** S0 / A — universal starter: every tenant + every employee (direct). */
export const PACK_STARTER: CapabilityPackDef = {
  id: "starter",
  title: "Starter Productivity",
  titleZh: "办公起步包",
  summary: "Low-risk skills every employee robot can use out of the box (direct_employee_visible).",
  autoEntitlePlans: ["*"],
  defaultEnabled: true,
  employeeVisibilityMode: "direct_employee_visible",
  skills: [
    {
      skillKey: "summarize",
      name: "内容摘要",
      description: "Summarize or extract text from URLs, podcasts, and local files.",
      categoryId: "productivity",
      capabilities: ["text.summarize"],
    },
    {
      skillKey: "meeting-notes-specialist",
      name: "会议纪要专家",
      description: "会议纪要、决策追踪与行动项管理。",
      categoryId: "productivity",
      capabilities: ["meeting.notes", "text.summarize"],
    },
    {
      skillKey: "nano-pdf",
      name: "PDF 助手",
      description: "Edit PDFs with natural-language instructions.",
      categoryId: "productivity",
      filesystem: true,
      capabilities: ["document.pdf"],
    },
    {
      skillKey: "cyber-ppt",
      name: "PPT 助手",
      description: "演示文稿大纲与生成辅助（咨询风格 PPTX）。",
      categoryId: "productivity",
      filesystem: true,
      capabilities: ["document.ppt"],
    },
    {
      skillKey: "weather",
      name: "天气查询",
      description: "Current weather and forecasts.",
      categoryId: "utility",
      network: true,
      capabilities: ["weather.query"],
    },
    {
      skillKey: "defuddle",
      name: "网页正文提取",
      description: "Extract clean markdown from web pages (less clutter than raw fetch).",
      categoryId: "productivity",
      network: true,
      subprocess: true,
      capabilities: ["web.extract"],
    },
    {
      skillKey: "canvas",
      name: "可视化画布",
      description:
        "HTML dashboards, charts, and diagrams via canvas.present or workspace HTML deliverables.",
      categoryId: "productivity",
      filesystem: true,
      capabilities: ["visual.canvas"],
    },
    {
      skillKey: "json-canvas",
      name: "JSON 画布",
      description: "Mind maps and node-edge canvases (JSON Canvas / Obsidian .canvas).",
      categoryId: "productivity",
      filesystem: true,
      capabilities: ["visual.canvas"],
    },
    {
      skillKey: "agent-reach",
      name: "多平台联网访问",
      description:
        "Read and search web, GitHub, X, YouTube and related platforms using OpenBot tools first.",
      categoryId: "search",
      network: true,
      capabilities: ["web.search"],
    },
    {
      skillKey: "user-guidance-protocol",
      name: "用户引导协议",
      description: "Context-aware UI companionship when the agent cannot drive the UI directly.",
      categoryId: "platform",
      capabilities: ["guidance.user"],
    },
    {
      skillKey: "configure-external-api-source",
      name: "外部 API 知识源",
      description: "Bind and verify external HTTP APIs as OpenBot knowledge sources.",
      categoryId: "platform",
      network: true,
      secrets: true,
      capabilities: ["integration.api"],
    },
    {
      skillKey: "openbot-platform-ops",
      name: "OpenBot 平台运维",
      description:
        "Guide agents through OpenBot platform features: assistants, spaces, knowledge, API, cron, identity.",
      categoryId: "platform",
      capabilities: ["platform.ops"],
    },
    {
      skillKey: "openbot-docs",
      name: "OpenBot 自助文档",
      description:
        "Read official OpenBot workbench and product docs before telling a user which button to press.",
      categoryId: "platform",
      capabilities: ["docs.workbench"],
    },
    {
      skillKey: "openai-whisper-api",
      name: "语音转写 (API)",
      description: "Transcribe audio via OpenAI Whisper API (cloud-friendly).",
      categoryId: "productivity",
      network: true,
      secrets: true,
      capabilities: ["speech.transcribe"],
    },
    {
      skillKey: "wechat-article",
      name: "微信公众号成稿",
      description: "Draft, package, and prepare WeChat Official Account articles.",
      categoryId: "marketing",
      network: true,
      filesystem: true,
      capabilities: ["content.wechat"],
    },
    {
      skillKey: "wechat-official-credential",
      name: "微信公众号凭证",
      description:
        "Configure Official Account AppID, AppSecret, and IP whitelist via isolated browser scans.",
      categoryId: "marketing",
      network: true,
      secrets: true,
      subprocess: true,
      capabilities: ["identity.wechat-official"],
    },
    {
      skillKey: "finance-research",
      name: "金融研究",
      description: "Quotes, deep research reports, and PDF financial table analysis.",
      categoryId: "finance",
      network: true,
      filesystem: true,
      capabilities: ["research.finance"],
    },
    {
      skillKey: "web-research",
      name: "网页调研",
      description:
        "Plan searches, fetch sources, extract evidence, and write a citable web research report.",
      categoryId: "search",
      network: true,
      filesystem: true,
      capabilities: ["web.search", "research.web"],
    },
    {
      skillKey: "browser-scan-proxy",
      name: "浏览器扫码代理",
      description:
        "User scans QR / confirms 2FA; the agent finishes the console task in an isolated browser.",
      categoryId: "browser",
      network: true,
      subprocess: true,
      capabilities: ["browser.scan-proxy"],
    },
  ],
  recipes: [
    {
      id: "meeting-followup",
      titleZh: "会议跟进",
      capabilities: ["meeting.notes", "text.summarize"],
    },
    {
      id: "web-research",
      titleZh: "网页调研",
      capabilities: ["web.search", "research.web"],
    },
    {
      id: "console-scan-proxy",
      titleZh: "扫码代操作",
      capabilities: ["browser.scan-proxy"],
    },
    {
      id: "wechat-oa-credential",
      titleZh: "公众号凭证配置",
      capabilities: ["identity.wechat-official", "browser.scan-proxy"],
    },
    {
      id: "document-pack",
      titleZh: "文档整理",
      capabilities: ["document.pdf", "document.ppt", "text.summarize"],
    },
    {
      id: "voice-notes",
      titleZh: "语音记录",
      capabilities: ["speech.transcribe", "text.summarize"],
    },
  ],
};

/** S1 / B — CN office roles & markets: tenant-entitled, employee after enterprise review. */
export const PACK_CN_OFFICE: CapabilityPackDef = {
  id: "cn-office",
  title: "China Enterprise Office",
  titleZh: "中国企业办公包",
  summary:
    "Role and market skills for CN workbenches — install per position after enterprise review (not all-employee default).",
  autoEntitlePlans: ["trial", "business", "*"],
  defaultEnabled: true,
  employeeVisibilityMode: "enterprise_review_required",
  skills: [
    { skillKey: "feishu-integration", name: "飞书集成", categoryId: "collaboration" },
    { skillKey: "product-manager", name: "产品经理", categoryId: "role" },
    { skillKey: "project-shepherd", name: "项目管理", categoryId: "role" },
    { skillKey: "operations-manager", name: "运营管理", categoryId: "role" },
    { skillKey: "customer-service", name: "客户服务", categoryId: "role" },
    { skillKey: "hr-onboarding", name: "HR 入职", categoryId: "role" },
    { skillKey: "recruitment-specialist", name: "招聘专家", categoryId: "role" },
    { skillKey: "sales-coach", name: "销售教练", categoryId: "role" },
    { skillKey: "sales-engineer", name: "售前工程师", categoryId: "role" },
    { skillKey: "corporate-training-designer", name: "企业培训设计", categoryId: "role" },
    { skillKey: "supply-chain-strategist", name: "供应链策略", categoryId: "role" },
    { skillKey: "wechat-official-account", name: "微信公众号运营", categoryId: "marketing" },
    { skillKey: "wechat-mini-program-dev", name: "微信小程序开发", categoryId: "marketing" },
    { skillKey: "xiaohongshu-marketing", name: "小红书营销", categoryId: "marketing" },
    { skillKey: "douyin-marketing", name: "抖音营销", categoryId: "marketing" },
    { skillKey: "bilibili-content-strategy", name: "B站内容策略", categoryId: "marketing" },
    { skillKey: "kuaishou-marketing", name: "快手营销", categoryId: "marketing" },
    { skillKey: "weibo-marketing", name: "微博运营", categoryId: "marketing" },
    { skillKey: "zhihu-marketing", name: "知乎营销", categoryId: "marketing" },
    { skillKey: "baidu-seo", name: "百度 SEO", categoryId: "marketing" },
    { skillKey: "tiktok-marketing", name: "TikTok 营销", categoryId: "marketing" },
    { skillKey: "china-ecommerce-operator", name: "中国电商运营", categoryId: "marketing" },
    { skillKey: "china-market-localization", name: "中国市场本地化", categoryId: "marketing" },
    { skillKey: "festival-knowledge", name: "中国节庆知识", categoryId: "knowledge" },
    { skillKey: "studio-producer", name: "创意制作管理", categoryId: "role" },
    {
      skillKey: "coding-agent",
      name: "编程助手",
      description: "Delegate coding tasks to coding agents (dev positions after review).",
      categoryId: "dev",
      subprocess: true,
    },
  ],
};

/** S2 / C — channel integrations: catalog only; not all-employee default. */
export const PACK_CHANNELS: CapabilityPackDef = {
  id: "channels",
  title: "Channels & Integrations",
  titleZh: "渠道与集成包",
  summary: "External channel and SaaS connectors; enable per tenant as needed (enterprise_only).",
  autoEntitlePlans: [],
  defaultEnabled: false,
  employeeVisibilityMode: "enterprise_only",
  skills: [
    { skillKey: "slack", name: "Slack", categoryId: "channel" },
    { skillKey: "discord", name: "Discord", categoryId: "channel" },
    { skillKey: "notion", name: "Notion", categoryId: "channel" },
    { skillKey: "trello", name: "Trello", categoryId: "channel" },
    { skillKey: "github", name: "GitHub", categoryId: "channel" },
    { skillKey: "gh-issues", name: "GitHub Issues", categoryId: "channel" },
    { skillKey: "himalaya", name: "邮件 (Himalaya)", categoryId: "channel" },
    { skillKey: "voice-call", name: "语音通话", categoryId: "channel" },
    { skillKey: "gog", name: "Google Workspace", categoryId: "channel" },
    {
      skillKey: "xurl",
      name: "X/Twitter CLI",
      categoryId: "channel",
      network: true,
      secrets: true,
    },
  ],
};

/** S3 / C — Mac / local / IDE only; never auto-entitle on multi-tenant SaaS. */
export const PACK_LOCAL_DEV: CapabilityPackDef = {
  id: "local-dev",
  title: "Local / Mac Toolkit",
  titleZh: "本机与开发工具包",
  summary: "Host-local CLIs, Mac utilities, and IDE-only skills — not SaaS employee defaults.",
  autoEntitlePlans: [],
  defaultEnabled: false,
  employeeVisibilityMode: "enterprise_only",
  skills: [
    { skillKey: "apple-notes" },
    { skillKey: "apple-reminders" },
    { skillKey: "imsg" },
    { skillKey: "peekaboo" },
    { skillKey: "things-mac" },
    { skillKey: "bear-notes" },
    { skillKey: "obsidian" },
    { skillKey: "obsidian-cli" },
    { skillKey: "obsidian-markdown" },
    { skillKey: "obsidian-bases" },
    { skillKey: "sonoscli" },
    { skillKey: "openhue" },
    { skillKey: "spotify-player" },
    { skillKey: "camsnap" },
    { skillKey: "blucli" },
    { skillKey: "bluebubbles" },
    { skillKey: "tmux" },
    { skillKey: "session-logs" },
    { skillKey: "healthcheck" },
    { skillKey: "skill-creator" },
    {
      skillKey: "cursor-canvas",
      name: "Cursor IDE Canvas",
      description: "Cursor .canvas.tsx only — not Employee Web.",
      categoryId: "ide",
    },
    {
      skillKey: "openai-whisper",
      name: "语音转写 (本地)",
      description: "Local Whisper CLI — requires host binary; not SaaS default.",
      categoryId: "productivity",
      subprocess: true,
      capabilities: ["speech.transcribe"],
    },
  ],
};

/** S4 / C — platform ops only; never customer employee default. */
export const PACK_PLATFORM_OPS: CapabilityPackDef = {
  id: "platform-ops",
  title: "Platform Operations",
  titleZh: "平台运营包",
  summary: "Internal OpenBot operations skills; not granted to customer tenants.",
  autoEntitlePlans: [],
  defaultEnabled: false,
  employeeVisibilityMode: "enterprise_only",
  skills: [
    {
      skillKey: "trial-sales-conversion",
      name: "试用销售转化",
      description: "Enterprise trial lead follow-up and conversion for platform sales agents.",
      categoryId: "platform-ops",
    },
  ],
};

export const ALL_CAPABILITY_PACKS: CapabilityPackDef[] = [
  PACK_STARTER,
  PACK_CN_OFFICE,
  PACK_CHANNELS,
  PACK_LOCAL_DEV,
  PACK_PLATFORM_OPS,
];

export function getPackById(id: string): CapabilityPackDef | undefined {
  return ALL_CAPABILITY_PACKS.find((pack) => pack.id === id);
}

/** Packs auto-granted for a commercial plan string. */
export function resolveAutoEntitlePackIds(plan: string | null | undefined): CapabilityPackId[] {
  const normalized = (plan ?? "trial").trim().toLowerCase() || "trial";
  const planKey =
    normalized === "business" || normalized === "pro" || normalized === "team"
      ? "business"
      : normalized === "custom" || normalized === "enterprise"
        ? "custom"
        : normalized === "trial" || normalized === "trialing"
          ? "trial"
          : "trial";

  const ids: CapabilityPackId[] = [];
  for (const pack of ALL_CAPABILITY_PACKS) {
    if (pack.autoEntitlePlans.includes("*") || pack.autoEntitlePlans.includes(planKey)) {
      ids.push(pack.id);
    }
  }
  // Deduplicate while preserving order
  return [...new Set(ids)];
}

/** Default packs for brand-new tenants (trial-friendly). */
export const DEFAULT_NEW_TENANT_PACK_IDS: CapabilityPackId[] = resolveAutoEntitlePackIds("trial");

/**
 * Normalize free-form pack id list from plan entitlement / RPC params.
 * Unknown ids are dropped; order preserved; duplicates removed.
 */
export function normalizeCapabilityPackIds(raw: unknown): CapabilityPackId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CapabilityPackId[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const pack = getPackById(entry.trim());
    if (pack && !out.includes(pack.id)) {
      out.push(pack.id);
    }
  }
  return out;
}

export function skillKeysForPackIds(packIds: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const id of packIds) {
    const pack = getPackById(id);
    if (!pack) {
      continue;
    }
    for (const skill of pack.skills) {
      keys.add(skill.skillKey);
    }
  }
  return keys;
}

export function resolvePackInstallSkillKeys(params: {
  packId: string;
  capability?: string | null;
  recipeId?: string | null;
}): string[] {
  const pack = getPackById(params.packId);
  if (!pack) {
    return [];
  }
  const recipeId = params.recipeId?.trim();
  if (recipeId) {
    const recipe = pack.recipes?.find((entry) => entry.id === recipeId);
    if (!recipe) {
      return [];
    }
    const keys = new Set<string>();
    for (const capability of recipe.capabilities) {
      for (const skill of pack.skills) {
        if (skill.capabilities?.includes(capability)) {
          keys.add(skill.skillKey);
        }
      }
    }
    return [...keys];
  }
  const capability = params.capability?.trim();
  if (capability) {
    return pack.skills
      .filter((skill) => skill.capabilities?.includes(capability))
      .map((skill) => skill.skillKey);
  }
  return pack.skills.map((skill) => skill.skillKey);
}

export function findPackIdsForSkillKey(skillKey: string): CapabilityPackId[] {
  const key = skillKey.trim();
  return ALL_CAPABILITY_PACKS.filter((pack) =>
    pack.skills.some((skill) => skill.skillKey === key),
  ).map((pack) => pack.id);
}

export function buildOfficialManifestId(skillKey: string, version = "1.0.0"): string {
  return `urn:openbot:skill:${skillKey}@${version}`;
}

/** Also match legacy openclaw URNs from earlier local seeds. */
export function legacyManifestId(skillKey: string, version = "0.0.0"): string {
  return `urn:openclaw:skill:${skillKey}@${version}`;
}

export function buildPackManifest(params: {
  skill: PackSkillDef;
  pack: CapabilityPackDef;
  version?: string;
}): {
  id: string;
  kind: string;
  version: string;
  skillKey: string;
  name: string;
  description: string;
  categoryId?: string;
  packId: CapabilityPackId;
  source: { kind: string; origin: string; trustTier: string };
  risk: {
    level: string;
    network: boolean;
    filesystem: boolean;
    subprocess: boolean;
    secrets: boolean;
  };
} {
  const version = params.version ?? "1.0.0";
  const skill = params.skill;
  return {
    id: buildOfficialManifestId(skill.skillKey, version),
    kind: "skill",
    version,
    skillKey: skill.skillKey,
    name: skill.name?.trim() || skill.skillKey,
    description: skill.description?.trim() || `${skill.skillKey} (official pack ${params.pack.id})`,
    ...(skill.categoryId ? { categoryId: skill.categoryId } : {}),
    packId: params.pack.id,
    source: {
      kind: "builtin",
      origin: `openbot/pack/${params.pack.id}/${skill.skillKey}`,
      trustTier: "first-party",
    },
    risk: {
      level: skill.riskLevel ?? "low",
      network: skill.network === true,
      filesystem: skill.filesystem === true,
      subprocess: skill.subprocess === true,
      secrets: skill.secrets === true,
    },
  };
}
