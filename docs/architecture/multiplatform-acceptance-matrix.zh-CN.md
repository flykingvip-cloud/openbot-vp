# 多端验收矩阵（手机四 Tab）

> **状态：** Stage 55 Windows Web shell 宿主 + Stage 54 登录/深链/通知 + Stage 53 Mac Web shell POC + Stage 52 ADR · 不是发版签收单  
> **日期：** 2026-10-08（Asia/Shanghai）  
> **基线：** `main` @ `a0303a926`（含已合入 [#306](https://github.com/upbeyond/openbot/pull/306) 的 Android stage22–38 + iOS stage39–50）  
> **English stub：** [`multiplatform-acceptance-matrix.md`](./multiplatform-acceptance-matrix.md)  
> **视觉 SoT：** `/Users/daniel/Desktop/openbot-four-tab-frontend-preview/README.md` 的 IMPLEMENT 表（该文件**没有**正式编号；下表 `IMP-*` 只是对这些行的稳定简称）  
> **格子：** Android / iOS 只用 **有 / 部分 / 无**，并引用本 checkout 里读过的 evidence 或源码。读过但没有对应实现记录的，写 **无**，不补写 stage 结论。  
> **Desktop：** 策略已拍板为 **Web shell**（[`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md)，Daniel / 2026-10-07）。**IMP-SHELL** + Stage 54 登录/深链/通知（`apps/macos/docs/evidence/stage54-mac-employee-web-shell-login-deeplink/`）+ Stage 55 Windows 宿主（`apps/windows/docs/evidence/stage55-windows-employee-web-shell-host/`）。Web employee 已有行为 → Desktop **有（Web shell 复用）**；Web 无/部分/刻意不做保持同口径；伴侣 **N/A（伴侣非员工面）**；**禁止**原生四 Tab。

Web employee 列表示：已读 evidence 是否把该用户故事记成 Web employee 行为参考（给出它引用的 TS 路径）。不是一次新的 Web 验收。

本地未提交目录 `apps/android/docs/evidence/stage43-android-acceptance-apk/` **不**作为本表依据。

## 相对 Stage 45 矩阵的变化

Stage 45 矩阵写于 `app/stage44-mobile-tokens`，当时 iOS 仅有四 Tab 壳（stage39）+ rename（40–42）。其后已合入：

| Stage | Evidence                                                                  | 覆盖                                                      |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| 46    | `apps/ios/docs/evidence/stage46-ios-chat-chrome/`                         | Agent Strip、胶囊、send→stop、TalkMode mic                |
| 47    | `apps/ios/docs/evidence/stage47-ios-tasks-r1/`                            | 定时任务 / 待我处理 + accept/complete + 精简 cron.add     |
| 48    | `apps/ios/docs/evidence/stage48-ios-knowledge-r1/`                        | 标题在上、树、search、全屏预览                            |
| 49    | `apps/ios/docs/evidence/stage49-ios-me-deepen/`                           | Connect、device.pair、创建、workspace tabs、MeSubScaffold |
| 50    | `apps/ios/docs/evidence/stage50-ios-polish-tokens/`                       | Manrope + `scripts/check-mobile-tokens.mjs`               |
| 53    | `apps/macos/docs/evidence/stage53-mac-employee-web-shell-poc/`            | Mac Web shell 窗 + device-settings 边界                   |
| 54    | `apps/macos/docs/evidence/stage54-mac-employee-web-shell-login-deeplink/` | 登录 / 深链 / 通知点回员工窗                              |

Tokens / 校验：`design/mobile-tokens.json` + `design/README.md`（Track B1 已落地；Kotlin/Swift/CSS **生成器**仍未做，属刻意后置）。

## 对话

| Feature                                                                        | Android                                                       | iOS                                                                                                                                      | Web employee                                           | Visual SoT IMPLEMENT id | Desktop                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 四底栏：对话 / 任务 / 知识 / 我的（登录后原生壳，不是 stage30 全 Tab WebView） | 有 — `apps/android/docs/evidence/stage22-four-tabs/README.md` | 有 — stage39 shell + stage46–49 填满四 Tab：`apps/ios/docs/evidence/stage39-ios-four-tab-shell/README.md`；源码 `EmployeeRootTabs.swift` | 无 — 已读 evidence 未把 Web employee 记成手机四底栏    | IMP-SHELL               | 有（Desktop=**Web shell 窗** + Stage 54 登录/深链/通知 + Stage 55 Windows 宿主）— stage53 + stage54 + stage55 evidence |
| Agent Strip：图标在上、名称在下、管家首位、无 TO:                              | 有 — stage34 / stage35 README                                 | 有 — `apps/ios/docs/evidence/stage46-ios-chat-chrome/README.md`；`ChatAgentStripView.swift`                                              | 有（行为）— stage23 → workbench roster / `agents.list` | IMP-STRIP               | 有（Web shell 复用）                                                                                                   |
| 点选 Strip 切换会话                                                            | 有 — stage38 README                                           | 有 — stage46：`switchSession(to:)`（iOS 名，对齐 Android `switchChatSession`）                                                           | 有（行为）— stage38 对齐 Web `onSelectSession`         | IMP-STRIP-SESSION       | 有（Web shell 复用）                                                                                                   |
| 粉「知识库」胶囊（上下文来源）                                                 | 有 — stage35（追溯 stage31 capsule）                          | 有 — stage46；`ChatKnowledgePickerSheet.swift`（flat focused+turn；完整树/预设未移植）                                                   | 有（行为）— stage29 → `context-scope.ts`               | IMP-KB-CAPSULE          | 有（Web shell 复用）                                                                                                   |
| 附件胶囊（多文件 + 移除）                                                      | 有 — stage33 README                                           | 有 — stage46；composer attach capsules                                                                                                   | 有（行为）— stage33 → chat views/controllers           | IMP-ATTACH              | 有（Web shell 复用）                                                                                                   |
| 发送 → 停止方块 → `chat.abort`                                                 | 有 — stage33 README                                           | 有 — stage46；`pendingRunCount` → stop → `abort()`                                                                                       | 有（行为）— stage33 `handleAbortChat`                  | IMP-STOP                | 有（Web shell 复用）                                                                                                   |
| Chat「打开成果」页脚                                                           | 有 — stage25 README                                           | 无 — stage46 evidence / `ChatTabView.swift` 未记 deliverable footer                                                                      | 无 — 已读 evidence 无 Web employee「打开成果」实现引用 | IMP-DELIVERABLE         | 无（Web 亦无）                                                                                                         |
| 麦克风走 Voice / TalkMode，不是聊天气泡录音                                    | 有 — stage33 README                                           | 有 — stage46：composer mic → `TalkModeManager` / `TalkOrbOverlay`（非气泡 STT）                                                          | 部分 — stage33：Web composer mic **disabled**          | IMP-MIC                 | 部分（复用 Web）                                                                                                       |

## 任务

| Feature                                 | Android                               | iOS                                                                                | Web employee                                   | Visual SoT IMPLEMENT id                         | Desktop              |
| --------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | -------------------- |
| 分段「定时任务 \| 待我处理」            | 有 — stage28 README                   | 有 — `apps/ios/docs/evidence/stage47-ios-tasks-r1/README.md`；`TasksTabView.swift` | 有（行为）— stage28 employee task/cron centers | IMP-TASKS-SEG                                   | 有（Web shell 复用） |
| 待我处理：接受 / 完成                   | 有 — stage28 / stage34                | 有 — stage47：`task.list` / `task.accept` / `task.complete`                        | 有（行为）— 同左                               | IMP-TASKS-ACCEPT                                | 有（Web shell 复用） |
| 新建定时任务（手机为缩短的 `cron.add`） | 部分 — stage28 Gaps：完整向导未移植   | 部分 — stage47 精简 `cron.add`（对齐 Android；非 Web 多步向导）                    | 有（行为，完整向导在 Web）— stage28 `cron.ts`  | IMP-TASKS-CRON                                  | 有（复用 Web cron）  |
| 任务详情「任务成果 / 打开全文」         | 无 — **刻意不做**（stage28/31/34/35） | 无 — **刻意不做**（stage47 Not done）                                              | 无 — Web assigned-tasks 无 result preview      | IMP-TASKS-RESULT（预览超集，非 IMPLEMENT 必做） | 无（刻意不做）       |

## 知识

| Feature                                    | Android                         | iOS                                                                               | Web employee                                         | Visual SoT IMPLEMENT id               | Desktop               |
| ------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- | --------------------- |
| 标题「我的知识库」在上，搜索在下           | 有 — stage38 README             | 有 — `apps/ios/docs/evidence/stage48-ios-knowledge-r1/README.md`                  | 有（行为）— stage29 knowledge cockpit                | IMP-KB-TITLE                          | 有（Web shell 复用）  |
| 知识树 + 全屏文档，无左轨                  | 有 — stage29 / stage34          | 有 — stage48；`KnowledgeTabView.swift`（HTML 预览作纯文本+caption，非 WKWebView） | 有（行为）— stage29 cockpit（Web 有 rail；手机不要） | IMP-KB-TREE                           | 有（Web shell 复用）  |
| `knowledge.search`（查询足够长时走服务端） | 有 — stage31 README             | 有 — stage48（2+ 字符 debounce → `knowledge.search`）                             | 有（行为）— stage31                                  | IMP-KB-SEARCH                         | 有（Web shell 复用）  |
| 收藏 / 预览保真之外的创建、重命名、⋯ 菜单  | 无 — **刻意不做**（stage31/34） | 无 — **刻意不做**（stage48；本地收藏 UserDefaults only）                          | 有（行为在 Web cockpit）— stage29 未移植菜单         | IMP-KB-WRITE（非手机 IMPLEMENT 必做） | 有（复用 Web 写菜单） |

## 我的（Hub + 次级页）

| Feature                                                 | Android                                  | iOS                                                                                                 | Web employee                                   | Visual SoT IMPLEMENT id | Desktop              |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- | -------------------- |
| Hub 分段：个人设置｜本机与连接｜更多                    | 有 — stage30 README                      | 有 — stage39 + stage49；`MeTabShell.swift` / `MeHubScreens.swift`                                   | 有（行为）— stage30 personal-settings-page     | IMP-ME-HUB              | 有（Web shell 复用） |
| 次级：账号 / 安全 / 改密                                | 部分 — 改密已接；资料卡偏只读投影        | 部分 — stage49：账号卡 + 登出；改密 / 完整安全向导未做（走 Web）                                    | 有（行为）— stage30 account/security panels    | IMP-ME-ACCOUNT          | 有（复用 Web 账号）  |
| 次级：授权资源列表；添加身份走 Web 向导                 | 部分 — 列表 + Web 向导（非手机内 OAuth） | 无 — **刻意不做**手机内 OAuth/微信向导（stage49 calibrated ignore）；运营授权在机器人 workspace tab | 有（行为）— stage30/31 identity forms          | IMP-ME-IDENTITY         | 有（复用 Web 向导）  |
| 次级：我的设备 / `device.pair.list`                     | 有 — stage30                             | 有 — stage49：只读列表 + 本机标记                                                                   | 有（行为）— `devices.ts`                       | IMP-ME-DEVICE           | 有（Web shell 复用） |
| 次级：本机能力（网关设置 / 语音 / 屏幕）                | 有 — stage30 Connect/Settings            | 有 — stage49：连接网关 in-tab `SettingsTab(embedded:)`；设备与权限同表单                            | 无 — companion 能力，非 employee 口页面        | IMP-ME-LOCAL            | N/A（伴侣非员工面）  |
| 次级：更多 → 新建机器人 / 协作组（不是 Strip「+」）     | 有 — stage30/31/35                       | 有 — stage49：`workspaces.create` / `agents.create` / `collaboration.spaces.*`                      | 有（行为）— stage30/31                         | IMP-ME-CREATE           | 有（Web shell 复用） |
| 次级：助手详情 tabs（身份｜能力｜成长｜运营授权｜协作） | 有 — stage37 README                      | 有 — stage49：`robot.workspace.get` / `updateIdentity` 等                                           | 有（行为）— stage37 `robot.workspace.*`        | IMP-ME-BOT-TABS         | 有（Web shell 复用） |
| 次级页保留「我的」kicker、圆形返回/+、底栏仍选中我的    | 有 — stage38 `MeSubScaffold`             | 有 — stage49 `MeSubScaffold`（in-tab，非 sheet；底栏仍选中我的）                                    | 无 — HTML/Android chrome，无 Web employee 路径 | IMP-ME-TERTIARY         | 无（Web 无路径）     |

## 不在本表里冒充「有」的事项

- Strip 拖拽持久化、Strip「+」向导、聊天气泡内录音 / 气泡内可播语音：Android 与 iOS evidence 均写明刻意不做。
- iOS Chat「打开成果」页脚、Me 手机内 OAuth/改密向导、知识库写菜单、任务成果预览：仍为 **无** 或 **刻意不做**，不要从四 Tab 已齐推断为已做。
- Desktop 策略：**Web shell（已拍板）**。IMP-SHELL + Stage 54 登录/深链/通知 + Stage 55 Windows WebView2 宿主；Web employee 已有行为 Desktop 标 **有（Web shell 复用）**；刻意不做项不要写成 Desktop「有」；伴侣（TCC/node；Windows 伴侣仍 planned）标 **N/A（伴侣非员工面）**。
- 未在上表出现、且本 checkout evidence 未点名的用户故事：视为 **无**（没有证据），不要从截图文件名推断。
