import type { Locale } from "../../i18n/index.ts";
import type { FeaturesSection } from "./public-features-document.ts";
import type { PrivacyTable } from "./public-privacy-document.ts";

// 「技能与 MCP」内容页数据。结构复用产品功能页（FeaturesSection/PrivacyTable），
// 以便直接使用 public-legal-pages.ts 中既有的 renderFeaturesSection / renderDocTable 渲染器。
export type SkillsMcpDocument = {
  kicker: string;
  title: string;
  subtitle: string;
  intro: string[];
  sections: FeaturesSection[];
  summaryTitle: string;
  summaryTable: PrivacyTable;
  closing: string;
};

const ZH: SkillsMcpDocument = {
  kicker: "资源",
  title: "技能与 MCP",
  subtitle: "为数字员工装配可治理的技能，并安全接入企业已有的工具与系统",
  intro: [
    "每一个数字员工的能力，都由「技能（Skills）」与「MCP 工具连接」共同构成。",
    "技能定义数字员工「会做什么」，MCP 定义数字员工「能连接什么」。",
    "两者都在企业边界内被统一管理、按需启用、全程审计，最终沉淀为可复用、可继承的能力资产。",
  ],
  sections: [
    {
      id: "skills",
      title: "1. 技能 Skills｜数字员工的能力单元",
      tagline: "用一个文件夹，教会数字员工完成一类专业工作",
      paragraphs: [
        "技能是一个包含 SKILL.md 的文件夹，用自然语言与元数据描述「何时使用、如何执行」，兼容 AgentSkills 规范。",
        "数字员工在会话开始时加载可用技能，并在任务中按需调用，把一类专业工作变成可复用的标准动作。",
      ],
      subsections: [
        {
          id: "skills-sources",
          title: "技能来源与优先级",
          paragraphs: ["技能可以来自三个层级，同名冲突时按优先级覆盖："],
          bullets: [
            "内置技能：随安装分发，提供开箱即用的基础能力（最低优先级）",
            "托管 / 共享技能：位于 ~/.openbot/skills，同一台主机上的多个数字员工共享",
            "工作区技能：位于 <workspace>/skills，归属单个数字员工（最高优先级）",
            "优先级顺序：工作区技能 › 托管 / 共享技能 › 内置技能",
          ],
        },
        {
          id: "skills-gating",
          title: "按需启用的加载门控",
          paragraphs: [
            "技能不会无条件出现。OpenBot 在加载时根据真实运行环境自动过滤，只向数字员工暴露「当前可用」的技能：",
          ],
          bullets: [
            "依赖二进制：所需命令行工具存在于 PATH 时才启用",
            "依赖密钥 / 配置：相关环境变量或开关就绪时才启用",
            "操作系统限定：仅在指定平台（macOS / Linux / Windows）启用",
            "效果：技能列表始终与执行环境一致，减少无效尝试与失败调用",
          ],
        },
        {
          id: "skills-security",
          title: "安全与隔离",
          bullets: [
            "第三方技能按「不可信代码」对待，启用前需人工审阅",
            "支持沙箱运行，隔离高风险工具与不可信输入",
            "密钥仅在单次任务运行内注入进程，运行结束后即刻还原，作用范围限定在本次任务",
            "技能发现严格限制在配置目录内（realpath 校验），防止越界读取",
          ],
        },
      ],
      valueTitle: "产品价值",
      valueText: "技能让数字员工的能力可组合、可复用、可继承——员工离职，能力仍以资产形式留在企业。",
    },
    {
      id: "capability-center",
      title: "2. 能力中心｜技能的企业级分发与治理",
      tagline: "技能不再散落各处，而是在能力中心统一沉淀与授权",
      paragraphs: [
        "在团队与企业场景中，技能通过平台「能力中心」统一发布、审核、安装与授权，而非依赖外部市场。",
        "每一次技能的引入与使用都可追溯，管理员可精确控制哪些数字员工、在什么范围内使用某项技能。",
      ],
      subsections: [
        {
          id: "capability-center-flow",
          title: "从个人经验到组织资产",
          bullets: [
            "准入审核：技能上线前经过审核队列，把控质量与安全",
            "安装与授权：按数字员工或团队分配技能的使用范围",
            "贡献记录：追踪技能的来源、版本与引入路径",
            "贡献表现：观测技能的调用与实际效果，为治理与优化提供依据",
          ],
        },
      ],
      valueTitle: "产品价值",
      valueText: "能力中心让「个人经验」升级为「组织资产」，让技能的引入与使用始终可控、可审计。",
    },
    {
      id: "mcp",
      title: "3. MCP｜连接外部工具与数据",
      tagline: "让数字员工安全地接入企业已有的工具与系统",
      paragraphs: [
        "MCP（Model Context Protocol）是一套开放协议，用于把外部工具、数据源与服务暴露给 AI 使用。",
        "OpenBot 通过 mcporter 桥接支持 MCP，将 MCP 集成与核心运行时解耦，保持核心精简、稳定与安全。",
      ],
      subsections: [
        {
          id: "mcp-bridge",
          title: "桥接式集成的优势",
          bullets: [
            "无需重启网关，即可新增或调整 MCP 服务",
            "保持核心工具与上下文面精简",
            "降低 MCP 变更对核心稳定性与安全性的冲击",
          ],
        },
        {
          id: "mcp-connect",
          title: "如何接入",
          bullets: [
            "以配置方式声明 MCP 服务：指定命令、参数与环境变量",
            "支持 HTTP 与 stdio 两种传输方式，兼容主流 MCP 服务",
            "数字员工在获得授权后即可调用这些工具，完成跨系统的读取与操作",
          ],
        },
      ],
      valueTitle: "产品价值",
      valueText: "MCP 让数字员工不止会「说」，更能「连」——在企业边界内安全地操作真实系统。",
    },
    {
      id: "governance",
      title: "4. 统一治理｜能力在边界内运行",
      tagline: "技能与 MCP 都是可治理的执行能力，而非不受控的自由权限",
      bullets: [
        "身份绑定：每一次能力调用都归属到具体数字员工与责任边界",
        "权限策略：限定可用技能、可连接的 MCP 服务与可访问的数据范围",
        "全链路审计：记录技能调用与 MCP 操作的过程、数据访问与决策路径",
        "企业控制：可随时停用某项技能、回收 MCP 连接或冻结数字员工",
      ],
      valueTitle: "产品价值",
      valueText: "技能与 MCP 让能力持续扩展，治理体系确保这些能力始终可控、可审计、可回收。",
    },
  ],
  summaryTitle: "技能与 MCP 能力总览",
  summaryTable: {
    headers: ["能力", "作用", "面向用户的价值"],
    rows: [
      ["技能 Skills", "定义数字员工会做什么", "专业能力可复用、可继承"],
      ["能力中心", "技能的企业级分发与治理", "个人经验沉淀为组织资产"],
      ["MCP 连接", "接入外部工具与数据源", "打通已有系统，扩展执行边界"],
      ["统一治理", "为能力设定边界与审计", "能力可控、可审计、可回收"],
    ],
  },
  closing: "技能定义能力，MCP 连接世界，治理守住边界——让每一个数字员工都成为企业可信赖的执行力。",
};

const EN: SkillsMcpDocument = {
  kicker: "Resources",
  title: "Skills & MCP",
  subtitle:
    "Equip digital employees with governable skills and safe connections to your existing tools and systems",
  intro: [
    "Every digital employee's capability is built from two parts: Skills and MCP tool connections.",
    "Skills define what a digital employee can do; MCP defines what it can connect to.",
    "Both are managed within enterprise boundaries, enabled on demand, and fully audited—turning capability into reusable, inheritable assets.",
  ],
  sections: [
    {
      id: "skills",
      title: "1. Skills — the capability unit of a digital employee",
      tagline: "A single folder teaches a digital employee to do a whole class of work",
      paragraphs: [
        "A skill is a folder containing a SKILL.md that describes—in plain language plus metadata—when to use it and how to run it, following the AgentSkills spec.",
        "Digital employees load eligible skills when a session starts and invoke them on demand, turning specialized work into reusable, standard moves.",
      ],
      subsections: [
        {
          id: "skills-sources",
          title: "Sources and precedence",
          paragraphs: [
            "Skills come from three layers; on a name conflict, higher precedence wins:",
          ],
          bullets: [
            "Bundled skills: shipped with the install for out-of-the-box basics (lowest precedence)",
            "Managed / shared skills: in ~/.openbot/skills, shared across digital employees on the same host",
            "Workspace skills: in <workspace>/skills, owned by a single digital employee (highest precedence)",
            "Order: workspace › managed / shared › bundled",
          ],
        },
        {
          id: "skills-gating",
          title: "On-demand load-time gating",
          paragraphs: [
            "Skills do not appear unconditionally. OpenBot filters them at load time against the real runtime, exposing only what is currently usable:",
          ],
          bullets: [
            "Binary requirements: enabled only when required CLIs exist on PATH",
            "Secret / config requirements: enabled only when env vars or switches are ready",
            "OS scoping: enabled only on the declared platforms (macOS / Linux / Windows)",
            "Result: the skill list always matches the environment, reducing failed calls",
          ],
        },
        {
          id: "skills-security",
          title: "Security and isolation",
          bullets: [
            "Treat third-party skills as untrusted code; review before enabling",
            "Sandboxed runs isolate risky tools and untrusted inputs",
            "Secrets are injected only for a single run and restored immediately after, scoped to that task",
            "Skill discovery is confined to configured directories (realpath checks) to prevent out-of-bounds reads",
          ],
        },
      ],
      valueTitle: "Value",
      valueText:
        "Skills make capability composable, reusable, and inheritable—when people leave, the capability stays as an enterprise asset.",
    },
    {
      id: "capability-center",
      title: "2. Capability Center — enterprise distribution and governance",
      tagline: "Skills are no longer scattered; they are consolidated and authorized in one place",
      paragraphs: [
        "For teams and enterprises, skills are published, reviewed, installed, and authorized through the platform Capability Center rather than an external marketplace.",
        "Every introduction and use of a skill is traceable, and admins control precisely which digital employees may use a skill and where.",
      ],
      subsections: [
        {
          id: "capability-center-flow",
          title: "From personal experience to organizational assets",
          bullets: [
            "Review queue: skills pass an approval gate before going live for quality and safety",
            "Install and authorization: assign a skill's usage scope per digital employee or team",
            "Contribution records: track a skill's source, version, and how it was introduced",
            "Contribution performance: observe real usage and impact to inform governance and tuning",
          ],
        },
      ],
      valueTitle: "Value",
      valueText:
        "The Capability Center upgrades personal experience into organizational assets, keeping skill adoption controllable and auditable.",
    },
    {
      id: "mcp",
      title: "3. MCP — connect external tools and data",
      tagline: "Let digital employees safely reach the tools and systems you already run",
      paragraphs: [
        "MCP (Model Context Protocol) is an open protocol for exposing external tools, data sources, and services to AI.",
        "OpenBot supports MCP through the mcporter bridge, decoupling MCP integration from the core runtime to keep the core lean, stable, and secure.",
      ],
      subsections: [
        {
          id: "mcp-bridge",
          title: "Why a bridge model",
          bullets: [
            "Add or change MCP servers without restarting the gateway",
            "Keep the core tool and context surface lean",
            "Reduce the impact of MCP churn on core stability and security",
          ],
        },
        {
          id: "mcp-connect",
          title: "How to connect",
          bullets: [
            "Declare MCP servers by configuration: command, args, and environment variables",
            "Supports both HTTP and stdio transports, compatible with mainstream MCP servers",
            "Once authorized, digital employees can call these tools to read and act across systems",
          ],
        },
      ],
      valueTitle: "Value",
      valueText:
        "MCP lets digital employees not just talk, but connect—operating real systems within enterprise boundaries.",
    },
    {
      id: "governance",
      title: "4. Unified governance — capability runs within boundaries",
      tagline: "Skills and MCP are governable execution capabilities, not unchecked free rein",
      bullets: [
        "Identity binding: every capability call is attributed to a specific digital employee and responsibility boundary",
        "Policy control: scope which skills, MCP servers, and data a digital employee may reach",
        "End-to-end audit: record the process, data access, and decision path of skill calls and MCP actions",
        "Enterprise control: disable a skill, revoke an MCP connection, or freeze a digital employee at any time",
      ],
      valueTitle: "Value",
      valueText:
        "Skills and MCP keep capability expanding; governance keeps that capability controllable, auditable, and revocable.",
    },
  ],
  summaryTitle: "Skills & MCP at a glance",
  summaryTable: {
    headers: ["Capability", "What it does", "User value"],
    rows: [
      [
        "Skills",
        "Define what a digital employee can do",
        "Expertise becomes reusable and inheritable",
      ],
      [
        "Capability Center",
        "Enterprise distribution and governance of skills",
        "Personal experience becomes organizational assets",
      ],
      [
        "MCP connections",
        "Reach external tools and data sources",
        "Connect existing systems, extend execution",
      ],
      [
        "Unified governance",
        "Set boundaries and audit for capability",
        "Controllable, auditable, revocable",
      ],
    ],
  },
  closing:
    "Skills define capability, MCP connects the world, and governance holds the line—so every digital employee becomes execution power the enterprise can trust.",
};

export function getPublicSkillsMcpDocument(locale: Locale): SkillsMcpDocument {
  return locale === "zh-CN" ? ZH : EN;
}
