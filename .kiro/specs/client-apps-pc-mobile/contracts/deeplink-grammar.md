# Contract: 深链 Grammar（任务 1.2 契约部分）

> owner：spec/release · 状态：**v1 冻结（2026-07-14）** · 消费者：`1.2-apple`（Swift `DeepLinks.swift`）、`1.2-android`（Kotlin 解析器）、`1.7-*`（各端路由）、web-ui（路由映射对齐）。
> 关联：`design.md` C5、`requirements.md` R-Native.1/.2、`ui/src/ui/employee-shell/embed-routes.ts`（`EMPLOYEE_EMBED_SURFACES`）、`native-bridge.ts`（intent）、`apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift`（既有 parser）。

## 目的

冻结 employee 深链的**统一 grammar**，使 iOS/macOS(Swift) 与 Android(Kotlin) 两套解析器**行为逐字节一致**，并与 web embed 路由 / 桥接 intent 对齐。**本契约只定义 grammar 与解析/校验规则**，不含实现代码。

## Scheme（双 scheme，均须接受）

- **`openclaw://`** = canonical（`DeepLinkSchemeSupport.canonicalScheme`）
- **`openbot://`** = legacy alias（`legacyScheme`）
- 两者**等价接受**；大小写不敏感；其它 scheme → 拒绝（返回 nil / 不处理）。

## 现状证据

- 既有 `DeepLinkParser.parse` 仅支持 host `agent` / `gateway` / `workspace`（`DeepLinks.swift`），本契约**新增** employee 相关 host，**不动**既有三者。
- employee surface 白名单以 `EMPLOYEE_EMBED_SURFACES` 为准（`overview`/`workspace`/`knowledge`/`growth`/`me`）。
- 桥接 intent 字段（`openChat.sessionKey/agentId`、`openSpace.spaceId`、`openKnowledgeObject.objectId`）为深链参数对齐基准。

## 路由表（新增 host）

| 深链                       | 参数                                                     | 解析结果 → 路由                                      | 说明                           |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| `…://employee/<surface>`   | `surface` ∈ `overview\|workspace\|knowledge\|growth\|me` | → embed 导航 `buildEmployeeEmbedPath(surface)`       | 未知 surface → 回退 `overview` |
| `…://chat`                 | `sessionKey?`、`agentId?`（均可选）                      | → 桥接 `openChat`（跳原生 chat）                     | 无参 = 打开当前/默认会话       |
| `…://space/<spaceId>`      | `spaceId`（必填、非空）                                  | → 桥接 `openSpace` → embed workspace(Wave1 Web 复用) | `spaceId` 空 → 拒绝            |
| `…://knowledge/<objectId>` | `objectId`（必填、非空）、`kind?`                        | → 桥接 `openKnowledgeObject` → embed knowledge       | `objectId` 空 → 拒绝           |

- **路径形为规范形**（进共享向量、优先级最高）；**query 形（`…://employee?surface=`）亦须支持且两端一致**（Swift 已支持，Android 须对齐，见共享向量末行）。
- 保留既有 `agent`/`gateway`/`workspace` 语义不变。

## 解析与校验规则（SHALL）

1. 未知 scheme / 未知 host → **拒绝**（Swift 返回 `nil`；Kotlin 返回 `null`），不 crash、不猜测。
2. `surface` 只接受白名单值；非白名单 → 回退 `overview`（不透传原值）。
3. 必填参数（`spaceId`/`objectId`）缺失或空白 → 拒绝该深链。
4. 拒绝路径穿越 / 注入：`..`、控制字符、协议相对（`//host`）、内嵌 scheme（`javascript:`/`data:`）→ 拒绝。
5. 解析产物为**类型化 route**（不透传原始字符串给导航层）。
6. 参数值做长度/字符上限保护（防超长注入）。
7. 前向兼容：无法识别的**新** host → 拒绝（而非崩溃），便于旧客户端优雅忽略未来深链。

## 鉴权与账号路由（SHALL）

1. **先鉴权后路由**（R-Native.2）：解析出 route 后，须先过**会话域鉴权**（employee 已登录）；未登录 → 存下**待处理深链**、先走登录，登录成功后**继续**到目标。SHALL NOT 绕过登录/权限直达。
2. **账号作用域**：深链在**当前活跃账号**（`activeAccountId`，见 `account-session-model.md`）内解析。Wave 1 为「单活跃账号」；若深链隐含其它账号/org，**提示切换**而非静默跨账号。跨账号深链定向记为后续，不入 Wave 1。
3. **来源不可信**：深链来自外部（通知/其它 app/浏览器），一律按不可信输入校验（§解析规则），再经鉴权。

## 平台映射

| 平台               | 解析                                                                                     | 唤起入口                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| iOS / macOS        | `DeepLinkParser`（`apps/shared/OpenClawKit/.../DeepLinks.swift`，**apple-shared 落地**） | URL scheme + Universal Links；`onOpenURL` / `application(_:open:)` |
| Android            | 新 Kotlin 解析器（`apps/android/**`，**android 落地**，与 Swift grammar 对齐）           | scheme + App Links；`Intent`/`onNewIntent`                         |
| Windows(Tauri, W3) | 复用 grammar 语义                                                                        | 自定义协议注册（`openclaw://`/`openbot://`）                       |

> ios/macos **只消费** apple-shared 的 `DeepLinkParser`，不各自实现（热区红线）。

## 共享测试向量（两端解析器须一致通过）

| 输入 URL                                   | 期望结果                                                |
| ------------------------------------------ | ------------------------------------------------------- |
| `openclaw://employee/overview`             | route=employee(surface=overview)                        |
| `openbot://employee/knowledge`             | route=employee(surface=knowledge)（legacy scheme 等价） |
| `openclaw://employee/bogus`                | route=employee(surface=overview)（未知 surface 回退）   |
| `openclaw://employee?surface=growth`       | route=employee(surface=growth)（query 形，两端须一致）  |
| `openclaw://chat?sessionKey=s1&agentId=a1` | route=chat(sessionKey=s1, agentId=a1)                   |
| `openclaw://chat`                          | route=chat(无参，默认会话)                              |
| `openclaw://space/sp_123`                  | route=space(spaceId=sp_123)                             |
| `openclaw://space/`                        | reject（spaceId 空）                                    |
| `openclaw://knowledge/obj_9?kind=doc`      | route=knowledge(objectId=obj_9, kind=doc)               |
| `openclaw://knowledge/`                    | reject                                                  |
| `https://gw.openbot.love/x`                | reject（非受支持 scheme）                               |
| `openclaw://employee/../etc`               | reject（路径穿越）                                      |
| `openclaw://unknownhost`                   | reject（未知 host）                                     |

> 两端各自实现解析器，但**共用上表**为单测数据；新增用例须同步两端。

## 版本与验收

- Grammar 版本 **v1**；扩展走加法（新增 host/param），破坏性变更须升版并双端同步。
- **`1.2-apple` 验收**：`DeepLinkParser` 覆盖上表向量（Swift 单测）；既有 agent/gateway/workspace 不回归。
- **`1.2-android` 验收**：Kotlin 解析器覆盖同一向量（Kotlin 单测），结果与 Swift 逐条一致。
- **`1.7-*` 验收**：route → 鉴权 → embed 导航/桥接 intent 端到端；未登录先登录再续（deferred deep link）。
