import type { Locale } from "../../i18n/index.ts";
import {
  getWorkbenchHelpCards,
  isWorkbenchHelpChild,
  type WorkbenchHelpCard,
  type WorkbenchHelpPageId,
} from "./public-help-workbench-document.ts";
import type { PrivacyFaqItem, PrivacySection } from "./public-privacy-document.ts";

export type HelpGuideSlug = "enterprise-im" | "wecom" | "feishu" | "dingtalk";

export type HelpGuideLink = {
  label: string;
  href: string;
  summary: string;
  slug: HelpGuideSlug;
};

export type HelpGuideDocument = {
  slug: HelpGuideSlug;
  kicker: string;
  title: string;
  subtitle: string;
  backLabel: string;
  sections: PrivacySection[];
};

export type HelpDocument = {
  kicker: string;
  title: string;
  subtitle: string;
  intro: string[];
  workbenchGuidesTitle: string;
  workbenchGuidesIntro: string;
  workbenchGuides: WorkbenchHelpCard[];
  guidesTitle: string;
  guidesIntro: string;
  guides: HelpGuideLink[];
  faqTitle: string;
  faq: PrivacyFaqItem[];
  contactTitle: string;
  contactIntro: string;
  contactEmail: string;
};

const CONTACT_EMAIL = "daniel.hhd@gmail.com";

const GUIDE_SLUGS: readonly HelpGuideSlug[] = [
  "enterprise-im",
  "wecom",
  "feishu",
  "dingtalk",
] as const;

export function isHelpGuideSlug(value: string | null | undefined): value is HelpGuideSlug {
  return Boolean(value && (GUIDE_SLUGS as readonly string[]).includes(value));
}

function stripHelpBase(pathname: string, basePath = ""): string {
  const raw = pathname.trim();
  const base = basePath.replace(/\/+$/u, "");
  return base && (raw === base || raw.startsWith(`${base}/`)) ? raw.slice(base.length) || "/" : raw;
}

export function resolveHelpGuideSlugFromPath(
  pathname: string,
  basePath = "",
): HelpGuideSlug | null {
  const match = stripHelpBase(pathname, basePath).match(/^\/help\/([^/?#]+)/u);
  const slug = match?.[1]?.trim() ?? "";
  return isHelpGuideSlug(slug) ? slug : null;
}

export type PublicHelpTarget =
  | { kind: "im"; slug: HelpGuideSlug }
  | { kind: "workbench"; page: WorkbenchHelpPageId };

/** Hub when the path is `/help` or an unknown child. IM and workbench pages otherwise. */
export function resolvePublicHelpTarget(pathname: string, basePath = ""): PublicHelpTarget | null {
  const path = stripHelpBase(pathname, basePath).split("?")[0]?.split("#")[0] ?? "";
  if (path === "/help" || path === "/help/") {
    return null;
  }
  if (!path.startsWith("/help/")) {
    return null;
  }
  const parts = path.slice("/help/".length).split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (parts[0] === "workbench") {
    if (parts.length === 1) {
      return { kind: "workbench", page: "index" };
    }
    if (parts.length === 2 && isWorkbenchHelpChild(parts[1])) {
      return { kind: "workbench", page: parts[1] };
    }
    return null;
  }
  if (parts.length === 1 && isHelpGuideSlug(parts[0])) {
    return { kind: "im", slug: parts[0] };
  }
  return null;
}

function helpGuideHref(basePath: string, slug: HelpGuideSlug): string {
  const base = basePath.replace(/\/+$/u, "");
  return `${base}/help/${slug}`;
}

function buildGuides(locale: Locale, basePath = ""): HelpGuideLink[] {
  if (locale === "zh-CN") {
    return [
      {
        slug: "enterprise-im",
        label: "企业 IM 接入总览",
        href: helpGuideHref(basePath, "enterprise-im"),
        summary: "长连接优先、模式互斥、企业控制台精简表单与统一验收流程。",
      },
      {
        slug: "wecom",
        label: "企业微信",
        href: helpGuideHref(basePath, "wecom"),
        summary: "推荐 AIBot WebSocket 长连接（Bot ID + Secret）；备选自建应用 URL 回调。",
      },
      {
        slug: "feishu",
        label: "飞书",
        href: helpGuideHref(basePath, "feishu"),
        summary: "推荐 WebSocket 长连接（App ID + App Secret）；Webhook 需 Verification Token。",
      },
      {
        slug: "dingtalk",
        label: "钉钉",
        href: helpGuideHref(basePath, "dingtalk"),
        summary: "推荐 Stream 长连接（Client ID + Client Secret）；HTTP 回调需回填 Callback URL。",
      },
    ];
  }
  return [
    {
      slug: "enterprise-im",
      label: "Enterprise IM hub",
      href: helpGuideHref(basePath, "enterprise-im"),
      summary:
        "Long-connection first, mode mutual exclusion, curated console form, and shared verification.",
    },
    {
      slug: "wecom",
      label: "WeCom",
      href: helpGuideHref(basePath, "wecom"),
      summary: "Preferred AIBot WebSocket (Bot ID + Secret); optional corp-app URL callback.",
    },
    {
      slug: "feishu",
      label: "Feishu",
      href: helpGuideHref(basePath, "feishu"),
      summary: "Preferred WebSocket (App ID + App Secret); webhook needs Verification Token.",
    },
    {
      slug: "dingtalk",
      label: "DingTalk",
      href: helpGuideHref(basePath, "dingtalk"),
      summary:
        "Preferred Stream (Client ID + Client Secret); HTTP callback needs Callback URL backfill.",
    },
  ];
}

const GUIDE_ZH: Record<HelpGuideSlug, HelpGuideDocument> = {
  "enterprise-im": {
    slug: "enterprise-im",
    kicker: "指南",
    title: "企业 IM 接入",
    subtitle: "在企业控制台配置企业微信、飞书、钉钉消息通道。",
    backLabel: "返回帮助中心",
    sections: [
      {
        id: "overview",
        title: "入口与边界",
        paragraphs: [
          "企业租户在「企业控制台 → 系统设置 → 消息通道」配置企业微信 / 飞书 / 钉钉。",
          "该页使用精简表单：先选连接模式，只填该模式必填项，再用真实对话验收。",
          "OpenBot 企业 IM 是租户级网关绑定（凭证写入 channels.<id>.accounts.t_<tenant>_default.*），不是个人桌面「远程助理」：消息由组织侧 Gateway 处理，前提是机器人可见范围 / 发布状态已覆盖对应成员。",
        ],
      },
      {
        id: "principles",
        title: "设计原则",
        paragraphs: [],
        table: {
          headers: ["原则", "在 OpenBot 中的含义"],
          rows: [
            ["长连接优先", "平台支持时优先 WebSocket / Stream，无需公网 Callback"],
            ["模式互斥", "长连接与 URL 回调凭证不同，不可混用"],
            ["精简字段", "写入租户默认账户，不是运维全量 schema"],
            ["双段清单", "先做开放平台准备，再保存 / 回填 Callback /「你好」+ 测试连通"],
            ["边界", "QQ 不进入企业消息通道"],
          ],
        },
      },
      {
        id: "channels",
        title: "选择渠道",
        paragraphs: [],
        table: {
          headers: ["渠道", "推荐模式", "最少凭证"],
          rows: [
            ["企业微信", "AIBot WebSocket 长连接", "Bot ID + Secret"],
            ["飞书", "WebSocket 长连接", "App ID + App Secret"],
            ["钉钉", "Stream 长连接", "Client ID + Client Secret"],
          ],
        },
      },
      {
        id: "verify",
        title: "统一验收",
        paragraphs: ["按所选模式完成下列步骤后再上线："],
        bullets: [
          "开放平台：可见范围 / 机器人能力 / 权限 / 发布",
          "OpenBot：选择相同模式并保存凭证",
          "仅回调模式：把只读 Callback URL 回填到开放平台",
          "向机器人发送「你好」",
          "在企业通道页点击「测试连通」",
        ],
      },
    ],
  },
  wecom: {
    slug: "wecom",
    kicker: "指南",
    title: "企业微信",
    subtitle: "AIBot 长连接与自建应用回调接入。",
    backLabel: "返回帮助中心",
    sections: [
      {
        id: "modes",
        title: "两种连接模式（不可混用）",
        paragraphs: [
          "OpenBot 支持企业微信企业消息接入（不支持个人微信）。长连接网关：wss://openws.work.weixin.qq.com（aibot_subscribe）。",
        ],
        table: {
          headers: ["模式", "企微入口", "OpenBot 字段", "公网 Callback"],
          rows: [
            [
              "WebSocket 长连接（推荐）",
              "智能机器人 → API → 使用长连接",
              "botId、secret",
              "不需要",
            ],
            [
              "URL 回调",
              "自建应用 → 接收消息",
              "corpId、agentId、secret、token、encodingAesKey",
              "需要",
            ],
          ],
        },
      },
      {
        id: "ws-platform",
        title: "A. WebSocket 长连接 — 开放平台",
        paragraphs: ["路径：企业控制台 → 系统设置 → 消息通道 → 企业微信。"],
        bullets: [
          "管理后台：安全与管理 → 管理工具 → 智能机器人 → 创建机器人",
          "优先手动创建 → API 模式；填写名称并设置可见范围",
          "API 配置选择「使用长连接」",
          "复制 Bot ID；点击「点击获取」得到 Secret（仅显示一次）",
          "此模式不要配置 URL / Token / EncodingAESKey",
        ],
      },
      {
        id: "ws-openbot",
        title: "A. WebSocket 长连接 — 本页配置",
        paragraphs: [],
        bullets: [
          "连接模式选「WebSocket 长连接」",
          "填写 Bot ID、长连接 Secret 并保存",
          "无需回填 Callback；网关会主动连接企微",
          "在通讯录「企业创建的」中找到机器人，发送「你好」",
          "点击「测试连通」（成功表示 AIBot subscribe 鉴权通过）",
        ],
      },
      {
        id: "callback",
        title: "B. URL 回调（备选）",
        paragraphs: [
          "适用于已有公网网关的自建应用回调。顺序：企微生成 Token/AESKey → 填入 OpenBot → 复制 URL → 回填企微 → 保存企微。",
        ],
        bullets: [
          "创建自建应用并设置成员可见范围；在「接收消息」生成 Token 与 43 位 EncodingAESKey",
          "OpenBot 选「URL 回调」，填写五项凭证并保存",
          "复制只读 Callback URL（如 /wecom/a/t_<tenant>_default）回填企微并保存",
          "发送「你好」，再点「测试连通」",
        ],
      },
      {
        id: "troubleshoot",
        title: "故障排除",
        paragraphs: [],
        table: {
          headers: ["现象", "排查"],
          rows: [
            ["长连接测试失败", "两侧模式一致；Bot ID/Secret 无空格；Secret 是否需重新获取"],
            ["回调 URL 校验失败", "Token/AESKey 一致；HTTPS 可达；网关在运行"],
            ["机器人不回复", "可见范围；已发布；发送方在范围内；查网关日志"],
            ["模式不一致", "长连接凭证不能用于回调字段，反之亦然"],
          ],
        },
      },
    ],
  },
  feishu: {
    slug: "feishu",
    kicker: "指南",
    title: "飞书",
    subtitle: "WebSocket 长连接与 URL 回调接入。",
    backLabel: "返回帮助中心",
    sections: [
      {
        id: "modes",
        title: "两种连接模式",
        paragraphs: ["状态：生产就绪，支持机器人私聊和群组。"],
        table: {
          headers: ["模式", "飞书事件订阅", "OpenBot 字段", "公网 Callback"],
          rows: [
            ["WebSocket 长连接（推荐）", "使用长连接接收事件", "appId、appSecret", "不需要"],
            [
              "URL 回调",
              "将事件发送至开发者服务器",
              "App ID/Secret + Verification Token（建议 Encrypt Key）",
              "需要",
            ],
          ],
        },
      },
      {
        id: "platform",
        title: "开放平台检查",
        paragraphs: ["路径：企业控制台 → 系统设置 → 消息通道 → 飞书。"],
        bullets: [
          "飞书开放平台创建企业自建应用（国际版 Lark 使用 open.larksuite.com）",
          "添加「机器人」能力",
          "权限管理批量导入消息相关权限（须含 im:message:send_as_bot）",
          "凭证与基础信息复制 App ID / App Secret",
          "仅 URL 回调：在「事件与回调 → 加密策略」准备 Verification Token / Encrypt Key",
          "添加「接收消息」事件；需要卡片时再加卡片回传",
          "创建版本并发布（未发布则成员侧不可用）",
        ],
      },
      {
        id: "openbot",
        title: "本页配置",
        paragraphs: [],
        bullets: [
          "WebSocket（默认）：选长连接 → 填 App ID/Secret → 保存 → 飞书侧选「使用长连接接收事件」并验证 → 私聊发「你好」→ 测试连通",
          "URL 回调：选 URL 回调 → 填凭证 → 保存 → 复制 Callback URL 到「开发者服务器」→ 发「你好」→ 测试连通",
        ],
      },
    ],
  },
  dingtalk: {
    slug: "dingtalk",
    kicker: "指南",
    title: "钉钉",
    subtitle: "Stream 长连接与 HTTP 回调接入。",
    backLabel: "返回帮助中心",
    sections: [
      {
        id: "modes",
        title: "两种连接模式",
        paragraphs: ["Client ID 又称 AppKey；Client Secret 又称 AppSecret。"],
        table: {
          headers: ["模式", "钉钉侧", "OpenBot 字段", "公网 Callback"],
          rows: [
            ["Stream 长连接（推荐）", "消息接收 = Stream", "clientId、clientSecret", "不需要"],
            ["URL / HTTP 回调", "消息接收 = HTTP", "Client ID/Secret + Callback URL", "需要"],
          ],
        },
      },
      {
        id: "stream",
        title: "A. Stream 长连接",
        paragraphs: ["路径：企业控制台 → 系统设置 → 消息通道 → 钉钉。"],
        bullets: [
          "钉钉开放平台创建应用并添加机器人能力",
          "权限管理开通 Card.Streaming.Write、Card.Instance.Write、qyapi_robot_sendmsg",
          "凭证与基础信息复制 Client ID / Client Secret",
          "消息接收保持 Stream（此路径不要切 HTTP）；创建版本并发布",
          "群聊使用时：群的归属组织须与应用组织一致",
          "OpenBot 选 Stream → 填凭证保存 → 私聊或群内 @ 发「你好」→ 测试连通",
        ],
      },
      {
        id: "http",
        title: "B. URL 回调（备选）",
        paragraphs: [],
        bullets: [
          "OpenBot 选「URL 回调」，填写凭证并保存",
          "复制只读 Callback URL",
          "钉钉机器人消息接收：Stream → HTTP，粘贴 https 地址后发布",
          "发送「你好」，再测试连通",
        ],
      },
      {
        id: "troubleshoot",
        title: "故障排除",
        paragraphs: [],
        table: {
          headers: ["现象", "排查"],
          rows: [
            ["无回复", "应用已发布；三项权限已开；网关运行中"],
            ["群里找不到机器人", "群归属组织与应用一致；重启钉钉客户端"],
            ["HTTP 回调失败", "URL 为 https；钉钉侧为 HTTP；OpenBot 为 webhook"],
            ["模式不一致", "两侧必须同为 Stream 或同为 HTTP"],
          ],
        },
      },
    ],
  },
};

const GUIDE_EN: Record<HelpGuideSlug, HelpGuideDocument> = {
  "enterprise-im": {
    slug: "enterprise-im",
    kicker: "Guide",
    title: "Enterprise IM",
    subtitle: "Configure WeCom, Feishu, and DingTalk in the enterprise console.",
    backLabel: "Back to Help Center",
    sections: [
      {
        id: "overview",
        title: "Entry and boundary",
        paragraphs: [
          "Configure channels under Enterprise console → System settings → Message channels.",
          "Use the curated form: pick a connection mode, fill only required fields, then verify with a real chat.",
          "Enterprise IM is a tenant gateway binding, not a personal desktop remote assistant.",
        ],
      },
      {
        id: "principles",
        title: "Design principles",
        paragraphs: [],
        table: {
          headers: ["Principle", "Meaning"],
          rows: [
            ["Long-connection first", "Prefer WebSocket / Stream when available"],
            ["Mode mutual exclusion", "Do not mix long-connection and callback credentials"],
            ["Curated fields", "Writes tenant default account fields only"],
            ["Two-stage checklist", "Open platform prep → save / callback / probe"],
            ["Boundary", "QQ is not an enterprise message channel"],
          ],
        },
      },
      {
        id: "verify",
        title: "Shared verification",
        paragraphs: [],
        bullets: [
          "Finish visibility / bot capability / permissions / publish on the open platform",
          "Save matching credentials in OpenBot",
          "Callback mode only: backfill the read-only Callback URL",
          "Send 你好 to the bot",
          "Run Probe on the enterprise channel page",
        ],
      },
    ],
  },
  wecom: {
    slug: "wecom",
    kicker: "Guide",
    title: "WeCom",
    subtitle: "AIBot long connection and corp-app callback.",
    backLabel: "Back to Help Center",
    sections: [
      {
        id: "modes",
        title: "Two modes (do not mix)",
        paragraphs: [
          "OpenBot supports WeCom enterprise messaging (not personal WeChat). Long-connection gateway: wss://openws.work.weixin.qq.com.",
        ],
        table: {
          headers: ["Mode", "WeCom entry", "OpenBot fields", "Public callback"],
          rows: [
            ["WebSocket (recommended)", "AI bot → API → long connection", "botId, secret", "No"],
            [
              "URL callback",
              "Corp app → receive messages",
              "corpId, agentId, secret, token, encodingAesKey",
              "Yes",
            ],
          ],
        },
      },
      {
        id: "ws",
        title: "WebSocket checklist",
        paragraphs: [],
        bullets: [
          "Create an AI bot in API mode with long connection enabled",
          "Copy Bot ID and Secret (Secret shown once)",
          "In OpenBot choose WebSocket, save credentials, send 你好, then Probe",
        ],
      },
      {
        id: "callback",
        title: "URL callback checklist",
        paragraphs: [],
        bullets: [
          "Create a corp app; generate Token + 43-char EncodingAESKey",
          "Save five credentials in OpenBot, copy Callback URL back to WeCom",
          "Send 你好, then Probe",
        ],
      },
    ],
  },
  feishu: {
    slug: "feishu",
    kicker: "Guide",
    title: "Feishu",
    subtitle: "WebSocket long connection and URL callback.",
    backLabel: "Back to Help Center",
    sections: [
      {
        id: "modes",
        title: "Two modes",
        paragraphs: ["Production-ready for DM and group bots."],
        table: {
          headers: ["Mode", "Feishu subscription", "OpenBot fields", "Public callback"],
          rows: [
            ["WebSocket (recommended)", "Long-connection events", "appId, appSecret", "No"],
            [
              "URL callback",
              "Developer server",
              "App ID/Secret + Verification Token (+ Encrypt Key)",
              "Yes",
            ],
          ],
        },
      },
      {
        id: "steps",
        title: "Setup",
        paragraphs: [],
        bullets: [
          "Create an enterprise app, add Bot capability, import message scopes including im:message:send_as_bot",
          "Copy App ID / App Secret; publish a version",
          "WebSocket: save in OpenBot, enable long-connection on Feishu, send 你好, Probe",
          "Callback: save credentials, backfill Callback URL, send 你好, Probe",
        ],
      },
    ],
  },
  dingtalk: {
    slug: "dingtalk",
    kicker: "Guide",
    title: "DingTalk",
    subtitle: "Stream long connection and HTTP callback.",
    backLabel: "Back to Help Center",
    sections: [
      {
        id: "modes",
        title: "Two modes",
        paragraphs: ["Client ID is also called AppKey; Client Secret is AppSecret."],
        table: {
          headers: ["Mode", "DingTalk side", "OpenBot fields", "Public callback"],
          rows: [
            ["Stream (recommended)", "Message receive = Stream", "clientId, clientSecret", "No"],
            ["HTTP callback", "Message receive = HTTP", "Client ID/Secret + Callback URL", "Yes"],
          ],
        },
      },
      {
        id: "steps",
        title: "Setup",
        paragraphs: [],
        bullets: [
          "Create an internal app with robot capability; open Card.Streaming.Write, Card.Instance.Write, qyapi_robot_sendmsg",
          "Keep Stream for long-connection path; publish the app",
          "Save credentials in OpenBot, chat 你好 (or @ in group), then Probe",
          "HTTP path: switch DingTalk to HTTP and backfill the https Callback URL",
        ],
      },
    ],
  },
};

const ZH: HelpDocument = {
  kicker: "服务",
  title: "帮助中心",
  subtitle: "员工工作台操作、企业消息通道、常见问题与联系支持。",
  intro: [
    "员工日常操作看「员工工作台」。这些页面只写 https://www.openbot.love/ 登录后会出现的控件。",
    "配置企业微信 / 飞书 / 钉钉时，用「企业消息通道」（与企业控制台「消息通道」精简表单一致）。",
    "账号、数据或隐私问题可先查阅下方常见问题；未能找到答案时，请通过邮件联系我们。",
  ],
  workbenchGuidesTitle: "员工工作台",
  workbenchGuidesIntro:
    "入口是 https://www.openbot.love/ 。不是企业控制台，也不是 18789 上的 Gateway 控制台。登录后也可从右上角头像菜单打开本页。",
  workbenchGuides: getWorkbenchHelpCards("zh-CN"),
  guidesTitle: "企业消息通道配置指南",
  guidesIntro:
    "OpenBot 企业 IM 是租户级网关绑定（长连接优先）。在开放平台完成可见范围 / 权限 / 发布后，到企业控制台保存凭证，再发「你好」并点击测试连通。",
  guides: buildGuides("zh-CN"),
  faqTitle: "常见问题",
  faq: [
    {
      question: "我的对话存在我的电脑里吗？",
      answer: "在线版不会。对话保存在云端，浏览器只是访问入口。",
    },
    {
      question: "换手机登录，能看到之前的对话吗？",
      answer: "可以。同一账号登录后访问的是同一份云端数据。",
    },
    {
      question: "OpenBot 员工能看到我的聊天记录吗？",
      answer:
        "正常情况下不会随意查看。仅在运维、故障排查、安全事件或法律要求等必要场景下，经授权人员可能访问。",
    },
    {
      question: "数据会用来训练 AI 吗？",
      answer:
        "OpenBot 不会将你的数据用于训练自有模型（另有明确告知并征得同意的除外）。对话内容会发送给你选择的第三方模型服务商，其行为受其自身政策约束。",
    },
    {
      question: "我想要数据完全不出公司/不出本机，怎么办？",
      answer: "数据与模型可以留在客户侧私有模型。OpenBot 的身份、策略与更新仍走云端 SaaS。",
    },
    {
      question: "完整的隐私说明在哪里？",
      answer: "请查看「隐私与安全」页面，了解数据收集、存储、访问权限与保留期限等完整说明。",
    },
  ],
  contactTitle: "联系我们",
  contactIntro: "隐私、数据与使用相关问题，请发送邮件至：",
  contactEmail: CONTACT_EMAIL,
};

const EN: HelpDocument = {
  kicker: "Support",
  title: "Help Center",
  subtitle: "Employee workbench, enterprise IM, FAQ, and support contact.",
  intro: [
    "Day-to-day clicks are under Employee workbench. Those pages only name controls that appear after login at https://www.openbot.love/.",
    "For WeCom / Feishu / DingTalk, use the enterprise message-channel guides below.",
    "For account, data, or privacy questions, check the FAQ; email us if you still need help.",
  ],
  workbenchGuidesTitle: "Employee workbench",
  workbenchGuidesIntro:
    "Entry is https://www.openbot.love/. Not the enterprise console and not the Gateway UI on port 18789. After login, open this page from the avatar menu.",
  workbenchGuides: getWorkbenchHelpCards("en"),
  guidesTitle: "Enterprise message-channel guides",
  guidesIntro:
    "OpenBot enterprise IM is a tenant gateway binding (long-connection first). Finish visibility / permissions / publish on the open platform, save credentials in the enterprise console, then send “你好” and run Probe.",
  guides: buildGuides("en"),
  faqTitle: "FAQ",
  faq: [
    {
      question: "Are chats stored only on my computer?",
      answer: "No. Online mode stores chats in the cloud; the browser is an access point.",
    },
    {
      question: "Will I see past chats on another phone?",
      answer: "Yes—the same account reads the same cloud data.",
    },
    {
      question: "Can OpenBot staff read my chats?",
      answer:
        "Not routinely. Authorized access may occur for operations, incidents, or legal requirements.",
    },
    {
      question: "Is my data used to train AI?",
      answer:
        "OpenBot does not use your data to train its own models unless we explicitly ask and you agree. Configured model providers apply their own policies.",
    },
    {
      question: "I need data to stay on-prem—what should I do?",
      answer:
        "Keep data and models on a customer-side private model. OpenBot identity, policy, and updates stay on cloud SaaS.",
    },
    {
      question: "Where is the full privacy notice?",
      answer:
        "See the Privacy & Security page for collection, storage, access, and retention details.",
    },
  ],
  contactTitle: "Contact",
  contactIntro: "For privacy, data, and usage questions, email:",
  contactEmail: CONTACT_EMAIL,
};

export function getPublicHelpDocument(locale: Locale, basePath = ""): HelpDocument {
  const base = locale === "zh-CN" ? ZH : EN;
  return {
    ...base,
    workbenchGuides: getWorkbenchHelpCards(locale, basePath),
    guides: buildGuides(locale, basePath),
  };
}

export function getPublicHelpGuideDocument(locale: Locale, slug: HelpGuideSlug): HelpGuideDocument {
  return locale === "zh-CN" ? GUIDE_ZH[slug] : GUIDE_EN[slug];
}
