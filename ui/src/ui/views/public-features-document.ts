import type { Locale } from "../../i18n/index.ts";
import type { PrivacyTable } from "./public-privacy-document.ts";

export type FeaturesAssetCard = {
  id: string;
  title: string;
  subtitle: string;
  bullets: string[];
};

export type FeaturesSubsection = {
  id?: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  assetCards?: FeaturesAssetCard[];
};

export type FeaturesSection = {
  id: string;
  title: string;
  tagline?: string;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: FeaturesSubsection[];
  valueTitle?: string;
  valueText?: string;
};

export type FeaturesDocument = {
  kicker: string;
  title: string;
  subtitle: string;
  intro: string[];
  sections: FeaturesSection[];
  summaryTitle: string;
  summaryTable: PrivacyTable;
  closing: string;
};

const ZH: FeaturesDocument = {
  kicker: "产品",
  title: "产品功能",
  subtitle: "OpenBot 企业级数字员工管理与执行系统",
  intro: [
    "让企业拥有可继承、可执行、可治理的 AI 劳动力。",
    "传统 AI 工具解决的是「帮员工完成任务」；OpenBot 重新定义企业 AI 的组织形态——数字员工不再是一次性助手，而是企业可管理、可沉淀、可继承、可治理的数字资产。",
    "OpenBot 通过数字员工生命周期管理、企业规则执行、运营自动驾驶与 AI 治理体系，帮助企业构建下一代智能化组织。",
  ],
  sections: [
    {
      id: "lifecycle",
      title: "1. 数字员工生命周期管理",
      tagline: "员工离职，数字员工不离职",
      paragraphs: [
        "企业最大的隐性损失，不只是人员流失，更是员工长期积累的经验、流程与工作能力随之消失。",
        "OpenBot 将数字员工视为企业长期资产，实现 AI 能力的持续沉淀与传承。",
      ],
      subsections: [
        {
          id: "custody",
          title: "企业资产级数字员工管理",
          paragraphs: [
            "当员工离职时，其管理的数字员工自动进入企业托管模式（Enterprise Custody Mode），相关资产自动归属于企业：",
          ],
          assetCards: [
            {
              id: "memory",
              title: "Memory",
              subtitle: "工作记忆资产",
              bullets: ["工作上下文", "历史决策经验", "业务沟通记录", "任务执行偏好"],
            },
            {
              id: "knowledge",
              title: "Knowledge",
              subtitle: "企业知识资产",
              bullets: ["业务知识库", "文档资料", "行业经验", "工作方法论"],
            },
            {
              id: "skills",
              title: "Skills",
              subtitle: "能力资产",
              bullets: ["已配置技能", "自动化流程", "任务执行能力", "专业工作模块"],
            },
            {
              id: "accounts",
              title: "Accounts",
              subtitle: "执行权限资产",
              bullets: ["系统账号授权", "第三方平台权限", "数据访问范围"],
            },
            {
              id: "audit",
              title: "Audit Trail",
              subtitle: "操作审计资产",
              bullets: ["执行过程", "数据访问", "决策路径", "操作日志"],
            },
          ],
        },
        {
          title: "新员工一键继承",
          bullets: [
            "一键继承数字员工",
            "恢复完整工作上下文",
            "延续已有业务能力",
            "无需重新训练 AI",
          ],
        },
      ],
      valueTitle: "产品价值",
      valueText: "OpenBot 让员工离职不再意味着企业能力流失，让数字员工成为企业长期积累的智能资产。",
    },
    {
      id: "rules",
      title: "2. 企业制度自动执行",
      tagline: "公司制度，不再依赖人工理解",
      paragraphs: [
        "企业制度通常存在于 PDF、Excel、流程文档与管理规范中——但制度只有被执行，才能产生价值。",
        "OpenBot 将企业规则转化为可理解、可执行、可验证的智能逻辑。",
      ],
      subsections: [
        {
          id: "rule-engine",
          title: "Rule Engine｜企业规则执行引擎",
          paragraphs: ["数字员工能够自动完成以下闭环："],
          bullets: [
            "理解企业制度：解析制度文档、管理规范、业务流程与规则版本",
            "连接业务数据：例如销售奖金计算时，自动读取 CRM 销售数据、合同信息、回款与团队绩效",
            "执行业务判断：校验计算条件、匹配适用政策、识别异常情况",
            "输出可审计结果：每一次执行均提供数据来源、规则依据、计算过程与决策路径",
          ],
        },
        {
          title: "可追溯的决策过程",
          paragraphs: ["企业可以清晰知道：「为什么得到这个结果。」"],
        },
      ],
      valueTitle: "产品价值",
      valueText: "OpenBot 让企业制度从静态文档变成动态执行逻辑，让规则真正进入业务流程。",
    },
    {
      id: "autopilot",
      title: "3. 企业运营自动驾驶",
      tagline: "企业运营，不再依赖人工盯守",
      paragraphs: [
        "企业运营涉及大量重复性工作：内容生产、渠道管理、数据分析与策略调整。",
        "OpenBot 让数字员工具备持续运营能力，实现企业业务流程自动驾驶。",
      ],
      subsections: [
        {
          id: "autonomous",
          title: "Autonomous Operation｜企业运营自动驾驶",
          paragraphs: ["数字员工可连接企业业务系统，执行完整运营闭环。以新媒体运营为例："],
          bullets: [
            "账号连接：企业授权微信公众号、抖音、知乎等内容平台，数字员工获得明确执行权限",
            "内容自动执行：生成运营内容、发布内容、管理发布时间、调整内容策略",
            "数据持续分析：自动监控阅读数据、用户反馈、传播效果与内容表现",
            "策略动态优化：根据运营结果调整内容方向、优化发布策略、生成运营建议",
            "自动生成运营报告：输出日报、周报、数据分析与优化建议",
            "全程可治理：所有执行过程支持审计、回溯与撤销",
          ],
        },
      ],
      valueTitle: "产品价值",
      valueText: "OpenBot 让企业运营从「人工驱动」进入「智能自动驾驶」模式。",
    },
    {
      id: "governance",
      title: "4. 企业 AI 控制与安全治理",
      tagline: "AI 不是自由行动者，而是可治理的企业执行主体",
      paragraphs: [
        "企业引入 AI 的核心挑战往往不是能力不足，而是：谁在执行？执行了什么？使用了哪些数据？是否符合企业规则？",
        "OpenBot 为每一个数字员工建立完整治理体系。",
      ],
      subsections: [
        {
          id: "identity",
          title: "AI Identity｜数字员工身份体系",
          bullets: [
            "每个数字员工拥有唯一身份标识、所属组织、责任边界与工作范围",
            "企业可以明确：「这个 AI 是谁，它负责什么。」",
          ],
        },
        {
          id: "policy",
          title: "Policy Control｜权限策略管理",
          bullets: [
            "定义可访问数据范围、可执行任务范围、可调用系统范围与可操作账号范围",
            "确保 AI 在企业边界内工作",
          ],
        },
        {
          id: "audit-system",
          title: "Audit System｜全链路审计体系",
          bullets: [
            "自动记录数据访问、任务执行、决策过程与系统调用",
            "企业可随时查看执行历史、回溯操作过程、分析决策依据",
          ],
        },
        {
          id: "control",
          title: "Enterprise Control｜企业控制能力",
          bullets: ["冻结数字员工", "回收权限", "停止任务执行", "撤销操作授权", "审计数据访问"],
        },
      ],
      valueTitle: "产品价值",
      valueText: "OpenBot 不只是 AI 工具，而是一套面向企业的可治理 AI 执行系统。",
    },
  ],
  summaryTitle: "OpenBot 企业 AI 组织能力总结",
  summaryTable: {
    headers: ["能力模块", "解决问题", "企业价值"],
    rows: [
      ["数字员工生命周期管理", "人员流失导致能力消失", "AI 能力成为企业资产"],
      ["企业规则执行引擎", "制度依赖人工理解", "制度自动转化为执行逻辑"],
      ["企业运营自动驾驶", "运营依赖人工持续管理", "业务流程持续自动运行"],
      ["AI 治理与控制体系", "AI 使用缺乏边界", "AI 可控、可审计、可管理"],
    ],
  },
  closing: "让 AI 从个人助手，升级为企业可拥有、可继承、可执行、可治理的数字员工体系。",
};

const EN: FeaturesDocument = {
  kicker: "Product",
  title: "Product Features",
  subtitle: "OpenBot enterprise digital employee management and execution",
  intro: [
    "Give your organization AI labor that can be inherited, executed, and governed.",
    "Traditional AI tools help individuals finish tasks. OpenBot reshapes how AI fits in the enterprise—digital employees are managed assets, not disposable chat assistants.",
    "Lifecycle management, rule execution, autonomous operations, and AI governance help you build the next generation of intelligent organizations.",
  ],
  sections: [
    {
      id: "lifecycle",
      title: "1. Digital employee lifecycle",
      tagline: "People leave; digital employees stay",
      paragraphs: [
        "The hidden cost of turnover is not just headcount—it is the experience, workflows, and capabilities people built over time.",
        "OpenBot treats digital employees as long-term enterprise assets so AI capability compounds instead of resetting.",
      ],
      subsections: [
        {
          id: "custody",
          title: "Enterprise asset-grade management",
          paragraphs: [
            "When an employee leaves, their digital employees enter Enterprise Custody Mode and assets transfer to the company:",
          ],
          assetCards: [
            {
              id: "memory",
              title: "Memory",
              subtitle: "Working memory",
              bullets: ["Context", "Decision history", "Communications", "Execution preferences"],
            },
            {
              id: "knowledge",
              title: "Knowledge",
              subtitle: "Enterprise knowledge",
              bullets: ["Knowledge bases", "Documents", "Domain expertise", "Playbooks"],
            },
            {
              id: "skills",
              title: "Skills",
              subtitle: "Capability assets",
              bullets: ["Configured skills", "Automations", "Task execution", "Work modules"],
            },
            {
              id: "accounts",
              title: "Accounts",
              subtitle: "Execution permissions",
              bullets: ["System accounts", "Third-party access", "Data scope"],
            },
            {
              id: "audit",
              title: "Audit Trail",
              subtitle: "Operational audit",
              bullets: ["Execution traces", "Data access", "Decision paths", "Action logs"],
            },
          ],
        },
        {
          title: "One-click handoff for new hires",
          bullets: [
            "Inherit digital employees in one step",
            "Restore full working context",
            "Continue existing capabilities",
            "No retraining from scratch",
          ],
        },
      ],
      valueTitle: "Value",
      valueText:
        "Turnover no longer erases capability—digital employees become durable intelligent assets.",
    },
    {
      id: "rules",
      title: "2. Automated policy execution",
      tagline: "Policies that run, not documents that sit",
      paragraphs: [
        "Policies live in PDFs, spreadsheets, and process docs—but value appears only when rules are executed.",
        "OpenBot turns enterprise rules into understandable, executable, verifiable logic.",
      ],
      subsections: [
        {
          id: "rule-engine",
          title: "Rule Engine",
          paragraphs: ["Digital employees close the loop automatically:"],
          bullets: [
            "Understand policies: parse documents, standards, workflows, and rule versions",
            "Connect business data: e.g. read CRM, contracts, collections, and team metrics for commission runs",
            "Execute judgments: validate conditions, match policies, detect exceptions",
            "Produce auditable output: data sources, rule basis, calculation steps, and decision paths",
          ],
        },
        {
          title: "Explainable outcomes",
          paragraphs: ["Leaders can always answer: “Why this result?”"],
        },
      ],
      valueTitle: "Value",
      valueText: "Move policies from static files into live business logic.",
    },
    {
      id: "autopilot",
      title: "3. Autonomous operations",
      tagline: "Operations without constant manual babysitting",
      paragraphs: [
        "Operations teams repeat content production, channel management, analytics, and strategy tweaks.",
        "OpenBot gives digital employees sustained operational capacity—autopilot for business workflows.",
      ],
      subsections: [
        {
          id: "autonomous",
          title: "Autonomous Operation",
          paragraphs: [
            "Digital employees connect to business systems and run full loops—for example, social media:",
          ],
          bullets: [
            "Connect accounts: WeChat, Douyin, Zhihu, and CMS platforms with explicit scopes",
            "Execute content: generate, publish, schedule, and adjust strategy",
            "Analyze continuously: reads, feedback, reach, and content performance",
            "Optimize dynamically: refine direction, publishing cadence, and recommendations",
            "Report automatically: daily/weekly summaries, analytics, and improvement notes",
            "Stay governable: audit, replay, and rollback supported end to end",
          ],
        },
      ],
      valueTitle: "Value",
      valueText: "Shift operations from human-driven to intelligently autonomous.",
    },
    {
      id: "governance",
      title: "4. AI control and security governance",
      tagline: "Governed executors, not free agents",
      paragraphs: [
        "The enterprise question is rarely “Can AI do it?”—it is who executed, what data was used, and whether rules were followed.",
        "OpenBot builds governance into every digital employee.",
      ],
      subsections: [
        {
          id: "identity",
          title: "AI Identity",
          bullets: [
            "Unique identity, org ownership, responsibility boundaries, and scope",
            "Clear answers to “Who is this AI and what does it own?”",
          ],
        },
        {
          id: "policy",
          title: "Policy Control",
          bullets: [
            "Define data, task, system, and account boundaries",
            "Keep AI work inside enterprise guardrails",
          ],
        },
        {
          id: "audit-system",
          title: "Audit System",
          bullets: [
            "Log data access, tasks, decisions, and system calls",
            "Review history, replay actions, and analyze rationale anytime",
          ],
        },
        {
          id: "control",
          title: "Enterprise Control",
          bullets: [
            "Freeze digital employees",
            "Revoke permissions",
            "Stop running tasks",
            "Withdraw authorizations",
            "Audit data access",
          ],
        },
      ],
      valueTitle: "Value",
      valueText: "Not just an AI tool—a governable enterprise execution system.",
    },
  ],
  summaryTitle: "OpenBot enterprise AI capabilities at a glance",
  summaryTable: {
    headers: ["Module", "Problem solved", "Enterprise value"],
    rows: [
      ["Lifecycle management", "Capability lost when people leave", "AI becomes durable assets"],
      ["Rule execution engine", "Policies need human interpretation", "Policies run in workflows"],
      [
        "Autonomous operations",
        "Ops needs constant manual oversight",
        "Business loops run continuously",
      ],
      ["AI governance", "AI lacks boundaries", "Controllable, auditable, manageable AI"],
    ],
  },
  closing:
    "Upgrade AI from personal assistants to digital employees your enterprise can own, inherit, execute, and govern.",
};

export function getPublicFeaturesDocument(locale: Locale): FeaturesDocument {
  return locale === "zh-CN" ? ZH : EN;
}
