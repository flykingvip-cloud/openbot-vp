# 意图 → 技能路由

本文件只做**分流**。细节以目标技能 `SKILL.md` 与 OpenBot `docs/tools/skills*.md` 为准。

**重叠政策：** 与已有 OpenBot 技能功能重叠时，**合并优势到一个名字**或只保留一个；禁止平行双份。优先扩展已有技能，不新增第二名。

## OpenBot 技能加载（摘要）

加载顺序（冲突时高者优先）：`<workspace>/skills` → `~/.openbot/skills` → 捆绑技能。可用 `openbot skills install|update|check`（见 `docs/tools/skills-cli.md`）。第三方技能当不可信代码对待。

## 平台自助（本技能）

| 用户说                                   | 技能                        |
| ---------------------------------------- | --------------------------- |
| 怎么用 OpenBot / Gateway / 工作台 / 设置 | **openbot-docs**（本技能）  |
| 建数字人、知识库、定时、身份授权         | `openbot-platform-ops`      |
| 找不到按钮、要人带路点 UI                | `user-guidance-protocol`    |
| 从 ClawHub 搜装技能                      | `openbot-skills`（clawhub） |

## 独立工作（服务器 / 本机 / 浏览器）

整条任务（选执行面 + 授权升级 + 验收）由 **`independent-work`** 编排。禁止平行引入 Box / Grok Bot 的 `browser`、`box-desktop`、`request_box_help` 技能名。

| 用户说                                 | 技能                       | 是否自动触发                        |
| -------------------------------------- | -------------------------- | ----------------------------------- |
| 独立工作 / 操作服务器 / 调用本机电脑   | **`independent-work`**     | 是                                  |
| 没有连接器也要登后台，做完再存桌面     | **`independent-work`**     | 是；扫码循环仍 `browser-scan-proxy` |
| 扫码登录 / 你打开网页我来扫 / 授权过期 | `browser-scan-proxy`       | 是                                  |
| Mac 窗口 / 屏幕 / Peekaboo             | `peekaboo`（经已连接节点） | 是                                  |
| 找不到按钮、带我点                     | `user-guidance-protocol`   | 否：用户自己点                      |

## 个人微信（硬规则）

| 用户说                                     | 技能                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| 个人微信怎么接 / 运营还是入库              | **`wechat-personal-catalog`（默认入口）**                |
| 扫码、授权数字人、sidecar `127.0.0.1:3000` | `wechat-personal-ops`                                    |
| 导出记录当知识库                           | `wechat-personal-kb`                                     |
| 明确点名 wechat-use / 本机已登录桥接       | 经 catalog 风险确认后才可选用 `wechat-use`（**非默认**） |
| 跨平台读本地库分析                         | 经 catalog 后可选 `wechat-cli`（**非默认**）             |

**禁止**在未分流时直接教 wechat-use 安装。

## 可视化与文档交付（keep / merge）

| 用户说                                | 保留技能                                            | 决策                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 看板 / 架构页 / Node `canvas.present` | **`canvas`**                                        | 保留；与 visualize 分工（板 vs 对话内探索）                                                                                                                         |
| 对话内仿真、可调参数、what-if         | **`visualize`**                                     | 已合并上游概念（#998）；不另起第二名                                                                                                                                |
| 自然语言改某一页 PDF                  | **`nano-pdf`**                                      | **keep**；Codex pack `pdf` 不平行入库——有用能力并入/扩展 nano-pdf                                                                                                   |
| OpenAI Images 批量出图+画廊           | **`openai-image-gen`**                              | **keep**；pack `imagegen` 不平行——优势并入本技能                                                                                                                    |
| 浏览器自动化                          | **`browser-scan-proxy`**（人扫码 + 隔离会话代操作） | **skip** pack `browser` 平行技能名；工具仍是 OpenBot `browser`。无登录公开页走 `web_fetch` / `web-research` / `defuddle`；用户自己点界面走 `user-guidance-protocol` |
| PPTX 幻灯片                           | **`cyber-ppt`**（主）+ 可保留薄入口 `pptx`          | pack `presentations` 不平行；优势并入 cyber-ppt，禁止第三套                                                                                                         |
| Word/Docs、表格 xlsx                  | （无对等捆绑名时再评估）                            | pack `documents` / `spreadsheets`：**先查仓库**；无覆盖才考虑单名引入，禁止双份                                                                                     |
| 只要 Mermaid / Markdown 表            | 聊天直接给                                          | 不必技能                                                                                                                                                            |

## 网页调研（意图 + 时效性 + 用户要求）

识别意图后自动分流，**不要只靠「调研 / 搜索」关键词**。细则以 `web-research` 的 `references/routing.md` 为准。

| 用户说                     | 技能                                          | 是否自动触发 `web-research`                                                     |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| 明确说「调研」「研究」     | **`web-research`**                            | 是：明确调研意图                                                                |
| 比较多个产品**当前**价格   | **`web-research`**                            | 是：外部且会变的信息                                                            |
| 最新政策、行业动态         | **`web-research`**                            | 是：时效性要求                                                                  |
| 阅读指定网页并分析         | **`web-research`**（单页去噪可先 `defuddle`） | 是：需要网页读取。`web_fetch` 与 `web_search` 二选一即可，缺搜索 key 不阻断抓页 |
| 只改写已提供的文本         | 直接写 / `content`                            | 否：已有材料即可                                                                |
| 稳定基础知识（定义、原理） | 直接答                                        | 通常否：未必联网                                                                |
| 分析自己上传的文档         | **`knowledge`**                               | 否：重点是文档分析                                                              |
| 只要证据表 / 来源分级      | `research-core`                               | 否：不重复做网页流水线                                                          |
| 战略纵深、横纵格局         | `deep-research`                               | 否：先 web-research 取证时可先后做                                              |
| 金融报价 / 财报            | `finance-research`                            | 否：垂直金融                                                                    |

上传文档同时又要「对一下网上最新口径」时：先 `knowledge` 读文件，再 `web-research` 补外部时效信息。

## 控制台扫码代操作

细则以 `browser-scan-proxy` 的 `references/routing.md` 为准。工具仍是 OpenBot `browser`，禁止再起一个叫 `browser` 的技能名。跨服务器 / 本机节点的整条任务先走 `independent-work`。

| 用户说                                       | 技能                             | 是否自动触发                          |
| -------------------------------------------- | -------------------------------- | ------------------------------------- |
| 扫码登录 / 你打开网页我来扫 / 重新启动浏览器 | **`browser-scan-proxy`**         | 是                                    |
| 已经扫码完毕 / 授权过期 / 二次扫码           | **`browser-scan-proxy`**         | 是                                    |
| 配公众号 AppID / AppSecret / IP 白名单       | **`wechat-official-credential`** | 是；扫码循环仍用 `browser-scan-proxy` |
| 个人设置里配私有数字身份 / 绑定账户          | **`oi-orchestrate-personal-identity`** | 是；再委派 oi-bind-* |
| 找不到按钮、带我点                           | `user-guidance-protocol`         | 否：用户自己点                        |
| 读公开网页 / 调研                            | `web-research` / `defuddle`      | 否：无登录公开页                      |


## 个人私有数字身份（授权目录）

| 用户说 | 技能 | 说明 |
| ------ | ---- | ---- |
| 配数字身份 / 绑定账户 / 完善我的授权 | **`oi-orchestrate-personal-identity`** | 大白编排入口；不直接写库 |
| 个人公众号 AppID / AppSecret | **`oi-bind-wechat-official`** | 委派 `wechat-official-credential`；个人店 |
| 绑定个人邮箱 / 126·163 授权码 | **`oi-bind-personal-email`** | Path B 表单 + Path C browser |
| 绑定 GitHub 个人 OAuth | **`oi-bind-github-personal`** | oauth.start；云电脑打开授权页 |
| 绑定社媒（小红书/抖音/微博/B站/知乎/快手/X） | **`oi-bind-xiaohongshu`** 等 `oi-bind-*` | credentials.bind (social_account)；仍 `path_unstable`（S5：微博已测 GeeTest/111001，未 verified_live） |
| 个人数字身份默认推荐（S5） | **`oi-orchestrate-personal-identity`** | 默认只推 `verified_live`；公众号云电脑证据见 `oi-bind-wechat-official` |
| 授权给自有数字人 | **`oi-grant-owned-bots`** | `grants.upsert` |
| 个人微信扫码通道 / 绑定个人号 | **`oi-bind-wechat-personal`** | **非云电脑**主路径；委派 `wechat-personal-worker-setup` |

## 知识与写作类（若环境已装）

| 用户说                   | 技能族                            |
| ------------------------ | --------------------------------- |
| 企业知识目录/管线/冷启动 | `enterprise-kb-*` / `knowledge-*` |
| 写/拆技能本身            | `skill-authoring`                 |

## 边界

- 纯编码、通用软件排障：不强制本路由。
- 纯 OpenAI API/Codex 模型题：不是 openbot-docs 主场。
- 重叠时：平台「怎么用」→ openbot-docs；「帮我执行某一类交付」→ 上表**单一**专门技能。
