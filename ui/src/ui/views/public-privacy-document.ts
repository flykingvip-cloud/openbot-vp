import type { Locale } from "../../i18n/index.ts";

export type PrivacyTable = {
  headers: string[];
  rows: string[][];
};

export type PrivacySection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  table?: PrivacyTable;
};

export type PrivacyFaqItem = {
  question: string;
  answer: string;
};

export type PrivacyDocument = {
  kicker: string;
  title: string;
  subtitle: string;
  updated: string;
  sections: PrivacySection[];
  contactTitle: string;
  contactEmail: string;
};

const CONTACT_EMAIL = "daniel.hhd@gmail.com";

const ZH: PrivacyDocument = {
  kicker: "服务",
  title: "数据与隐私说明",
  subtitle: "了解 OpenBot 在线服务如何收集、存储与保护你的数据。",
  updated: "最后更新：2026 年 7 月",
  sections: [
    {
      id: "overview",
      title: "一、说明范围",
      paragraphs: [
        "本说明适用于通过 www.openbot.love 使用的 OpenBot 在线服务。",
        "OpenBot 在线版采用「云端统一存储、多端共享访问」：你在电脑、手机或不同浏览器登录同一账号时，访问的是同一份对话、小组与知识库数据。",
      ],
    },
    {
      id: "data",
      title: "二、我们保存哪些数据",
      paragraphs: [
        "在使用 OpenBot 在线服务时，以下数据会保存在云端服务器（而非仅存在浏览器或本机）：",
      ],
      table: {
        headers: ["类型", "示例", "用途"],
        rows: [
          ["账号信息", "邮箱、显示名称、所属企业", "登录、身份识别、权限管理"],
          ["对话与协作", "与 AI 的对话、协作群消息、任务进度", "提供连续对话与协作能力"],
          ["记忆与配置", "助手设定、记忆摘要、工作区配置", "保持上下文与个性化体验"],
          ["知识库", "上传文档、网页采集、检索索引", "知识问答与检索增强"],
          ["企业与组织", "岗位、成员关系、企业设置", "企业协作与权限控制"],
          ["使用与日志", "登录时间、操作与系统日志", "保障稳定、安全审计与故障排查"],
        ],
      },
      bullets: [
        "浏览器本地通常只保存界面语言等少量偏好；完整对话与知识库不会长期仅保存在浏览器中。",
      ],
    },
    {
      id: "location",
      title: "三、数据存在哪里",
      paragraphs: [
        "你的设备（浏览器 / App）通过 HTTPS 加密连接 OpenBot 云端 Gateway 服务器；必要时，内容会发送至你所配置的第三方 AI 模型服务商进行处理。",
        "同一账号在不同设备登录时，读写的是同一份云端数据。在线版需在联网状态下使用。",
      ],
    },
    {
      id: "access",
      title: "四、谁能访问你的数据",
      paragraphs: ["除你自己外，以下主体在必要范围内可能访问相关数据："],
      bullets: [
        "你所在企业的管理员（如适用）：可管理企业成员、岗位及企业级知识库与协作空间（以企业配置为准）。",
        "OpenBot 服务运营与运维人员：为保障服务、排查故障或处理安全事件，经授权人员可能在最小必要原则下访问服务器数据；我们不会向无关第三方出售你的个人数据。",
        "第三方 AI 模型服务商：对话与检索所需内容会传输至所配置的模型服务商；不同服务商的数据政策各不相同，请参阅其隐私政策。",
      ],
    },
    {
      id: "security",
      title: "五、我们如何保护数据",
      paragraphs: [
        "我们采用传输加密（HTTPS / WSS）、平台账号登录、按账号与企业 ID 隔离权限，以及云基础设施访问控制等措施。",
      ],
      bullets: [
        "在线服务意味着数据存放在云端，与「数据仅在本机、不上传」的模式不同。",
        "若你需要最高级别的本地控制，可自行部署 OpenBot Gateway（本地或专属云主机），而非使用公共在线版。",
      ],
    },
    {
      id: "rights",
      title: "六、你的权利",
      paragraphs: [
        "你有权查询、更正、删除、导出账号相关数据，或申请注销账号（法律法规另有规定的除外）。",
      ],
      bullets: [
        `联系 ${CONTACT_EMAIL} 行使上述权利；我们将在合理期限内回复（一般不超过 15 个工作日）。`,
      ],
    },
    {
      id: "retention",
      title: "七、数据保留",
      paragraphs: [
        "账号与对话记录在账号存续期间保留；系统日志通常保留 90～180 天。账号注销后，我们将在 30 天内完成主要个人数据的删除或匿名化处理。",
      ],
    },
    {
      id: "minors",
      title: "八、未成年人",
      paragraphs: [
        "OpenBot 在线服务面向年满 18 周岁或经监护人同意的用户。我们不会故意收集未成年人个人信息；如发现误收集，请联系我们删除。",
      ],
    },
    {
      id: "updates",
      title: "九、说明更新",
      paragraphs: [
        "我们可能因产品功能、法律法规或运维方式变化而更新本说明。重大变更时会在网站或产品内提示；继续使用即表示你理解更新后的版本。",
      ],
    },
  ],
  contactTitle: "联系我们",
  contactEmail: CONTACT_EMAIL,
};

const EN: PrivacyDocument = {
  kicker: "Legal",
  title: "Data & Privacy",
  subtitle: "How OpenBot online collects, stores, and protects your data.",
  updated: "Last updated: July 2026",
  sections: [
    {
      id: "overview",
      title: "1. Scope",
      paragraphs: [
        "This notice applies to the OpenBot online service at www.openbot.love.",
        "OpenBot online uses centralized cloud storage with shared access across devices: the same account sees the same conversations, groups, and knowledge on every browser or device.",
      ],
    },
    {
      id: "data",
      title: "2. What we store",
      paragraphs: [
        "When you use OpenBot online, the following is stored on cloud servers—not only in your browser:",
      ],
      table: {
        headers: ["Category", "Examples", "Purpose"],
        rows: [
          ["Account", "Email, display name, organization", "Sign-in, identity, access control"],
          [
            "Chat & collaboration",
            "AI chats, group messages, task progress",
            "Continuous conversation and teamwork",
          ],
          [
            "Memory & config",
            "Assistant settings, memory summaries, workspace config",
            "Context and personalization",
          ],
          ["Knowledge base", "Uploaded docs, web captures, search indexes", "Q&A and retrieval"],
          ["Organization", "Seats, membership, enterprise settings", "Enterprise collaboration"],
          [
            "Usage & logs",
            "Sign-in times, operational logs",
            "Reliability, security, troubleshooting",
          ],
        ],
      },
      bullets: [
        "Your browser typically keeps only lightweight preferences such as language—not your full chat or knowledge base history.",
      ],
    },
    {
      id: "location",
      title: "3. Where data lives",
      paragraphs: [
        "Your device connects over HTTPS to the OpenBot Gateway in the cloud. When needed, content is sent to the third-party AI providers you configure.",
        "The same cloud data is used on every device signed into the same account. Online mode requires a network connection.",
      ],
    },
    {
      id: "access",
      title: "4. Who can access your data",
      paragraphs: ["Besides you, these parties may access data when necessary:"],
      bullets: [
        "Your enterprise administrators (if applicable): manage members, seats, and org-level knowledge or spaces per your org policy.",
        "OpenBot operators: authorized staff may access server data under least-privilege for operations, incidents, or security; we do not sell personal data to unrelated third parties.",
        "AI model providers: conversation and retrieval payloads are sent to configured providers; each provider’s policy applies.",
      ],
    },
    {
      id: "security",
      title: "5. How we protect data",
      paragraphs: [
        "We use HTTPS/WSS, platform sign-in, account and tenant isolation, and infrastructure access controls.",
      ],
      bullets: [
        "Online service means data lives in the cloud—not the same model as fully local-only storage.",
        "For maximum control, self-host OpenBot Gateway on your own machine or dedicated infrastructure instead of the public online service.",
      ],
    },
    {
      id: "rights",
      title: "6. Your rights",
      paragraphs: [
        "You may request access, correction, deletion, export, or account closure where applicable by law.",
      ],
      bullets: [`Contact ${CONTACT_EMAIL}; we aim to respond within 15 business days.`],
    },
    {
      id: "retention",
      title: "7. Retention",
      paragraphs: [
        "Account and chat data is kept while the account is active; system logs are typically kept 90–180 days. After closure, primary personal data is deleted or anonymized within 30 days.",
      ],
    },
    {
      id: "minors",
      title: "8. Minors",
      paragraphs: [
        "OpenBot online is intended for users 18+ or with guardian consent. We do not knowingly collect minors’ data; contact us to remove any mistaken collection.",
      ],
    },
    {
      id: "updates",
      title: "9. Updates",
      paragraphs: [
        "We may update this notice as the product or law changes. Material changes will be surfaced on the site or in-product; continued use means you accept the updated notice.",
      ],
    },
  ],
  contactTitle: "Contact",
  contactEmail: CONTACT_EMAIL,
};

export function getPublicPrivacyDocument(locale: Locale): PrivacyDocument {
  return locale === "zh-CN" ? ZH : EN;
}
