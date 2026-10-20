import type { Locale } from "../../i18n/index.ts";
import type { FeaturesSection } from "./public-features-document.ts";
import type { PrivacyTable } from "./public-privacy-document.ts";

// 「合作伙伴生态」内容页数据。结构复用产品功能页（FeaturesSection/PrivacyTable），
// 以便直接使用 public-legal-pages.ts 中既有的 renderFeaturesSection / renderDocTable 渲染器。
export type PartnerEcosystemDocument = {
  kicker: string;
  title: string;
  subtitle: string;
  intro: string[];
  sections: FeaturesSection[];
  summaryTitle: string;
  summaryTable: PrivacyTable;
  closing: string;
};

const ZH: PartnerEcosystemDocument = {
  kicker: "资源",
  title: "合作伙伴生态",
  subtitle: "开放集成，统一治理——与模型、渠道、插件与工具生态共建数字员工",
  intro: [
    "OpenBot 坚持开放：核心保持精简，能力通过生态扩展。",
    "企业已有的模型、沟通渠道与业务工具，都可以接入数字员工，并在统一的治理边界内运行。",
    "无论你是模型提供方、渠道平台、插件开发者，还是技能与 MCP 服务方，都能成为这个生态的一部分。",
  ],
  sections: [
    {
      id: "models",
      title: "1. 模型提供方",
      tagline: "自带模型，统一接入与治理",
      paragraphs: [
        "OpenBot 兼容主流大模型提供方，企业可自带 API Key（BYOK），在统一入口内选择、切换与治理模型。",
        "已支持的提供方包括 OpenAI、Anthropic、Google Gemini、AWS Bedrock、通义千问、MiniMax 等，并持续扩展。",
      ],
      bullets: [
        "自带 Key（BYOK）：密钥归企业所有，随时可轮换与回收",
        "多模型统一入口：按成本、能力与合规需要灵活切换",
        "模型调用纳入治理与审计，边界清晰",
      ],
      valueTitle: "生态价值",
      valueText: "企业不被单一模型绑定，可在开放的模型生态中自由选择最合适的组合。",
    },
    {
      id: "channels",
      title: "2. 消息与协作渠道",
      tagline: "在团队已经使用的平台上直接工作",
      paragraphs: [
        "数字员工可以在企业已有的沟通平台上收发消息、执行任务，无需改变团队的协作习惯。",
      ],
      bullets: [
        "内置渠道：Telegram、Discord、Slack、Signal、iMessage、WhatsApp",
        "扩展渠道：Microsoft Teams、Matrix、语音通话等（通过扩展支持）",
        "统一的配对、允许名单与命令门控，跨渠道保持一致",
      ],
      valueTitle: "生态价值",
      valueText: "数字员工融入日常协作，而不是又一个需要单独打开的工具。",
    },
    {
      id: "plugins",
      title: "3. 插件与扩展开发者",
      tagline: "核心精简，能力靠生态扩展",
      paragraphs: [
        "OpenBot 提供开放的插件 API。第三方可以以 npm 包形式分发插件与扩展，新增渠道、能力与集成，而无需改动核心。",
      ],
      bullets: [
        "开放插件 API：覆盖渠道、工具、模型鉴权、记忆等扩展点",
        "以 npm 分发：在自己的仓库中独立维护与发布",
        "社区插件列表：用于发现、共享与协作",
      ],
      valueTitle: "生态价值",
      valueText: "开发者在核心之外自由构建，生态因此持续生长，核心保持稳定。",
    },
    {
      id: "skills-mcp-providers",
      title: "4. 技能与 MCP 提供方",
      tagline: "把专业能力与外部工具接入数字员工",
      paragraphs: [
        "技能作者可以把专业工作沉淀为技能，通过能力中心统一发布与授权；MCP 服务方可以通过 mcporter 桥接把外部工具与数据接入数字员工。",
      ],
      bullets: [
        "技能：以能力中心统一发布、审核与授权",
        "MCP：以配置接入外部工具与数据源，支持 HTTP 与 stdio",
        "与「技能与 MCP」一脉相承：能力可治理、可审计、可回收",
      ],
      valueTitle: "生态价值",
      valueText: "让专业能力与行业工具，成为数字员工可复用、可继承的一部分。",
    },
    {
      id: "join",
      title: "5. 参与共建",
      tagline: "多种方式加入 OpenBot 生态",
      bullets: [
        "开发并发布插件 / 扩展（以 npm 分发）",
        "贡献技能到能力中心",
        "提供 MCP 服务，接入外部工具与数据",
        "作为模型 / 渠道集成方接入",
        "对接客户侧私有模型，或参与渠道白标 App 预装与结算",
      ],
      valueTitle: "生态价值",
      valueText: "开放接入 + 统一治理，是 OpenBot 与合作伙伴共建的基本盘。",
    },
  ],
  summaryTitle: "合作伙伴生态总览",
  summaryTable: {
    headers: ["生态角色", "接入方式", "价值"],
    rows: [
      ["模型提供方", "BYOK / 统一模型入口", "不被单一模型绑定"],
      ["消息渠道", "内置渠道 + 扩展渠道", "融入现有沟通习惯"],
      ["插件 / 扩展开发者", "开放 API + npm 分发", "核心精简，能力可扩展"],
      ["技能与 MCP 提供方", "能力中心 / mcporter 桥接", "专业能力可复用、可治理"],
    ],
  },
  closing:
    "开放的生态负责扩展能力，统一的治理负责守住边界——这就是 OpenBot 与合作伙伴共建数字员工的方式。",
};

const EN: PartnerEcosystemDocument = {
  kicker: "Resources",
  title: "Partner Ecosystem",
  subtitle:
    "Open integration, unified governance—building digital employees together with models, channels, plugins, and tools",
  intro: [
    "OpenBot stays open: the core remains lean, and capability grows through the ecosystem.",
    "The models, channels, and business tools you already use can plug into digital employees and run within one governance boundary.",
    "Whether you are a model provider, a channel platform, a plugin developer, or a skills and MCP provider, you can be part of this ecosystem.",
  ],
  sections: [
    {
      id: "models",
      title: "1. Model providers",
      tagline: "Bring your own model, integrated and governed in one place",
      paragraphs: [
        "OpenBot is compatible with mainstream model providers. Enterprises bring their own API keys (BYOK) and select, switch, and govern models from a single entry point.",
        "Supported providers include OpenAI, Anthropic, Google Gemini, AWS Bedrock, Qwen, and MiniMax, with more added over time.",
      ],
      bullets: [
        "BYOK: keys stay owned by the enterprise, rotatable and revocable anytime",
        "One entry point for many models: switch by cost, capability, and compliance",
        "Model calls are governed and audited within clear boundaries",
      ],
      valueTitle: "Ecosystem value",
      valueText:
        "No lock-in to a single model—pick the best combination from an open model ecosystem.",
    },
    {
      id: "channels",
      title: "2. Messaging and collaboration channels",
      tagline: "Work right where your team already is",
      paragraphs: [
        "Digital employees send and receive messages and run tasks on the communication platforms your team already uses—no need to change habits.",
      ],
      bullets: [
        "Built-in channels: Telegram, Discord, Slack, Signal, iMessage, WhatsApp",
        "Extension channels: Microsoft Teams, Matrix, voice calls, and more (via extensions)",
        "Consistent pairing, allowlists, and command gating across channels",
      ],
      valueTitle: "Ecosystem value",
      valueText: "Digital employees blend into daily collaboration, not yet another app to open.",
    },
    {
      id: "plugins",
      title: "3. Plugin and extension developers",
      tagline: "A lean core; capability grows through the ecosystem",
      paragraphs: [
        "OpenBot offers an open plugin API. Third parties distribute plugins and extensions as npm packages—adding channels, capabilities, and integrations without touching the core.",
      ],
      bullets: [
        "Open plugin API: extension points for channels, tools, model auth, memory, and more",
        "npm distribution: maintain and release independently from your own repository",
        "Community plugin listing: for discovery, sharing, and collaboration",
      ],
      valueTitle: "Ecosystem value",
      valueText:
        "Developers build freely outside the core, so the ecosystem keeps growing while the core stays stable.",
    },
    {
      id: "skills-mcp-providers",
      title: "4. Skills and MCP providers",
      tagline: "Bring specialized capability and external tools to digital employees",
      paragraphs: [
        "Skill authors turn specialized work into skills, published and authorized through the Capability Center; MCP providers connect external tools and data to digital employees via the mcporter bridge.",
      ],
      bullets: [
        "Skills: published, reviewed, and authorized through the Capability Center",
        "MCP: connect external tools and data by configuration, over HTTP or stdio",
        "In line with Skills & MCP: capability stays governable, auditable, and revocable",
      ],
      valueTitle: "Ecosystem value",
      valueText:
        "Turn specialized capability and industry tools into a reusable, inheritable part of your digital employees.",
    },
    {
      id: "join",
      title: "5. Get involved",
      tagline: "Multiple ways to join the OpenBot ecosystem",
      bullets: [
        "Build and publish plugins / extensions (distributed via npm)",
        "Contribute skills to the Capability Center",
        "Offer MCP services that connect external tools and data",
        "Integrate as a model or channel provider",
        "Connect customer-side private models, or join a channel white-label app preinstall",
      ],
      valueTitle: "Ecosystem value",
      valueText:
        "Open access plus unified governance is the foundation OpenBot builds on with partners.",
    },
  ],
  summaryTitle: "Partner ecosystem at a glance",
  summaryTable: {
    headers: ["Ecosystem role", "How to integrate", "Value"],
    rows: [
      ["Model providers", "BYOK / one model entry point", "No single-model lock-in"],
      ["Messaging channels", "Built-in + extension channels", "Fits existing communication habits"],
      [
        "Plugin / extension developers",
        "Open API + npm distribution",
        "Lean core, extensible capability",
      ],
      [
        "Skills & MCP providers",
        "Capability Center / mcporter bridge",
        "Reusable, governable capability",
      ],
    ],
  },
  closing:
    "An open ecosystem extends capability while unified governance holds the line—that is how OpenBot builds digital employees together with its partners.",
};

export function getPublicPartnerEcosystemDocument(locale: Locale): PartnerEcosystemDocument {
  return locale === "zh-CN" ? ZH : EN;
}
