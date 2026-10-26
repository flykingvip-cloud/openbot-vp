# Contract: 员工服务端 Push 模型（Wave 2 · 任务 2.1/2.2 契约）

> owner：spec/release · 状态：**产品契约已拍板（2026-10-08）· 实现首刀进行中（gateway+iOS MVP）** · 消费者：gateway（2.1/2.2 投递）、ios（首刀消费）、android（后续）、macos（远程后置）。
> 关联：`design.md` C5、`requirements.md` R-Native.1/.6 · R10.5、`tasks.md` 2.1/2.2、`contracts/deeplink-grammar.md`、`contracts/account-session-model.md`、Stage 54/55 evidence。
> **本契约只冻结产品/接口语义**，不含 Gateway/客户端运行时实现代码。

## 目的

冻结 **employee-scoped 服务端推送**（通知能力 Wave 2）的身份、注册、投递、token 生命周期与平台边界，使实现 PR **不得**复用 node 通道、**不得**另写点击路径、**不得**在无凭据环境下假实现合入 main。

> **命名澄清：** 本文件「Wave 2」= **通知能力** Wave 2（employee 服务端推送），与 client-apps 发布波次 Wave 2 同口径（任务 2.1/2.2）。不是另起一套 push 栈品牌。

## 与 Wave 1 / node push 的边界（SHALL / SHALL NOT）

| 维度       | Wave 1（已定）                            | Wave 2（本契约）                                         | node / 伴侣（既有，禁止混用）                                     |
| ---------- | ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 能力       | 深链 + **本地/系统通知**点击直达          | **服务端**远程 push → 员工设备 → 点击进员工面            | APNs `push.apns.register` / `push.test` / `node.wake`（`nodeId`） |
| 身份键     | `activeAccountId` 内解析深链              | **employee `accountId`**（+ device 并存）                | `nodeId`                                                          |
| 点击       | `EmployeeNotificationRouter` + `deepLink` | **必须复用同一 Router**                                  | 伴侣/node 路径，不进员工窗                                        |
| 已连接扇出 | 本地通知 / WS UI                          | 远程 push **补离线/后台**；`GatewayPush` **不是** Wave 2 | `GatewayPush` in-process                                          |

**SHALL NOT：**

1. 把员工 token 写入 `registrationsByNodeId` / node APNs 表或文件。
2. 把 `push.apns.register` / `node.wake` / `GatewayPush` / `group.notification` 改名或薄封装成 Wave 2。
3. 另写一套通知点击路径绕过 `EmployeeNotificationRouter` / DeepLinkHandler。
4. 在 payload 中投递业务正文/密钥/会话全文（仅元数据 + 短 title/body，见 R10.5）。
5. 无真实 APNs/FCM 凭据时的「假实现」合入 main。

## 已拍板决策（Daniel · 2026-10-08 Asia/Shanghai）

| ID                     | 决策           | 拍板                                                                                                                                                                         |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **D-PUSH-W2-TRIGGER**  | MVP 触发源     | **仅 @mention**（挂既有 `human-mention-notifications` inbox；缺远程投递）                                                                                                    |
| **D-PUSH-W2-PLATFORM** | 平台顺序       | **iOS APNs 首刀** → Android FCM 另刀 → Mac 员工壳远程后置 → **Windows WNS/Toast 明确不在本契约 MVP**                                                                         |
| **D-PUSH-W2-MULTI**    | 同账号多设备   | **是**：同一 `accountId` 允许多 registration 并存                                                                                                                            |
| **D-PUSH-W2-CREDS**    | APNs 凭据      | **员工独立配置/topic**（不写 node 表；不复用 node registration）；env 占位见下；**bundle / topic 具体值 TBD**（实现前由 iOS/发布 owner 填实）                                |
| **D-PUSH-W2-CLICK**    | 点击与 payload | 复用 Wave 1 Router；**强制** `deepLink`；短 title/body；**alert**（非 silent）；客户端按 `accountId` 存 token；登出/切账号 **注销**服务端 registration                       |
| **D-PUSH-W2-RPC**      | RPC 命名       | **已确认落地**：`employee.push.register` / `unregister` / `test`（gateway method pack `employee-push`）；platform-auth HTTP 镜像供 iOS cookie 会话：`/employee/push/register | unregister` |

**继承的已定案（勿重开）：** `D-PUSH-SCOPE=A`（W1 本地/深链；W2 服务端 employee push 净新增）。

## 身份与存储

1. **服务端 registration 主键语义：** `accountId` + `deviceId`（或等价稳定设备句柄）+ `platform`（`ios` / `android` / …）。
2. **多设备：** 同 `accountId` 下多条 registration **并存**；同一 `(accountId, deviceId, platform)` 重复注册 → **upsert** token。
3. **投递范围：** 向该员工（platform-user / 对应 `accountId` 名下）**所有已注册且未注销**的设备投递；客户端点击后仍按 `activeAccountId` + deeplink-grammar 鉴权；若 payload 带 `accountId` 且与活跃账号不符 → **提示切换**，不静默跨账号。
4. **客户端槽位（既有预留）：** `openbot.account.<accountId>.pushToken`（见 `account-session-model.md`）；明文 token SHALL 仅出现在安全存储句柄语义内。
5. **生命周期：**
   - 登录成功且用户授权通知后 → 取平台 token → 调用注册 RPC。
   - token 旋转（APNs/FCM 回调）→ 重新注册（upsert）。
   - **logout / switch account / remove account** → 对**离开的** `accountId` 调用注销（或等价 revoke）；SHALL NOT 把旧账号 token 留在服务端可投递集合。
6. **与 node 正交：** Employee 推送会话 SHALL NOT 影响 Node 配对 / `push.apns.register`；反之亦然。

## Payload（远程 push → 系统通知）

| 字段             | 要求         | 说明                                                                                                                                                                                                                     |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deepLink`       | **强制**     | 符合 `deeplink-grammar.md`（`openbot://` / `openclaw://`；host ∈ employee/chat/space/knowledge）。Mac/iOS userInfo key = `"deepLink"`；Android Intent extra = `ai.openclaw.employee.deepLink`（与 Wave 1 Router 对齐）。 |
| `title` / `body` | **短文案**   | 用户可见 alert；本地化可后置（先 zh-CN/en 资源位即可）。                                                                                                                                                                 |
| `accountId`      | **建议携带** | 多账号提示切换；不替代服务端按 registration 选设备。                                                                                                                                                                     |
| 业务正文         | **禁止**     | 不含消息全文、密钥、附件；仅元数据级（R10.5：APNs/FCM 仅投递元数据）。                                                                                                                                                   |
| 类型             | **alert**    | 非 silent；勿与伴侣 `node.wake` silent 混淆。                                                                                                                                                                            |

点击路径（所有平台，一旦弹出系统通知）：

```
系统通知点击 → EmployeeNotificationRouter → DeepLinkHandler
  → 未登录：presentLogin(pendingPath) → 登录后继续
  → 已登录：员工窗/壳目标 surface
```

## 触发（MVP）

| 波次     | 触发                                  | 说明                                                                                                             |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **MVP**  | **@mention**                          | 既有租户 inbox（`human-mention-notifications`）在持久化后 **enqueue** 员工远程投递；本契约不发明新业务事件总线。 |
| 明确后置 | 待办到期 / 审批 / 日程 / 全量业务总线 | 另开产品拍板，不随 2.1 首刀。                                                                                    |
| 可测辅助 | `employee.push.test`（提案名）        | 实现刀可先于 mention 接线，用于真机验收；**不等于**产品触发 MVP 变更。                                           |

## 平台范围

| 平台        | MVP                 | 说明                                                                          |
| ----------- | ------------------- | ----------------------------------------------------------------------------- |
| **iOS**     | **首刀**            | APNs 重绑到 **employee** 身份；消费本契约 + Wave 1 Router。                   |
| **Android** | 第二刀（tasks 2.2） | FCM **从零**；同一 employee registration 模型。                               |
| **macOS**   | 后置                | Stage 54 以本地 UNUserNotification 为主；远程 APNs 可另刀。                   |
| **Windows** | **不在 MVP**        | Stage 55 non-goal；无 Toast/WNS 实现假设；桌面继续已连接 + 本地通知直至另案。 |

## 凭据与环境（占位 · 非真实密钥）

员工 APNs **独立于** node 的 `OPENCLAW_APNS_*`。实现前须由 iOS/发布 owner 填实 **bundle id / APNs topic**（TBD）。

**提案 env 占位（待 owner 确认前缀；禁止写入真实密钥到仓库）：**

| 变量（提案）                        | 含义                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `OPENBOT_EMPLOYEE_APNS_KEY_ID`      | APNs key id                                                               |
| `OPENBOT_EMPLOYEE_APNS_TEAM_ID`     | Apple team id                                                             |
| `OPENBOT_EMPLOYEE_APNS_KEY_PATH`    | `.p8` 路径（或由密钥管理注入，不落库）                                    |
| `OPENBOT_EMPLOYEE_APNS_TOPIC`       | **员工 App** APNs topic（通常 = bundle id；**TBD**）                      |
| `OPENBOT_EMPLOYEE_APNS_ENVIRONMENT` | `sandbox` \| `production`（建议 Debug→sandbox，与现 node 约定对齐作起点） |

FCM（2.2）：**新建** Firebase 项目/服务账号（仓库当前无 FCM）；变量名在 Android 刀前由 gateway+android owner 写入本契约修订，不在本刀发明。

**SHALL NOT** 复用 node topic/registration 表「顺便」投员工；即便过渡期共用 Apple 开发者账号，**registration 存储与 topic 配置仍须员工隔离**。

## RPC 方法名族（提案 · 待 gateway owner 确认）

> 规格要求「新增按 employee 身份的注册与投递」。下列方法名 **已确认并落码**（gateway method pack；亦经 pack manifest 注册，不直接改 BASE_METHODS）。

| 方法                       | 方向                 | 语义                                                               |
| -------------------------- | -------------------- | ------------------------------------------------------------------ |
| `employee.push.register`   | client → gateway     | 登录态下登记 `{ accountId, deviceId, platform, token, … }`；upsert |
| `employee.push.unregister` | client → gateway     | 注销当前设备或指定 device；logout/switch 必调                      |
| `employee.push.test`       | client/ops → gateway | 向该账号已注册设备发一条测试 alert（含强制 `deepLink`）            |

**非客户端 RPC（实现内部）：** mention upsert 后的 enqueue / APNs|FCM adapter。名称与队列实现由 gateway owner 在实现 PR 自定，**不得**挤占 node `push.*` 命名空间语义。

**确认流程：** gateway owner 评论本契约或修订本表 → Daniel/spec 勾选确认 → 方可开实现 PR。

## 实现切片顺序（文档刀之后 · 另 PR）

1. **本刀（已做）：** `contracts/push-model.md` + requirements/tasks 决策表同步。
2. **服务端：** employee registration 存储（按 accountId[+device]）与 node APNs **隔离**；iOS APNs 发送；`employee.push.test`；mention enqueue。
3. **客户端首刀：** iOS 取 token → register；点击 payload.`deepLink` → 现有 Router；logout/switch → unregister。
4. **随后：** Android FCM（2.2）→ Mac 远程 →（另案）Windows。

## 验收（实现刀 · 真机）

1. 员工账号 iOS **离线/后台**收到 @mention 远程通知（alert）。
2. 点击 → auth-gate → 员工目标（深链 grammar）。
3. 同账号多设备均收到（若均已注册）。
4. logout/switch 后旧账号设备 **不再**收到该账号投递。
5. node `push.test` / `node.wake` 与员工 token **互不串**。
6. Actions 不可用则本地/真机记录；**禁止**无凭据假绿合入 main。

## 版本

| 版本 | 日期       | 说明                                                                                                                                                                |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1 | 2026-10-08 | 产品契约首版：Daniel 拍板 MVP（mention + iOS 首刀 + 多设备 + 独立凭据）；RPC 名为提案                                                                               |
| v0.2 | 2026-10-09 | 实现首刀：RPC 确认；gateway pack + employee registration store + mention enqueue；iOS register/unregister；无真实 APNs 凭据时 credentials-required，不声称 e2e 投递 |
