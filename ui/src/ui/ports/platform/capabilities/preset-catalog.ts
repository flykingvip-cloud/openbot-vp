// Preset capability catalog for the market tab.
// These are curated capabilities that appear immediately without searching,
// and are also used for local keyword matching (including Chinese).

export type PresetCapability = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  keywords: string[]; // Chinese + English keywords for local search
  source: "github" | "npm" | "builtin";
  sourceUrl?: string;
  author?: string;
  popular?: boolean;
};

export const PRESET_CAPABILITIES: PresetCapability[] = [
  // --- 文档与办公 ---
  {
    id: "ppt-generator",
    name: "PPT 生成",
    description: "基于文本内容自动生成演示文稿，支持大纲生成与排版",
    category: "办公",
    tags: ["文档", "演示"],
    keywords: ["ppt", "幻灯片", "演示文稿", "presentation", "slides", "powerpoint", "ppt制作"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  {
    id: "document-converter",
    name: "文档转换",
    description: "PDF / Word / PPT / Markdown 格式互转",
    category: "办公",
    tags: ["文档", "转换"],
    keywords: ["pdf", "word", "文档转换", "格式转换", "convert", "docx", "markdown"],
    source: "builtin",
    author: "openclaw",
  },
  {
    id: "spreadsheet-analysis",
    name: "表格分析",
    description: "Excel / CSV 数据分析、图表生成与数据清洗",
    category: "办公",
    tags: ["数据", "表格"],
    keywords: ["excel", "csv", "表格", "数据分析", "spreadsheet", "图表"],
    source: "builtin",
    author: "openclaw",
  },
  // --- 编程与开发 ---
  {
    id: "coding-agent",
    name: "编程助手",
    description: "代码生成、审阅、重构和调试建议",
    category: "开发",
    tags: ["编程", "代码"],
    keywords: ["代码", "编程", "code", "coding", "开发", "debug", "重构", "review"],
    source: "github",
    sourceUrl: "https://github.com/openclaw/skill-coding-agent",
    author: "openclaw",
    popular: true,
  },
  {
    id: "github-integration",
    name: "GitHub 集成",
    description: "Issue、PR、CI 操作与代码审阅自动化",
    category: "开发",
    tags: ["GitHub", "CI/CD"],
    keywords: ["github", "issue", "pr", "pull request", "ci", "代码审阅"],
    source: "github",
    sourceUrl: "https://github.com/openclaw/skill-github",
    author: "openclaw",
    popular: true,
  },
  {
    id: "database-query",
    name: "数据库查询",
    description: "自然语言转 SQL，支持 MySQL / PostgreSQL / SQLite",
    category: "开发",
    tags: ["数据库", "SQL"],
    keywords: ["数据库", "sql", "mysql", "postgres", "sqlite", "查询", "database"],
    source: "builtin",
    author: "openclaw",
  },
  // --- 知识与搜索 ---
  {
    id: "web-search",
    name: "联网搜索",
    description: "实时搜索互联网信息，获取最新内容",
    category: "搜索",
    tags: ["搜索", "联网"],
    keywords: ["搜索", "联网", "search", "web", "互联网", "实时"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  {
    id: "rag-knowledge",
    name: "知识库问答",
    description: "基于文档构建知识库，支持精准问答与引用溯源",
    category: "知识",
    tags: ["RAG", "知识库"],
    keywords: ["知识库", "rag", "问答", "文档", "knowledge", "qa", "检索"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  {
    id: "arxiv-reader",
    name: "论文阅读",
    description: "arXiv 论文检索、摘要提取与关键发现总结",
    category: "知识",
    tags: ["论文", "学术"],
    keywords: ["论文", "arxiv", "paper", "学术", "研究", "摘要"],
    source: "github",
    author: "openclaw",
  },
  // --- 图像与视觉 ---
  {
    id: "image-generation",
    name: "图片生成",
    description: "文本描述生成图片，支持多种风格",
    category: "视觉",
    tags: ["图片", "生成"],
    keywords: ["图片", "生成", "画图", "image", "绘画", "ai画", "dall-e", "midjourney"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  {
    id: "ocr-recognition",
    name: "OCR 文字识别",
    description: "图片、截图、扫描件中的文字提取与结构化",
    category: "视觉",
    tags: ["OCR", "识别"],
    keywords: ["ocr", "文字识别", "图片文字", "扫描", "截图", "提取"],
    source: "builtin",
    author: "openclaw",
  },
  {
    id: "image-understanding",
    name: "图片理解",
    description: "分析图片内容、场景识别与图文问答",
    category: "视觉",
    tags: ["视觉", "理解"],
    keywords: ["图片理解", "看图", "vision", "图片分析", "场景识别"],
    source: "builtin",
    author: "openclaw",
  },
  // --- 自动化与工作流 ---
  {
    id: "email-automation",
    name: "邮件自动化",
    description: "邮件撰写、回复建议与批量处理",
    category: "自动化",
    tags: ["邮件", "自动化"],
    keywords: ["邮件", "email", "自动回复", "撰写", "mail"],
    source: "builtin",
    author: "openclaw",
  },
  {
    id: "calendar-scheduler",
    name: "日程管理",
    description: "日历事件创建、冲突检测与智能排期",
    category: "自动化",
    tags: ["日历", "排期"],
    keywords: ["日历", "日程", "calendar", "排期", "会议", "schedule"],
    source: "github",
    sourceUrl: "https://github.com/openclaw/skill-calendar",
    author: "openclaw",
  },
  {
    id: "workflow-builder",
    name: "工作流编排",
    description: "可视化构建多步骤自动化工作流",
    category: "自动化",
    tags: ["工作流", "编排"],
    keywords: ["工作流", "workflow", "自动化", "编排", "流程"],
    source: "builtin",
    author: "openclaw",
  },
  // --- 翻译与语言 ---
  {
    id: "translation",
    name: "多语言翻译",
    description: "支持 100+ 语言互译，保持语境与风格",
    category: "语言",
    tags: ["翻译", "多语言"],
    keywords: ["翻译", "translate", "多语言", "英语", "中文", "日语", "韩语"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  {
    id: "writing-assistant",
    name: "写作助手",
    description: "文章润色、改写、扩写与风格调整",
    category: "语言",
    tags: ["写作", "润色"],
    keywords: ["写作", "润色", "改写", "writing", "文章", "文案", "copywriting"],
    source: "builtin",
    author: "openclaw",
    popular: true,
  },
  // --- 数据与分析 ---
  {
    id: "data-visualization",
    name: "数据可视化",
    description: "将数据转化为图表、仪表盘与报告",
    category: "数据",
    tags: ["可视化", "图表"],
    keywords: ["可视化", "图表", "chart", "dashboard", "报表", "数据展示"],
    source: "builtin",
    author: "openclaw",
  },
  {
    id: "weather-info",
    name: "天气查询",
    description: "获取实时天气与未来预报信息",
    category: "生活",
    tags: ["天气", "查询"],
    keywords: ["天气", "weather", "预报", "温度", "forecast"],
    source: "github",
    sourceUrl: "https://github.com/openclaw/skill-weather",
    author: "openclaw",
  },
  // --- 安全与运维 ---
  {
    id: "security-scan",
    name: "安全扫描",
    description: "代码漏洞检测、依赖审计与安全建议",
    category: "安全",
    tags: ["安全", "扫描"],
    keywords: ["安全", "漏洞", "security", "scan", "审计", "vulnerability"],
    source: "builtin",
    author: "openclaw",
  },
  {
    id: "server-monitor",
    name: "服务器监控",
    description: "主机健康检查、资源监控与告警",
    category: "运维",
    tags: ["监控", "运维"],
    keywords: ["监控", "服务器", "monitor", "运维", "健康检查", "告警"],
    source: "github",
    author: "openclaw",
  },
  // --- 集成与连接 ---
  {
    id: "notion-integration",
    name: "Notion 集成",
    description: "读写 Notion 页面、数据库与评论",
    category: "集成",
    tags: ["Notion", "笔记"],
    keywords: ["notion", "笔记", "wiki", "文档管理"],
    source: "npm",
    author: "openclaw",
  },
  {
    id: "slack-integration",
    name: "Slack 集成",
    description: "发送消息、管理频道与自动化通知",
    category: "集成",
    tags: ["Slack", "通讯"],
    keywords: ["slack", "消息", "通知", "频道", "协作"],
    source: "npm",
    author: "openclaw",
  },
  {
    id: "feishu-integration",
    name: "飞书集成",
    description: "飞书消息、文档、日历与审批操作",
    category: "集成",
    tags: ["飞书", "协作"],
    keywords: ["飞书", "feishu", "lark", "消息", "审批", "文档"],
    source: "builtin",
    author: "openclaw",
  },
];

/**
 * Search the preset catalog by keyword (supports Chinese and English).
 * Returns matching capabilities sorted by relevance.
 */
export function searchPresetCatalog(keyword: string): PresetCapability[] {
  const query = keyword.trim().toLowerCase();
  if (!query) {
    // Return popular items when no search query
    return PRESET_CAPABILITIES.filter((c) => c.popular);
  }

  type Scored = { capability: PresetCapability; score: number };
  const scored: Scored[] = [];

  for (const capability of PRESET_CAPABILITIES) {
    let score = 0;

    // Exact name match
    if (capability.name.toLowerCase().includes(query)) {
      score += 10;
    }

    // Keyword match
    for (const kw of capability.keywords) {
      if (kw.toLowerCase().includes(query) || query.includes(kw.toLowerCase())) {
        score += 5;
      }
    }

    // Description match
    if (capability.description.toLowerCase().includes(query)) {
      score += 3;
    }

    // Category/tag match
    if (capability.category.toLowerCase().includes(query)) {
      score += 2;
    }
    for (const tag of capability.tags) {
      if (tag.toLowerCase().includes(query)) {
        score += 2;
      }
    }

    // Popular boost
    if (capability.popular && score > 0) {
      score += 1;
    }

    if (score > 0) {
      scored.push({ capability, score });
    }
  }

  return scored.toSorted((a, b) => b.score - a.score).map((s) => s.capability);
}
