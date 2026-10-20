# 外部授权技能 → OpenBot 对照

来源：桌面 `box-browser-auth-skills.zip`（2026-09-21 快照）。那是 **Grok Bot / Box 云电脑** 的托管 skill，不是 OpenBot API。原则可吸收，**工具名不可照搬**。

Grok Bot ≠ OpenBot。禁止把 `request_user_form`、`request_box_help`、`SearchPlugins`、`Shared with Grok Bot` 当成 OpenBot 可调用工具。

## 吸收的原则

| 外部原则                           | OpenBot 落点                                                     |
| ---------------------------------- | ---------------------------------------------------------------- |
| 无连接器时默认去干活，不要先问许可 | 用户已经下了任务就执行；只把「人必须出场的授权」亮出来           |
| 先连接器，再浏览器                 | 技能路由 + 官方 CLI + Gateway 工具；待认证连接器不要用浏览器绕过 |
| 密钥不进模型上下文                 | 不让用户往聊天贴密码；`op` 在 tmux；OTP 能从已接管邮箱读就自己填 |
| 能定向填写再交接整桌面             | 隔离浏览器代填；只有 Passkey / 拼图 / 跨域 iframe 才带路         |
| 云电脑 ≠ 用户电脑                  | sandbox/gateway ≠ `exec host=node` ≠ SSH 生产机                  |
| 本机授权弹窗是预期步骤             | `tools.exec.ask`、OpenBot.app Grant、TCC；拒绝则停               |
| 落盘前解析本机路径                 | 在节点上查 Desktop，禁止写死用户名                               |
| 禁止用 Shell 偷开 GUI              | 网页=`browser`；Mac=`peekaboo`；禁止 Playwright/CDP/xdotool      |
| 登录后继续原任务                   | `browser-scan-proxy` 的 EXECUTE + checkpoint                     |
| 交付物先在远端做完再拷本机         | 少触发本机授权次数                                               |

可执行映射落在 [procedure.md](procedure.md)：zip 的 A 授权 / B 本机 / C 串联已按 OpenBot 工具改写（无 `request_user_form`、无 `request_box_help`）。

## 明确不搬的能力（OpenBot 现状缺口）

| 外部机制                          | 现状                             | OpenBot 替代                                              |
| --------------------------------- | -------------------------------- | --------------------------------------------------------- |
| `request_user_form` 写后即焚表单  | 数字人侧没有同款宿主表单         | 隔离页代填；OTP 从已接管邮箱读取；禁止聊天贴密            |
| `request_box_help` 整桌面交接     | 没有「交还助手」按钮             | 节点 Peekaboo；点不到再 `user-guidance-protocol` 只带一步 |
| Chrome cookie 导入批准            | 禁止把登录开到用户 Chrome 再干等 | 固定 `profile=openclaw` 隔离会话                          |
| 1Password「Shared with Grok Bot」 | 那是 Grok 保险库名               | OpenBot `1password` 技能 + 用户自有保险库                 |

## zip 内文件（审计用，不要当运行手册）

- `managed/no-connector-fallback` — 无连接器走云电脑；1Password → 表单 → 交接
- `managed/in-chat-forms` — 打字步骤优先聊天表单，密钥回执无明文
- `managed/box-desktop` — 桌面交互必须委托，禁止 Shell 驱动 GUI
- `user/浏览器登录-表单或桌面交接` — 登录专项升级路径
- `user/浏览器与本机授权完整流程` — 浏览器/CLI + 本机授权 + 落盘总流程
