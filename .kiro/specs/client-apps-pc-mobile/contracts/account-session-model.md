# Contract: Account-Scoped 会话与存储模型（任务 1.3-contract）

> owner：spec/release · 状态：**v1 冻结（2026-07-14）** · 消费者：`1.3-ios` / `1.3-android` / `1.3-macos`（以及 Wave 3 windows）。
> 关联：`design.md` C1/C2/C3、`requirements.md` R3.4/R3.7/R10.6/R10.7、`tasks.md` 1.3。

## 目的与范围

定义**三端统一**的"按账号隔离（account-scoped）"会话与存储模型，作为各平台 `1.3-*` 子任务的实现基准，确保：

- **多账号/多组织不串味**（R3.4 切换、R3.7 登出/切组织清理）；
- **弃用 `URLSession.shared`**（现骨架 `EmployeeShellBootstrap.mintToken(session:.shared)` 是多账号 foot-gun）；
- **三 jar 物理隔离**：客户端登录会话 jar ≠ Employee Shell WebView 会话 jar ≠ 既有 Canvas 非持久 jar；
- **端上凭据安全存储**（R10.6）+ 可选 app-lock（R10.7）。

**本契约只定义模型与不变式**，不含平台实现代码；各端在自己 `apps/<platform>/**` 内实现并各自测试。

## 现状证据（为何需要此契约）

- iOS/macOS 骨架 `mintToken(session: URLSession = .shared, …)` 默认 `.shared` → 所有账号共用一个 cookie jar（串味风险）。
- `/native/bootstrap` 消费后把 **HttpOnly employee 会话** 写入**发起该导航的 WebView 的 cookie jar**；mint 用的是**客户端 HTTP 会话的 cookie jar**（持登录态）。二者必须按账号各自独立。
- Android `CookieManager` 为**进程级全局**；iOS/macOS `WKWebsiteDataStore.default()` 为**应用级单例** → 都不能天然按账号隔离，需按下文平台映射处理。
- 既有 Canvas/A2UI WebView 用 `.nonPersistent()`，**不得**用它承载员工会话（§5.4.3）。

## 模型

### Account 实体

一个 **Account** = 一个 `{gatewayBaseURL, userEmail}` 组合下的登录身份，可含多个可切换的 org。字段：

| 字段             | 说明                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `accountId`      | 稳定主键：`sha256(lower(gatewayBaseURL) + "\n" + lower(userEmail))` 取前 16 hex。**不含明文 email**，可作命名空间前缀。 |
| `gatewayBaseURL` | 该账号的网关（默认 `https://gw.openbot.love`，或自托管）。                                                              |
| `userEmail`      | 展示用（登录名），仅存安全存储。                                                                                        |
| `activeOrgId`    | 当前组织（多组织时）。切组织不换 accountId，但须清 embed 会话重 bootstrap。                                             |
| `urlSessionId`   | 该账号的客户端 HTTP 会话/ cookie jar 标识。                                                                             |
| `webDataStoreId` | 该账号的 Employee Shell WebView 数据存储标识（UUID）。                                                                  |
| `credentialRef`  | 安全存储中该账号凭据/会话的键句柄。                                                                                     |
| `pushTokenRef`   | （Wave 2）该账号推送 token 句柄。语义与生命周期见 `contracts/push-model.md`。                                              |

全局单值：`activeAccountId`、`appLockPolicy`。

### 三个隔离存储（每账号各一套）

1. **客户端会话 jar（Client Session Jar）**：原生 HTTP 客户端（iOS/macOS `URLSession` / Android `OkHttp`）的 cookie jar，持 **platform-auth 登录会话**，供 `mint` 调用携带。**禁止 `.shared`**。
2. **WebView 会话存储（Employee Shell Data Store）**：承载 `/native/bootstrap` 302 写入的 **HttpOnly employee 会话 cookie**。与 Client Jar 分离、与 Canvas 非持久存储分离。
3. **安全凭据存储（Secure Credential Store）**：Keychain / Keystore / DPAPI / Secret Service，存 `credentialRef`/`pushTokenRef`/`appLockPolicy`，**明文不落盘**。

### 命名空间

所有持久键 SHALL 以 `openbot.account.<accountId>.` 前缀；全局键 `openbot.active-account` / `openbot.app-lock`。切账号只切 `activeAccountId` 并切换到对应存储句柄，**不跨账号读写**。

## 生命周期

| 操作                     | 行为                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **add / login**          | 认证成功 → 计算 `accountId` → 建该账号的 Client Jar + WebView DataStore + 安全凭据；写 `activeAccountId`。                |
| **switch account**       | 仅改 `activeAccountId` → 切到该账号的三存储句柄；UI 重挂到其 Employee Shell（必要时重 bootstrap）。**不清任何账号数据**。 |
| **switch org**（同账号） | 保 `accountId`；**使该账号 WebView 会话失效并重 bootstrap** 到新 org 视图；清该账号内存态。                               |
| **logout**（当前账号）   | 清该账号 Client Jar + WebView DataStore + 内存缓存，服务端吊销会话，删安全凭据；`activeAccountId` 切到其它账号或空。      |
| **remove account**       | logout + 删除该 `accountId` 全部命名空间数据与存储句柄。                                                                  |

## 不变式（SHALL / SHALL NOT）

1. SHALL NOT 使用 `URLSession.shared`（或任何跨账号共享的默认 HTTP 会话/ cookie jar）承载登录会话。
2. Client Jar / WebView DataStore / Canvas 非持久 jar **三者物理隔离**，任一账号的 cookie SHALL NOT 出现在另一账号或 Canvas 存储中。
3. `mint` SHALL 用**当前账号的 Client Jar** 发起；`/native/bootstrap` 写入的会话 SHALL 落到**当前账号的 WebView DataStore**。
4. 切账号 SHALL NOT 泄漏上一账号的 cookie/内存态；切组织 SHALL 触发重 bootstrap，SHALL NOT 复用旧 org 的 embed 会话。
5. Employee 会话（登录/过期/登出/切换）SHALL NOT 影响 **Node 配对会话**，反之亦然（双身份正交）。
6. 凭据/会话 token SHALL 仅存安全存储，SHALL NOT 明文落盘或写入普通 Prefs/UserDefaults。
7. `accountId` SHALL 可由 `{gatewayBaseURL,userEmail}` 稳定重算，SHALL NOT 内嵌明文 email 于键名。

## 存储键 schema（安全存储，按 accountId 命名空间）

```
openbot.account.<accountId>.userEmail        # 展示名
openbot.account.<accountId>.gatewayBaseURL    # 网关
openbot.account.<accountId>.activeOrgId        # 当前组织
openbot.account.<accountId>.credential          # 登录会话/refresh（平台安全存储句柄）
openbot.account.<accountId>.webDataStoreId      # WebView 数据存储 UUID
openbot.account.<accountId>.pushToken           # (Wave 2 · 见 contracts/push-model.md)
openbot.active-account                           # 全局：当前 accountId
openbot.app-lock                                 # 全局：app-lock/生物识别策略
```

## 平台映射（各端 `1.3-*` 据此实现）

| 关注点           | iOS / macOS                                                                                                                                                         | Android                                                                                      | Windows(Tauri, W3)                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| Client 会话 jar  | 每账号独立 `URLSession`（`URLSessionConfiguration` 自带独立 `HTTPCookieStorage`），**非 `.shared`**                                                                 | 每账号独立 `OkHttpClient` + 自定义 `CookieJar`（后端加密存储）                               | 每账号独立 HTTP client + cookie 容器 |
| WebView 会话存储 | **`WKWebsiteDataStore(forIdentifier:)`**（iOS 17+/macOS 14+，基线 iOS 18/macOS 15 满足）按账号一 UUID —— **取代骨架的 `.default()`**（`.default()` 是单例不可隔离） | 见下「Android 约束」                                                                         | WebView2 per-account user data 目录  |
| 安全凭据         | Keychain（`kSecAttrAccount = accountId` 命名空间）                                                                                                                  | Android Keystore + `EncryptedSharedPreferences`（复用 `SecurePrefs.kt`，key 前缀 accountId） | Credential Manager / DPAPI           |
| Canvas 隔离      | employee DataStore ≠ Canvas `.nonPersistent()`                                                                                                                      | employee WebView cookie 域/实例 ≠ Canvas                                                     | 独立 profile                         |

> **iOS/macOS 修正（重要）**：`design.md` 骨架注记用「持久 `WKWebsiteDataStore.default()`」，但 `.default()` 是应用级单例、**无法多账号隔离**；本契约据此**改用 `WKWebsiteDataStore(forIdentifier:)`**（基线可用）。骨架应替换。

## Android 约束（多账号 WebView 隔离）

`CookieManager` 进程级全局；`WebView.setDataDirectorySuffix(...)` **每进程只能调一次、且须在任何 WebView 创建前**。因此**并发**多账号 WebView 无法在同进程各自持久隔离。**Wave 1 采用「单活跃账号」模型**：

- 同一时刻只挂**当前账号**的 Employee Shell WebView；
- 切账号 = 清 gateway 域 cookie（`CookieManager`）+ 销毁并重建 WebView + 用新账号重 bootstrap；
- Client 会话 jar 用 per-account `OkHttp CookieJar`（可并存，不受此约束）。
- 若后续需真·并发多账号 WebView，另评估 `:webview` 独立进程方案（记为后续，不入 Wave 1）。

## Bootstrap 交互（对齐 design F1/F2）

1. `mint` 用**当前账号 Client Jar**（持登录会话）`POST /native/bootstrap/mint` → token。
2. Employee Shell WebView（绑定**当前账号 WebDataStore**）打开 `/native/bootstrap?token=&target=` → 302 写 HttpOnly 会话到**该 WebDataStore**。
3. 401（embed）→ 用当前账号 Client Jar 静默 re-bootstrap；401（mint）→ 该账号回登录。

## 验收（1.3-contract 冻结门 + 各 `1.3-*` 复用）

- 契约层：本文件评审通过即冻结 v1；`accountId` 计算与键 schema 提供纯函数参考（各端可各自实现 + 单测）。
- 各 `1.3-*` 子任务验收：**多账号切换无 cookie 串味**（登录 A、登录 B、切换、断言各自会话独立且互不可见）、**切组织触发重 bootstrap**、**登出只清本账号**、**凭据不明文落盘**、**employee 与 node 会话互不影响**。
- 手机视口/真机联调纳入各端 `1.5-*` / `1.10`。

## 变更影响

- 取代 design 骨架的 `URLSession.shared` 默认与 `WKWebsiteDataStore.default()`（见平台映射修正）。
- 不改 `/native/bootstrap`、employee-shell 契约、既有 companion；纯客户端会话/存储组织方式。
