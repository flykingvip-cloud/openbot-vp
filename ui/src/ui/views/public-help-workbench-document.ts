import type { Locale } from "../../i18n/index.ts";
import type { PrivacySection } from "./public-privacy-document.ts";

export const WORKBENCH_HELP_CHILD_IDS = [
  "login-and-shell",
  "assistant",
  "collaboration",
  "tasks",
  "knowledge",
  "settings",
  "anti-hallucination",
] as const;

export type WorkbenchHelpChildId = (typeof WORKBENCH_HELP_CHILD_IDS)[number];
export type WorkbenchHelpPageId = "index" | WorkbenchHelpChildId;

export type WorkbenchHelpCard = {
  slug: WorkbenchHelpPageId;
  label: string;
  href: string;
  summary: string;
};

export type WorkbenchHelpDocument = {
  page: WorkbenchHelpPageId;
  kicker: string;
  title: string;
  subtitle: string;
  backLabel: string;
  mapLabel?: string;
  mapHref?: string;
  childLinks?: WorkbenchHelpCard[];
  sections: PrivacySection[];
};

const CHILD_SET = new Set<string>(WORKBENCH_HELP_CHILD_IDS);

export function isWorkbenchHelpChild(
  value: string | null | undefined,
): value is WorkbenchHelpChildId {
  return Boolean(value && CHILD_SET.has(value));
}

export function workbenchHelpHref(basePath: string, page: WorkbenchHelpPageId): string {
  const base = basePath.replace(/\/+$/u, "");
  return page === "index" ? `${base}/help/workbench` : `${base}/help/workbench/${page}`;
}

type PageCopy = {
  title: string;
  subtitle: string;
  sections: PrivacySection[];
};

function section(
  id: string,
  title: string,
  paragraphs: string[],
  extras?: Pick<PrivacySection, "bullets" | "table">,
): PrivacySection {
  return { id, title, paragraphs, ...extras };
}

const ZH_CARDS: Array<Omit<WorkbenchHelpCard, "href">> = [
  {
    slug: "index",
    label: "工作台总图",
    summary: "登录后的员工入口。不是企业控制台，也不是 18789 控制台。",
  },
  {
    slug: "login-and-shell",
    label: "登录与外壳",
    summary: "怎么打开 www.openbot.love，以及登录后侧栏、每日概览和输入框上见过的控件。",
  },
  {
    slug: "assistant",
    label: "AI 助手",
    summary: "打开已有助手，或用侧栏「AI 助手」旁的 + 新建数字员工。",
  },
  {
    slug: "collaboration",
    label: "协作空间",
    summary: "打开已有空间和成员管理。添加机器人是把已有助手加进空间，不是新建。",
  },
  {
    slug: "tasks",
    label: "我的任务",
    summary: "定时任务、待我处理、开发监督。新建任务只写到「+ 新建任务」。",
  },
  {
    slug: "knowledge",
    label: "知识宇宙",
    summary: "搜索、空间、数字能力、我的资产、知识治理。",
  },
  {
    slug: "settings",
    label: "系统设置与个人设置",
    summary: "侧栏「系统设置」和头像菜单「个人设置」是两个入口。",
  },
  {
    slug: "anti-hallucination",
    label: "不要编造",
    summary: "十个常见问题只按登录后屏幕上出现的控件作答。",
  },
];

const EN_CARDS: Array<Omit<WorkbenchHelpCard, "href">> = [
  {
    slug: "index",
    label: "Workbench map",
    summary: "Logged-in employee home. Not the enterprise console and not port 18789.",
  },
  {
    slug: "login-and-shell",
    label: "Login and shell",
    summary: "How to open www.openbot.love and which shell controls were on screen.",
  },
  {
    slug: "assistant",
    label: "AI assistant",
    summary: "Open a named assistant, or create one from the sidebar plus.",
  },
  {
    slug: "collaboration",
    label: "Collaboration spaces",
    summary: "Open a space and its member panel. Adding a robot there does not create one.",
  },
  {
    slug: "tasks",
    label: "My tasks",
    summary: "Cron, assigned work, and the supervisor checklist.",
  },
  {
    slug: "knowledge",
    label: "Knowledge universe",
    summary: "Search, spaces, capabilities, assets, and governance.",
  },
  {
    slug: "settings",
    label: "Settings",
    summary: "Sidebar system settings and the avatar personal-settings menu are different pages.",
  },
  {
    slug: "anti-hallucination",
    label: "What not to invent",
    summary: "Ten common questions answered only from controls on the logged-in screen.",
  },
];

export function getWorkbenchHelpCards(locale: Locale, basePath = ""): WorkbenchHelpCard[] {
  const cards = locale === "zh-CN" ? ZH_CARDS : EN_CARDS;
  return cards.map((card) => ({ ...card, href: workbenchHelpHref(basePath, card.slug) }));
}

const ZH: Record<WorkbenchHelpPageId, PageCopy> = {
  index: {
    title: "员工工作台",
    subtitle: "用户入口是 https://www.openbot.love/ 。那一页就是员工工作台。",
    sections: [
      section("what", "这是什么", [
        "它不是企业控制台，也不是 18789 端口上的 Gateway 控制台。",
        "下面各篇只写登录后员工工作台上会出现的控件。席位还有创建名额时，「AI 助手」旁会有 +（无障碍名称 add AI 助手），标题是「新建数字员工」。",
      ]),
      section("how", "怎么用这些页", [
        "从帮助中心打开「员工工作台」，再按模块点进去。登录后也可以从右上角头像菜单打开帮助中心。",
      ]),
    ],
  },
  "login-and-shell": {
    title: "登录与外壳",
    subtitle: "在 https://www.openbot.love/ 用员工账号登录后看到的外壳。网关连上时如下所述。",
    sections: [
      section("what", "这是什么", ["公开的员工入口。登录后主舞台是「每日概览」加上当前对话。"]),
      section("enter", "怎么进入", [
        "打开 https://www.openbot.love/ 。",
        "未登录时标题是「面向团队的 AI 工作台」。顶部有「首页」和「企业登录」。只有用户要进企业控制台时才点「企业登录」。",
        "右侧卡片默认是「注册」。字段是「用户名称」「注册邮箱」「邀请码核验」「登录密码」。「去登录 →」切到登录。",
        "登录字段是「邮箱」（占位 name@company.com）和「登录密码」（提示至少 8 位）。按钮下方是「忘记密码？」和「登录遇到问题？」。这张登录卡上没有验证码框。",
      ]),
      section("after", "登录后的屏幕", ["侧栏当时已经展开。若只剩图标，按「展开侧边栏」。"], {
        bullets: [
          "分组：AI 助手（席位还有创建名额时，组标题右侧有 +；自建满 4 个后隐藏。大白管家不计入这 4 个）和协作空间（有 +，以及已有空间名）。",
          "其下模块：我的任务、知识宇宙、系统设置。",
          "右上：语言、主题、头像菜单。菜单项是「个人设置」「帮助中心」「退出登录」。",
          "舞台标题：每日概览。",
          "日程管理和待办事项可以有真实行。屏幕上没有空态句时，不要说它们是空的。",
          "对话头跟随当前对象，例如「TO: 大白管家」或某个空间名。不总是「TO: AI 助手」。",
        ],
      }),
      section("composer", "已连接时的输入框", [
        "输入框旁：可展开的「知识库」「选择文件」「添加附件」、语音、「发送」。网关连上时这些是可用的。",
      ]),
      section("first-run", "首次卡片", [
        "打开「大白管家」可能出现「你好，我是大白，你的专属工作助手。」按钮是「开始引导」「稍后处理」「我知道了」。",
      ]),
      section("dont", "不要编造", [
        "没有「机器人管理」「技能管理」或「返回控制台」。",
        "横幅「正在连接网关…」或「正在重新连接网关…」只是连接过程，不要说网关已经断了。横幅「网关无法连接。」并有「重新连接」时，才说网关连不上。只有横幅是「已断开与网关的连接。」且占位是「请先连接网关后再开始聊天…」时，才用认证或配对失败的说法。",
      ]),
    ],
  },
  assistant: {
    title: "AI 助手",
    subtitle:
      "在 https://www.openbot.love/ 核对过聊天，以及名额已满时 + 被藏起的情况。创建表单是同一工作台、+ 还在时打开过的。",
    sections: [
      section("what", "这是什么", ["侧栏里的助手列表、聊天舞台，以及新建数字员工的表单。"]),
      section("enter", "怎么进入", [
        "展开侧栏，分组名是「AI 助手」。点用户点名的那个助手。打开「大白管家」后，头变成「TO: 大白管家」。",
        "要新增机器人，用这一组标题右侧的 +。见下一节。",
      ]),
      section(
        "add",
        "添加机器人",
        [
          "这是新建助手。它不是协作空间里「成员管理」→「添加机器人」。后者只把已有机器人加进空间。",
          "若 + 不在，就说创建名额已满。不要再编一个创建菜单。",
          "让大白管家「加一个机器人」只是指路：把用户带到这个 +。没有核实过大白能在后台直接建好。席位已满时仍然不能再加。",
        ],
        {
          bullets: [
            "展开侧栏，找到「AI 助手」。",
            "按组标题右侧的 +。无障碍名称是 add AI 助手。",
            "页标题变成「新建数字员工」。",
            "自建助手已有 4 个时 + 隐藏（大白管家不计数）。「系统设置」→「我的机器人」里也没有「新建」。",
          ],
        },
      ),
      section(
        "form",
        "创建表单",
        [
          "标题是「新建数字员工」。没有用户确认，不要按「创建机器人」。创建成功后，新名字应出现在「AI 助手」下。",
        ],
        {
          table: {
            headers: ["控件", "作用", "风险"],
            rows: [
              ["你想要什么样的数字员工", "自由简述。", "只写草稿"],
              ["生成设计", "按简述生成设计。简述为空时不可用。", "中"],
              ["机器人名称", "名称。占位「例如：市场分析助手」。", "中"],
              ["头像设置", "可选。", "低"],
              ["角色模板", "起始能力包。可能显示「暂无可用模板」。", "只读"],
              [
                "工作空间",
                "云端席位可以写「由 OpenBot 自动管理」。本地席位可能要在「个人设置」填工作空间根目录。",
                "中",
              ],
              ["取消", "不创建就离开。", "低"],
              ["创建机器人", "写入机器人。先确认。名称和工作空间未就绪时不可用。", "高"],
            ],
          },
        },
      ),
      section("chat", "当时在屏上的聊天控件", [], {
        table: {
          headers: ["控件", "作用", "风险"],
          rows: [
            ["开始引导 / 稍后处理 / 我知道了", "大白引导卡。「我知道了」关掉它。", "低"],
            ["知识库", "在输入框旁展开。内容没有全部打开。", "只读"],
            ["选择文件 / 添加附件", "加附件。", "中"],
            ["语音", "语音输入。", "低"],
            ["发送", "发送草稿。网关连上时可用。", "中"],
            ["复制 / 引用此前回复", "在已有消息上。", "低"],
            ["打开成果", "出现在部分消息上。成果页本身没有打开。", "只读"],
          ],
        },
      }),
      section("missing", "屏上没有", [
        "机器人上的「进入工作区」回到每日概览聊天。它不会打开名为「概览」「任务」「成果」「工作区」「技能」或「记忆」的标签页。",
      ]),
    ],
  },
  collaboration: {
    title: "协作空间",
    subtitle: "登录后打开过已有协作空间和它的「成员管理」。",
    sections: [
      section("what", "这是什么", ["侧栏里已有的空间，加上成员面板。这一遍没有重新打开创建向导。"]),
      section("enter", "怎么进入", [
        "侧栏「协作空间」。这一组有 +。点这个账号已有的空间名，不要说列表是空的。",
        "点空间名后，头会变成「TO:」加上该空间名。人和机器人出现在舞台上。",
      ]),
      section(
        "members",
        "成员面板",
        [
          "按钮是「成员管理」。标题是「成员管理——」加上空间名。成员和机器人数量以标题为准。",
          "待处理邀请可以读到「已发送邀请」和「待主人确认」。",
        ],
        {
          table: {
            headers: ["控件", "作用", "风险"],
            rows: [
              ["添加成员", "打开加人。没有提交。", "中"],
              [
                "添加机器人",
                "把已有机器人加进这个空间。没有提交。不是侧栏「AI 助手」那个用来新建的 +。",
                "中",
              ],
              ["移交管理权", "在非所有者的人身上。没有按。", "高"],
              ["移除", "在人或机器人上。没有按。", "高"],
              ["AI 协助调整（可选）", "可选辅助块。没有用。", "低"],
            ],
          },
        },
      ),
      section("missing", "屏上没有", [
        "没有名为「概览」「聊天」「治理」或「胶囊」的标签条。不要描述那些页。",
        "这一遍没有重新打开 + 的向导。用户要新建空间时，先确认标题是「新建协作空间」，再报字段名。",
      ]),
    ],
  },
  tasks: {
    title: "我的任务",
    subtitle:
      "登录后，定时任务列表和开发监督清单在屏上。第一个按钮之后的新建向导先让用户读下一屏。",
    sections: [
      section("what", "这是什么", ["侧栏一个入口下的三个标签。"]),
      section("enter", "怎么进入", [
        "侧栏「我的任务」。标签是「定时任务」「待我处理」「开发监督」。",
      ]),
      section("cron", "定时任务", [
        "列表上方会显示总任务、待执行、执行中、已完成、异常。以屏幕上的数字为准，不要说列表是空的。",
        "见过的操作：「任务模板」「批量操作」「+ 新建任务」。",
        "有任务时会看到执行人、重复时间和状态。不要把页面源码里的 HTML 注释或知识 id 读给用户。",
        "「+ 新建任务」是创建按钮。后面的向导字段先让用户读下一屏标题，再报字段名。",
      ]),
      section("assigned", "待我处理", [
        "这一遍是空的。文案是「会议与协作指派给你的任务」和「暂无指派给你的任务。会议纪要分发后，行动项会出现在这里。」",
        "若出现行，用那些行，不要再用这句空态。",
      ]),
      section("supervisor", "开发监督", ["这一遍是环境清单，不是缺席位页。"], {
        bullets: [
          "「环境准备」会显示就绪进度，例如「n/10 就绪」。",
          "「监督子系统」可以是「就绪」。",
          "Node 和 CLI 行显示「待处理」「待探测」或「待配置」。",
          "按钮：「申请连接本机 Node」「刷新状态」。",
          "文案要求打开 Mac OpenBot 并保持 Node 模式在线，并写明不要手填租户或席位信息。",
          "屏上还有「高级信息（排障用）」「本机 CLI 状态」「配置 API KEY」「添加 KEY」。",
        ],
      }),
      section("dont", "不要做的事", [
        "不要让用户把 API key 贴进聊天。",
        "除非屏幕上真有「尚未生效企业岗位」或 operator.write，否则不要说这个标签被它们挡住。",
      ]),
    ],
  },
  knowledge: {
    title: "知识宇宙",
    subtitle: "登录后打开过首页、一个空间焦点、「数字能力」「我的资产」和「知识治理」。",
    sections: [
      section("what", "这是什么", ["搜索、空间、关系面板，以及顶部操作打开的页。"]),
      section("enter", "怎么进入", ["侧栏「知识宇宙」。"]),
      section("home", "首页", [
        "操作：「搜索」「上传知识」「数字能力」「我的资产」「知识治理」。",
        "左栏有「收藏」「个人空间」「团队空间」「企业空间」，加载后有真实空间。首屏可能闪一下 0。不要按那一闪来指路，也不要复述私人文档标题。",
        "点空间名会聚焦右侧（「关系洞察」/「文档预览」）。「个人成果」显示「该知识空间暂无文档」，面板标题就是该空间名。没有出现带「文档 / 片段 / 数据集 / 回收站」的库壳。",
        "「上传知识」没有重新打开。先确认下一屏标题，再报创建字段。",
      ]),
      section("capabilities", "数字能力", [
        "有「数据能力空间」和「已授权能力」。",
        "「企业知识检索」是「已授权」，带「知识库索引」和「预览检索」。其他卡片标了「示例」和「审批中」，文案是「已提交申请，等待企业管理员审批」。不要把已授权能力说成空的。",
        "若按钮不在，先按「返回知识宇宙」。",
      ]),
      section("assets", "我的资产", [
        "分段：「全部」「草稿」「审核中」「已入企业」「需优化」。计数以屏幕为准。",
        "下面还可以有「整理建议」「可整理的工作模式」，以及「暂不处理」和「整理为草稿」。不要说这一页只是空的安装列表。",
      ]),
      section("governance", "知识治理", [
        "副标题：「重复与冲突问题流，人工确认后影响检索排序」。",
        "按钮：「刷新」。这次范围是「个人成果」，「待处理问题：0 个」，还有「去沉淀知识」。「治理 LLM 用量」写的是「本期尚未产生治理 LLM 调用」。",
        "首页关系冲突和这个范围内的计数不是一回事。不要用一个覆盖另一个。",
      ]),
    ],
  },
  settings: {
    title: "系统设置与个人设置",
    subtitle: "登录后看过。「安全与隐私」上网关状态以屏幕为准。",
    sections: [
      section(
        "entrances",
        "两个入口",
        [
          "头像菜单里还有「帮助中心」和「退出登录」。用户没要求退出时不要按。没有名为「机器人管理」或「技能管理」的侧栏项。",
        ],
        {
          table: {
            headers: ["要做的事", "入口"],
            rows: [
              ["安全、设备、机器人、小组、模型", "侧栏「系统设置」"],
              ["账号、授权、备份", "头像菜单「个人设置」"],
            ],
          },
        },
      ),
      section("system-tabs", "系统设置的标签", [
        "「安全与隐私」「我的设备」「我的机器人」「我的协作小组」「AI 模型」。",
      ]),
      section("security", "安全与隐私", [
        "数据空间：「就绪」/「云端托管」。",
        "文案：「您的数据存储在 OpenBot 云端，由平台加密托管。员工端不提供目录浏览或路径配置。」导出或迁移指向管理员或 Mac 客户端。不要让这个账号去浏览 ~/OpenBot。",
        "网关可以显示「正常」。屏幕没说离线就不要说离线。",
      ]),
      section(
        "robots",
        "我的机器人",
        [
          "这个账号列出了可管理的机器人，每个有「进入工作区」。没有「新建」。",
          "打开「大白管家」。屏上的标签是「身份」「能力」「成长」「运营授权」「协作」「数据」。没有「危险」标签。",
          "「进入工作区」回到每日概览聊天，不会打开第二套工作台。",
        ],
        {
          bullets: [
            "身份：名称、定位、角色、人格、模型。",
            "能力：已安装 / 探索能力。",
            "成长：能力、绩效、建议的百分比；输出格式、汇报节奏、决策方式。",
            "运营授权：企业身份和个人身份，「添加身份」。",
            "协作可以写「尚未参与协作小组。」",
            "数据：记忆、长期记忆、知识库、工作空间。",
          ],
        },
      ),
      section("not-opened", "这一遍没点开", [
        "「我的设备」「我的协作小组」「AI 模型」在这次登录走查里没有点开。不要拿断线本地空态去描述它们。",
      ]),
      section("personal-tabs", "个人设置的标签", [
        "「账号」「授权」「偏好」「安全」「数据与备份」。",
      ]),
      section("account", "账号", [
        "「账号信息」「个人资料」「显示名称」「个人说明」「企业与岗位」「所属企业」「当前岗位」「岗位状态」「默认机器人」「机器人团队」「默认协作小组」。",
        "已绑定席位可以显示「正常」和「在岗」。屏幕上没有「未绑定」就不要这么说。",
      ]),
      section("auth", "授权", [
        "标题「绑定账户」。见过的提供方：微信公众号、微信个人号、个人邮箱、GitHub（个人）、哔哩哔哩、抖音、快手、微博、小红书、知乎、X。已配置的写「已配置」。",
        "计数：「身份」「已授权数字人」「待续期」「最近使用」，以及「刷新」。",
        "文案：「绑定后可在账号详情页把使用权授给旗下数字人。」不要在聊天里要密钥。",
      ]),
      section("backup", "数据与备份", [
        "选中「数据与备份」后只有标题，没有「导出备份」或「迁移数据位置」。不要编这两个按钮。",
        "「偏好」和「安全」没有重新打开。先让用户读那两个标签，再报控件名。",
      ]),
    ],
  },
  "anti-hallucination": {
    title: "不要编造",
    subtitle: "规则：走查里没出现的控件，不要让用户去按。",
    sections: [
      section("rules", "规则", [], {
        bullets: [
          "旧名字「机器人管理」「技能管理」「深色侧栏」「返回控制台」「Dashboard」都不是员工工作台入口。",
          "18789 不是员工首页。",
          "断线的本地壳不是生产默认。「正在重新连接网关…」不是整站断开。「网关无法连接。」加上「重新连接」才是网关连不上。只有横幅「已断开与网关的连接。」真的在屏上时才用认证失败那套说法。",
        ],
      }),
      section("ten", "十个问题", [], {
        bullets: [
          "怎么添加机器人？侧栏「AI 助手」的 +（add AI 助手），标题「新建数字员工」，再「创建机器人」。自建满 4 个后 + 隐藏（大白管家不计数）。「系统设置」→「我的机器人」没有创建按钮。问大白只是指路，不会在后台建好。「成员管理」→「添加机器人」是把已有机器人加进空间。",
          "知识宇宙在哪？侧栏「知识宇宙」。加载后才有空间列表。不要因为首屏闪 0 就说没有空间。",
          "怎么加定时任务？「我的任务」→「定时任务」→「+ 新建任务」。停在这个按钮。后面的向导没有重新打开。",
          "设置在哪？安全、设备、机器人、小组、模型在侧栏「系统设置」。账号在头像菜单「个人设置」。不是同一页。",
          "怎么把人加进协作空间？打开空间，按「成员管理」，再「添加成员」或「添加机器人」。这里的「添加机器人」只拉已有助手。新机器人仍从侧栏「AI 助手」的 + 开始。不要描述内部标签条。",
          "怎么登录？打开 https://www.openbot.love/ ，把卡片切到登录，填「邮箱」和「登录密码」。进员工工作台不要把人送到「企业登录」。",
          "聊天发不出去。重连中横幅是「正在重新连接网关…」，不要说已经断开。网关进程不在时横幅是「网关无法连接。」，按钮是「重新连接」。只有横幅是「已断开与网关的连接。」且占位是「请先连接网关后再开始聊天…」才用认证失败的说法。连上时「发送」是可用的。不要再编一个发送按钮。",
          "我的机器人在哪？「系统设置」→「我的机器人」。行可以是「可管理」，带「进入工作区」。见过的详情标签：身份、能力、成长、运营授权、协作、数据。没有「危险」。",
          "运营账号在哪绑？头像 →「个人设置」→「授权」，标题「绑定账户」。先看该提供方是否「已配置」。不要在聊天里要密钥。",
          "用户说机器人管理或技能管理。员工工作台没有这个菜单。机器人在「系统设置」→「我的机器人」。可安装资产计数可以是 0，同时「我的资产」仍有「整理建议」。",
        ],
      }),
    ],
  },
};

const EN: Record<WorkbenchHelpPageId, PageCopy> = {
  index: {
    title: "Employee workbench",
    subtitle: "The user entry is https://www.openbot.love/. That page is the employee workbench.",
    sections: [
      section("what", "What this is", [
        "It is not the enterprise console and not the Gateway control UI on port 18789.",
        "These pages name controls that appear after login. When the seat still has a create slot, AI 助手 shows a plus (add AI 助手) and the title 新建数字员工.",
      ]),
      section("how", "How to use these pages", [
        "Open Employee workbench from Help Center, then pick a module. After login, the avatar menu also opens Help Center.",
      ]),
    ],
  },
  "login-and-shell": {
    title: "Login and shell",
    subtitle:
      "Shell after an employee login at https://www.openbot.love/. The notes below assume the gateway is connected.",
    sections: [
      section("what", "What this is", [
        "Public employee entry. After login the stage is 每日概览 plus the current conversation.",
      ]),
      section("enter", "How to enter", [
        "Open https://www.openbot.love/.",
        "Logged-out title: 面向团队的 AI 工作台. Top links include 首页 and 企业登录. Use 企业登录 only for the enterprise console.",
        "The right card opens on 注册 with 用户名称, 注册邮箱, 邀请码核验, 登录密码. 去登录 → switches to login.",
        "Login fields are 邮箱 and 登录密码. Below: 忘记密码？ and 登录遇到问题？. No verification-code box.",
      ]),
      section(
        "after",
        "After login",
        ["The sidebar is usually expanded. If only icons remain, press 展开侧边栏."],
        {
          bullets: [
            "Sidebar groups: AI 助手 (plus hides after 4 self-created assistants; 大白管家 does not count) and 协作空间.",
            "Modules: 我的任务, 知识宇宙, 系统设置.",
            "Top right: 语言, 主题, avatar menu with 个人设置, 帮助中心, and 退出登录.",
            "Stage title 每日概览. Do not call 日程管理 or 待办事项 empty unless that sentence is on screen.",
            "Header follows the target, for example TO: 大白管家. It is not always TO: AI 助手.",
          ],
        },
      ),
      section("composer", "Composer when connected", [
        "Beside the input: expandable 知识库, 选择文件, 添加附件, voice, and 发送. These work when the gateway is connected.",
      ]),
      section("first-run", "First-run card", [
        "Opening 大白管家 may show 你好，我是大白，你的专属工作助手。 Buttons: 开始引导, 稍后处理, 我知道了.",
      ]),
      section("dont", "Do not invent", [
        "No 机器人管理, 技能管理, or 返回控制台.",
        "正在连接网关… and 正在重新连接网关… are in-progress connects. Say the gateway is unreachable only when the banner is 网关无法连接。 and the button is 重新连接. Use the auth-failure copy only when the banner is 已断开与网关的连接。 and the placeholder is 请先连接网关后再开始聊天….",
      ]),
    ],
  },
  assistant: {
    title: "AI assistant",
    subtitle:
      "Chat and the hidden plus were checked on the logged-in workbench. The create form opens from the plus while a seat remains.",
    sections: [
      section("what", "What this is", [
        "The sidebar assistant list, the chat stage, and the 新建数字员工 form.",
      ]),
      section("enter", "How to enter", [
        "Expand the sidebar, group name AI 助手. Open the named assistant. Opening 大白管家 sets the header to TO: 大白管家.",
        "To add a robot, use the plus on that group title. See the next section.",
      ]),
      section(
        "add",
        "Add a robot",
        [
          "This creates an assistant. It is not 成员管理 → 添加机器人, which only adds an existing robot to a space.",
          "If the plus is gone, say the create slots are full. Do not invent another create menu.",
          "Asking 大白管家 to add a robot only guides the user to this plus. It was not verified that Daibai can create one in the background.",
        ],
        {
          bullets: [
            "Expand the sidebar and find AI 助手.",
            "Press the plus on the group title. Accessible name: add AI 助手.",
            "The page title becomes 新建数字员工.",
            "The plus hides after 4 self-created assistants (大白管家 does not count). 系统设置 → 我的机器人 has no 新建.",
          ],
        },
      ),
      section(
        "form",
        "Create form",
        [
          "Title is 新建数字员工. Do not press 创建机器人 without the user confirming. After success, the new name should appear under AI 助手.",
        ],
        {
          table: {
            headers: ["Control", "Role", "Risk"],
            rows: [
              ["你想要什么样的数字员工", "Free-form brief.", "Draft only"],
              ["生成设计", "Builds a design from the brief. Disabled when empty.", "Medium"],
              ["机器人名称", "Name. Placeholder 例如：市场分析助手.", "Medium"],
              ["头像设置", "Optional.", "Low"],
              ["角色模板", "Starting capability pack. May show 暂无可用模板.", "Read-only"],
              [
                "工作空间",
                "Cloud seats may say 由 OpenBot 自动管理. Local seats may need a workspace root in 个人设置.",
                "Medium",
              ],
              ["取消", "Leave without creating.", "Low"],
              [
                "创建机器人",
                "Writes the robot. Confirm first. Disabled until name and workspace are ready.",
                "High",
              ],
            ],
          },
        },
      ),
      section("missing", "Not on screen", [
        "进入工作区 returns to the daily overview chat. It does not open tabs named 概览, 任务, 成果, 工作区, 技能, or 记忆.",
      ]),
    ],
  },
  collaboration: {
    title: "Collaboration spaces",
    subtitle: "An existing space and its 成员管理 panel were opened after login.",
    sections: [
      section("what", "What this is", [
        "Existing sidebar spaces plus the member panel. Confirm the create wizard title before naming fields.",
      ]),
      section("enter", "How to enter", [
        "Sidebar 协作空间 has a plus. Open a space already on this account. Do not say the list is empty.",
        "After opening a space, the header becomes TO: plus that space name.",
      ]),
      section(
        "members",
        "Member panel",
        [
          "Button is 成员管理. Title is 成员管理—— plus the space name. Read member and robot counts from that title.",
          "Pending invites can show 已发送邀请 and 待主人确认.",
        ],
        {
          table: {
            headers: ["Control", "Role", "Risk"],
            rows: [
              ["添加成员", "Opens add-person. Was not submitted.", "Medium"],
              [
                "添加机器人",
                "Adds an existing robot to this space. Not the sidebar create plus.",
                "Medium",
              ],
              ["移交管理权", "On a non-owner person. Was not pressed.", "High"],
              ["移除", "On a person or robot. Was not pressed.", "High"],
              ["AI 协助调整（可选）", "Optional assist block. Was not used.", "Low"],
            ],
          },
        },
      ),
      section("missing", "Not on screen", [
        "There is no tab strip named 概览, 聊天, 治理, or 胶囊.",
        "If the user wants a new space, confirm the title is 新建协作空间 before naming fields.",
      ]),
    ],
  },
  tasks: {
    title: "My tasks",
    subtitle:
      "The cron list and supervisor checklist are on screen. Confirm the next title before naming new-task wizard fields.",
    sections: [
      section("what", "What this is", ["Three tabs under one sidebar item."]),
      section("enter", "How to enter", ["Sidebar 我的任务. Tabs: 定时任务, 待我处理, 开发监督."]),
      section("cron", "Cron", [
        "The header shows 总任务, 待执行, 执行中, 已完成, 异常. Read the numbers on screen; do not say the list is empty.",
        "Actions seen: 任务模板, 批量操作, + 新建任务.",
        "+ 新建任务 is the create button. Ask the user to read the next title before naming wizard fields.",
      ]),
      section("assigned", "Assigned", [
        "Empty-state copy is 会议与协作指派给你的任务 and 暂无指派给你的任务。会议纪要分发后，行动项会出现在这里。",
        "If rows appear, use those rows instead of the empty sentence.",
      ]),
      section(
        "supervisor",
        "Supervisor",
        ["This tab is an environment checklist, not a missing-seat page."],
        {
          bullets: [
            "环境准备 shows readiness such as n/10 就绪.",
            "Buttons: 申请连接本机 Node, 刷新状态.",
            "Do not ask the user to paste an API key into chat.",
          ],
        },
      ),
    ],
  },
  knowledge: {
    title: "Knowledge universe",
    subtitle: "Home, a space focus, 数字能力, 我的资产, and 知识治理 were opened after login.",
    sections: [
      section("what", "What this is", [
        "Search, spaces, the relation panel, and pages opened from the top actions.",
      ]),
      section("enter", "How to enter", ["Sidebar 知识宇宙."]),
      section("home", "Home", [
        "Actions: 搜索, 上传知识, 数字能力, 我的资产, 知识治理.",
        "The left column has 收藏, 个人空间, 团队空间, 企业空间. Wait for spaces to load. Do not guide from a first-paint zero flash.",
        "Confirm the next title before naming 上传知识 fields.",
      ]),
      section("capabilities", "Capabilities", [
        "企业知识检索 can show 已授权. Other cards may say 审批中. Do not call authorized capabilities empty.",
      ]),
      section("assets", "Assets and governance", [
        "我的资产 can still show 整理建议 when segment counts are 0. Do not describe the page as an empty install list.",
        "知识治理 scope counts are not the same as home relation conflicts.",
      ]),
    ],
  },
  settings: {
    title: "Settings",
    subtitle: "Two different entrances. Read gateway status from 安全与隐私 on screen.",
    sections: [
      section(
        "entrances",
        "Two entrances",
        [
          "The avatar menu also has 帮助中心 and 退出登录. There is no sidebar item named 机器人管理 or 技能管理.",
        ],
        {
          table: {
            headers: ["Job", "Entrance"],
            rows: [
              ["Security, devices, robots, groups, models", "Sidebar 系统设置"],
              ["Account, authorization, backup", "Avatar menu 个人设置"],
            ],
          },
        },
      ),
      section("system-tabs", "System settings tabs", [
        "安全与隐私, 我的设备, 我的机器人, 我的协作小组, AI 模型.",
      ]),
      section("robots", "My robots", [
        "我的机器人 has 进入工作区 and no 新建. Detail tabs seen: 身份, 能力, 成长, 运营授权, 协作, 数据. No 危险 tab.",
        "进入工作区 returns to the daily overview chat.",
      ]),
      section("personal-tabs", "Personal settings tabs", ["账号, 授权, 偏好, 安全, 数据与备份."]),
      section("backup", "Backup", [
        "数据与备份 may show the heading only. Do not invent 导出备份 or 迁移数据位置.",
        "Confirm 偏好 and 安全 on screen before naming their controls.",
      ]),
    ],
  },
  "anti-hallucination": {
    title: "What not to invent",
    subtitle: "If a control is not on the logged-in screen, do not tell the user to press it.",
    sections: [
      section("rules", "Rules", [], {
        bullets: [
          "机器人管理, 技能管理, 深色侧栏, 返回控制台, and Dashboard are not employee-workbench entrances.",
          "Port 18789 is not the employee home.",
          "正在重新连接网关… is not a full disconnect. 网关无法连接。 plus 重新连接 means the gateway is unreachable. Use the auth-failure copy only when 已断开与网关的连接。 is on screen.",
        ],
      }),
      section("ten", "Ten questions", [], {
        bullets: [
          "Add a robot from sidebar AI 助手 plus (add AI 助手), title 新建数字员工, then 创建机器人. The plus hides after 4 self-created assistants. 系统设置 → 我的机器人 has no create button. 成员管理 → 添加机器人 only adds an existing robot to a space.",
          "知识宇宙 is the sidebar item. Wait for spaces to load. Do not say there are none because the first paint flashed 0.",
          "Add a cron from 我的任务 → 定时任务 → + 新建任务. Stop at that button until the next title is on screen.",
          "Settings split: security, devices, robots, groups, and models live in sidebar 系统设置. The account lives in avatar 个人设置.",
          "Add a person from a space → 成员管理 → 添加成员. 添加机器人 there is not the create plus.",
          "Login at https://www.openbot.love/, switch the card to login, fill 邮箱 and 登录密码. Do not send an employee to 企业登录.",
          "While reconnecting the banner is 正在重新连接网关…. When the gateway process is gone the banner is 网关无法连接。 and the button is 重新连接. Use the auth-failure copy only when the banner is 已断开与网关的连接。 and the placeholder is 请先连接网关后再开始聊天….",
          "Robots: 系统设置 → 我的机器人. Detail tabs: 身份, 能力, 成长, 运营授权, 协作, 数据. No 危险.",
          "Bind an ops account from avatar → 个人设置 → 授权, title 绑定账户. Do not ask for secrets in chat.",
          "If the user says 机器人管理 or 技能管理, the employee workbench has no such menu. Robots are under 系统设置 → 我的机器人.",
        ],
      }),
    ],
  },
};

export function getWorkbenchHelpDocument(
  locale: Locale,
  page: WorkbenchHelpPageId,
  basePath = "",
): WorkbenchHelpDocument {
  const copy = locale === "zh-CN" ? ZH[page] : EN[page];
  const zh = locale === "zh-CN";
  const childLinks =
    page === "index"
      ? getWorkbenchHelpCards(locale, basePath).filter((card) => card.slug !== "index")
      : undefined;
  return {
    page,
    kicker: zh ? "指南" : "Guide",
    title: copy.title,
    subtitle: copy.subtitle,
    backLabel: zh ? "返回帮助中心" : "Back to help",
    mapLabel: page === "index" ? undefined : zh ? "返回工作台总图" : "Back to workbench map",
    mapHref: page === "index" ? undefined : workbenchHelpHref(basePath, "index"),
    childLinks,
    sections: copy.sections,
  };
}
