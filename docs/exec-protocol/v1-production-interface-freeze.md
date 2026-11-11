# 生产适配接口冻结（t134；t136 补齐）

2026-11-11 17:13 CST（Asia/Shanghai）。[#272](https://github.com/flykingvip-cloud/openbot-vp/pull/272) 已合入 `main` `de3464bb81202cba27e2302862e2f591a6cfcf09`，交付的是隔离协议；生产模式拒绝启用仍然有效。t135 独立审核结论为 PASS WITH GAPS。本文在原登记单上补齐最小形式化接口，作为后续分组开发的接口基准。本文不是生产启用，也不是解除门禁，不实现生产启用代码。解除任一生产门禁必须独立审核，禁止删除 `OPENBOT_PRODUCTION_EXECUTION_MODE` 或借用 `exec-protocol-v1-isolation` 上线。`NODE_ENV=production` 不等于生产启用。`OPENBOT_PRODUCTION_EXECUTION_MODE=production` 在生产剖面未实现或未齐备时必须继续拒绝启用，且不得回填隔离已签收值。

唯一负责人：`cursor-shuanggui-publish`（双规发布），任务 `prod-adapt-1plus3`。共享文件仍归原路径负责人，由本任务集成。隔离任务 `exec-protocol-v1-min-loop` 继续拥有 `src/exec-protocol/**`；`forbid-production-host-fallback` 继续拥有 `src/agents/sandbox/production-execution-mode.ts`。本任务新增生产剖面文档与后续生产专用文件，不抢占 `deploy/production/**`、`src/browser/**`、`account-computer-*.ts` 及其他已有路径。改动上述已有路径或隔离实现必须经既有 lander 协调集成，不得以「单独落地」提交。

未签收的生产超时、证书材料、监听地址、容量数字、RPO/RTO 不以隔离数值外推，本文也不编造这些取值。标 **待签收** 的项不得当作已批准参数编码进生产默认值。`assertExecProtocolIsolationOnly` 在代码落地并经独立审核前，仍应拒绝生产启用。

依据：`docs/exec-protocol/v1-field-freeze.md`、`docs/exec-protocol/v1-reconcile-and-retry-freeze.md`、`src/exec-protocol/types.ts` 已冻结隔离目录，以及设计包 `16-生产设计冻结补件.md`。

## 1. 生产错误码表与 HTTP 映射

生产剖面沿用隔离目录（`EXEC_ERROR_CODES` / `HTTP_STATUS_BY_ERROR`），并显式扩展一项容量拒绝码。认证失败、撤销、版本不支持、不可达、容量拒绝、成果校验失败必须分码。**禁止把认证失败记成 `EXEC_UNREACHABLE`。** 未列入的错误码不得使用。

| 错误码 | HTTP | 生产语义 | 调用方动作 |
| --- | --- | --- | --- |
| （成功，新受理） | 201 | 与隔离相同 | 记录 `taskId` |
| （成功，幂等命中或查询/取消/回传成功） | 200 | 与隔离相同 | 以返回状态为准，不新开任务 |
| `EXEC_VERSION_UNSUPPORTED` | 400 | 缺失、非整数或不为已承认版本 | 失败，不得降级到 A 本机执行 |
| `EXEC_UNAUTHORIZED` | 401 | 未认证、证书无效/过期/不受信、租户授权不匹配、身份材料缺失或时钟超差 | 拒绝；未认证不得区分任务是否存在；不得改在 A 本机执行 |
| `EXEC_REVOKED` | 403 | 范围已撤销，或证书/授权已被明确撤销 | 不得新提交；在途按第 4 节取消语义处理 |
| `EXEC_NOT_FOUND` | 404 | 已认证但任务不在本租户范围或不存在 | 不得泄漏他户 |
| `EXEC_CONFLICT` | 409 | 幂等键冲突、对账版本冲突等 | 先查询再对账，不得换键强开 |
| `EXEC_CAPACITY_REJECTED` | 429 | **生产扩展**：任一容量层已达限且不能再排队 | 明确拒绝；不得 silently 在 A 执行；不得记成 `EXEC_UNREACHABLE` |
| `EXEC_CHECKSUM_MISMATCH` | 422 | 成果 hash 或字节数不一致 | 不得 `succeeded`，不得交付 |
| `EXEC_UNREACHABLE` | 503 | B 不可达：连接失败、无 HTTP 响应、请求超时（握手尚未完成的传输失败） | A 失败并暂停新执行；不得 host 回落，不得改走旧香港网关 |
| `EXEC_INTERNAL` | 500 | 内部错误 | 记入 `failed` 或 `result_unconfirmed`（按第 5 节） |

分类禁令：

- 证书无效、过期、不受信、主体/SAN 不匹配、租户授权不匹配 → `EXEC_UNAUTHORIZED` 或（已明确撤销时）`EXEC_REVOKED`，不得记成 `EXEC_UNREACHABLE`。
- 对端无响应、连接被拒绝、路由不可达、握手前超时 → `EXEC_UNREACHABLE`。
- 客户端在对端无 HTTP 响应时，本地只可归类为 `EXEC_UNREACHABLE`；一旦对端已返回认证/撤销/版本错误，必须保留原码。
- 不开放未加密 Docker API（含 `2375`）作为生产接口；若误配为该接口，视为配置缺失，拒绝启用，不得把它当作可达的执行通道。

## 2. 版本规则

- 生产剖面与隔离剖面共用字段名 `exec-api-version`（JSON 整数）。生产协议版本为 `1`，与隔离字段编号一致。这只表示编号相同，**不**表示隔离超时、绑定、租约或重试数值已被批准为生产值。
- 请求与响应必带 `exec-api-version`。缺失、非整数或不为 `1` → `EXEC_VERSION_UNSUPPORTED`，必须失败，不得协商降级，不得改在 A 本机执行。
- 一个进程只加载一个剖面：`exec-protocol-v1-isolation` 或 `exec-protocol-v1-production`。请求生产执行模式时不得加载隔离剖面，也不得把隔离已签收值写入生产配置。
- 隔离节点与生产节点不得混用已签收数值（绑定、超时、重试、租约格式、时钟偏差）。未来多版本兼容矩阵仍为 **待签收**，不得预先实现「尽量兼容」。

## 3. 生产配置 / 剖面类型

剖面名：`exec-protocol-v1-production`。配置必须显式提供下列字段；任一缺项或为空 → 拒绝启用（配置错误，不启动协议）。**禁止**从 `ISOLATION_SIGNED_VALUES`、隔离环境变量或测试夹具回填。环境变量具体名称 **待签收**；即使将来与隔离键同名，也不得把隔离已签收值当作生产缺省。

| 字段 | 类型形状 | 取值 |
| --- | --- | --- |
| `profileName` | `"exec-protocol-v1-production"` | 必须为此字面量 |
| `execApiVersion` | `1` | 见第 2 节 |
| `bind` | 非空字符串 | **待签收**。不得预先签收隔离回环 `127.0.0.1` / `::1` / 端口 `18790` 为生产默认 |
| `port` | 整数 1–65535 | **待签收** |
| `mutualAuth` | 见下 | 材料本身 **待签收**；缺项拒绝启用 |
| `connectTimeoutMs` / `requestTimeoutMs` / `executionTimeoutMs` | 正整数（毫秒） | **待签收**。隔离值 3000 / 5000 / 60000 不得外推 |
| `maxTransportRetries` / `transportBackoffMs` | 正整数；非负整数序列 | **待签收**。隔离「含首次共 3 次、退避 200,400」不得外推。重试范围仍仅限查询、取消通知、成果字节；不得对未对账的外部操作自动重跑 |
| `cancelDeadlineMs` / `idempotencyTtlMs` / `maxClockSkewMs` | 正整数；时钟偏差为非负整数 | **待签收**。隔离值 10000 / 86400000 / 30000 不得外推 |
| `tenantAuthSource` | 显式来源描述（见第 4 节） | 来源与表示方式 **待签收** |
| `capacity` | 三层上限，见第 6 节 | 数字 **待签收**；缺项拒绝启用。不得使用 `PROTOTYPE_MAX_CONCURRENT=8` 或隔离测试并发 |

`mutualAuth` 必填形状（取值全部 **待签收**，不得编造证书材料）：

- `scheme`：候选为 `mtls`，或经独立签收的等价双向认证。SSH 转发、隔离回环不是生产认证。
- 必须具备：信任锚、A 客户身份、B 服务身份、主体 / SAN 校验规则、轮换重叠窗口。窗口结束前可回退旧证书；窗口结束后旧证书不得再被接受。
- 生产身份不得复用隔离回环或 SSH 转发，不得与香港公网 TLS 证书混用，不得在 A/B 之间复制生产证书或令牌。

`tenantAuthSource` 必须指出授权材料从何处读取（例如证书属性、独立令牌入口）。表示方式候选（租约 ID、短时令牌、证书属性）仍为 **待签收**。隔离 `exec1_` + 64 位十六进制不得直接定为生产格式。

加载顺序：先检查生产门禁；再校验本剖面必填项；缺项或门禁未解除则拒绝启用，不得部分降级为隔离模式。

## 4. 授权与撤销接口

每个 `submit` / `status` / `cancel` / 成果回传（含上传）必须携带 `tenantId`、`userId`；若任务所属存在 `agentId`，则必须携带。缺 `tenantId` 或 `userId` 视为请求不完整，拒绝执行。B 必须校验范围，拒绝越权读写工作区、成果或浏览器目录。双向认证只证明「调用者是已登记的 A」，不能代替租户授权。

不得把香港 `x-forwarded-user` 在未受控边界直接注入 A/B。

撤销范围与隔离 `ExecRevocationScope` 对应：

| 生产范围 | 字段 | 隔离对应 |
| --- | --- | --- |
| 租户 | `{ tenantId }` | `tenantId` |
| 账号 | `{ tenantId, userId }` | `subject` 映射为该账号主体；生产请求以 `userId` 为账号标识 |
| 单任务 | `{ tenantId, taskId }` | `taskId` |

生效点：

- 撤销立即对该范围内的**新**提交返回 `EXEC_REVOKED`（403）。
- 进行中的任务遵循已冻结取消语义（`docs/exec-protocol/v1-field-freeze.md`、`v1-reconcile-and-retry-freeze.md`）：进入 `cancel_requested`；B 须在已签收的取消时限内停跑并到 `cancelled`；超时未确认则 `result_unconfirmed`，仍不得重启。生产取消时限数值 **待签收**，不得套用隔离 10000 ms。
- 不得自动改写终态（`succeeded` / `failed` / `cancelled`）。`result_unconfirmed` 禁止自动重试，离开该状态只能经已冻结对账入口。
- 生产撤销的审计流程、传播时限数值仍为 **待签收**；未签收前不得把「立即拒收新请求 + 在途按取消处理」减弱。

现有隔离端点 `/v1/revoke` 可作为后续生产剖面的路径候选，但生产身份材料与授权表示未签收前不得当作已启用的生产撤销服务。

## 5. 能力状态与失败闭合

能力状态与网关 `/healthz`、`/readyz` 分开。查询入口冻结为执行协议监听上的 `GET /v1/capability`（A 与 B 均提供；A 的应答必须反映 B 的执行能力，而不是网关存活）。请求与响应必带 `exec-api-version`。

枚举 `ExecCapabilityStatus`：

| 值 | 含义 |
| --- | --- |
| `available` | 已启用且 B 可接受新执行 |
| `unavailable` | 不可接受新执行（B 不可达、门禁未解除、挂载保护失败、生产剖面未启用等） |
| `degraded` | 执行通道仍可能可用，但已声明的附属能力失败（如云电脑重连失败），必须明确降级，不得冒充成功 |

响应形状：`{ "exec-api-version": 1, "status": ExecCapabilityStatus, "reason"?: string }`。`unavailable` 时入口（A 网关）可继续存活，但不得接收新的执行任务并冒充成功。生产未启用时必须报告 `unavailable`，不得报告 `available`。

任务状态 `failed` 与 `result_unconfirmed`（沿用已冻结状态机，不新增终态）：

| 状态 | 使用条件 | 重试 |
| --- | --- | --- |
| `failed` | 可确认未产生外部副作用的执行失败，或已确认的执行失败（含容量拒绝后未开跑、认证/撤销拒绝未开跑、目录互斥未写入） | 不得自动改在 A 重跑；是否允许调用方按新幂等键再提交 **待签收**，默认不得自动重开 |
| `result_unconfirmed` | 超时、断线或取消超时，且无法对账确认终态或副作用 | **禁止自动重试**；不得标 `succeeded`；只能通过对账入口离开 |

不可达、认证失败、容量拒绝、成果校验失败都必须是明确失败或待核实，禁止回落到 A 或旧香港网关。

## 6. 容量准入

三层独立限流，字段均在 `capacity` 中显式配置，缺项拒绝启用：

- `globalLimit`：B 全局上限
- `tenantLimit`：每租户上限
- `accountOrTaskLimit`：账号或任务上限
- `queueLimit`（可选分项）：各层可排队深度

以上数字全部 **待签收**。不得使用 `PROTOTYPE_MAX_CONCURRENT=8` 或隔离测试并发。

排队或拒绝（在数字签收后执行；规则本身冻结）：

1. 取三层各自「运行中 + 已排队」占用，与该层上限比较；以最紧的一层为准。
2. 若三层均有空闲运行名额 → 接受（按状态机进入 `accepted` / `queued` / `running`）。
3. 若无运行名额，但三层在已配置的 `queueLimit` 内仍有空位 → 进入 `queued`，等待，不得改在 A 执行。
4. 若任一层已达运行+排队上限，或未配置排队且无运行名额 → 拒绝，返回 `EXEC_CAPACITY_REJECTED`（429）。不得 silently 在 A 执行，不得记成 `EXEC_UNREACHABLE`。
5. `queueLimit` 未配置时不得发明默认排队深度；若只有三层运行上限，满额即拒绝。

配额释放（崩溃 / 取消 / 重启后必须释放，且幂等）：

- 权威计数来自已持久化的任务记录，不得只靠会泄漏的内存计数器。
- A 控制面是 `accepted` / `queued` 占用的权威；B 是实际 `running` 执行槽位的权威。重启后从存储重算，不对账成功前不得多发新任务冒充成功。
- 任务进入终态（`succeeded` / `failed` / `cancelled`）立即释放该槽。`result_unconfirmed` 在对账结案前仍占用，避免重复开跑；结案后释放。取消到达 `cancelled` 或因取消超时进入 `result_unconfirmed` 时，运行槽按上句处理，排队槽必须释放。
- 本接口是状态与计数契约，不是新的对外执行入口。

## 7. P3 / P5 集成契约

P3 与 P5 只做集成，不改 `src/browser/**`、`account-computer-*.ts`、`deploy/production/**` 的所有权，不写 `releases.jsonl`，不改香港回源。

**登录目录互斥失败形态：** 同一浏览器用户目录不得由新旧实例同时写入。后到者必须失败退出，不得并行打开。失败形状：

```text
{
  "code": "BROWSER_LOGIN_DIR_IN_USE",
  "path": "<user-data-dir>",
  "holder": "<已有实例标识，若可知>"
}
```

该码不属于第 1 节执行协议目录，不得记成 `EXEC_UNREACHABLE`。若发生在尚未产生外部副作用之前，对应执行任务记 `failed`（可附此 `code`），不得标 `succeeded`。被引用的浏览器目录不得当可删对象。

**重发现：** 切后云电脑只在 B 上开启。重发现必须使用已登记的跨主机地址与身份，**不得用 `127.0.0.1` 冒充跨机**。代理与重连失败时能力状态可为 `degraded`，功能明确降级，不得回退到 A 宿主或香港网关本地浏览器。

**发布组合记录字段**（每次发布前从当时实际运行的 A/B 与香港配置采集，不能只凭上次发布记录；B 未更新也要记录实版）：

| 字段 | 含义 |
| --- | --- |
| `recordedAt` | 采集时间，UTC RFC3339 |
| `aDigest` | 当时 A 实际镜像 digest（`sha256:…`） |
| `bDigest` | 当时 B 实际镜像 digest（`sha256:…`） |
| `aActualVersion` | 当时 A 实际运行版本（产品与精确版本，按现场采集） |
| `bActualVersion` | 当时 B 实际运行版本；即使本轮未更新 B 也必须写入 |
| `source` | 必须标明来自现场采集，而不是上次账本复述 |

具体版本字符串与 digest 以现场为准，本文不编造。本任务只定义记录形状并做集成，不写 `releases.jsonl`，不改香港回源；那两项仍须单独放行。日常更新在 A 内替换容器；香港保持指向 A 的受控入口。

## 8. 落地说明

- 改 `src/exec-protocol/**` 必须与任务 `exec-protocol-v1-min-loop` 的 lander 协调集成。
- 改 `src/agents/sandbox/production-execution-mode.ts` 必须与任务 `forbid-production-host-fallback` 的 lander 协调集成。
- 同一负责人不等于同一落地任务。不得以「单独落地」把生产适配改动直接打进隔离任务路径，或绕过指定 lander，或关闭检查，或提交他人未完成内容。
- 后续骨架 PR 可以新增仍拒绝启用的生产类型，但必须保持 `OPENBOT_PRODUCTION_EXECUTION_MODE=production` 拒绝启用，且不得把隔离已签收值当作生产默认。解除门禁须分项独立审核。
- `.loom/registry.yaml` 如需再改，只允许外科手术式追加、零删除其他任务，并由指定所有者协调；禁止运行 `loom register` 后提交全文件重写。本补齐不修改该文件。

## P1–P5 模块边界（沿用，受上面第 1–8 节约束）

### P1 A→B 双向认证、租户授权与撤销

入口：A 为客户端，B 为服务端，必须双向认证。任一方证书无效、过期、已撤销或租户授权不匹配时，请求失败（`EXEC_UNAUTHORIZED` 或 `EXEC_REVOKED`），不执行。B 不可达返回 `EXEC_UNREACHABLE`。两类错误不得合并。其余见第 1、3、4 节。

### P2 生产配置校验、执行能力状态与失败闭合

见第 3、5 节。配置加载必须先检查生产门禁。

### P3 云电脑代理、重发现与登录目录互斥

见第 7 节。现有云电脑生命周期与浏览器目录实现仍归原路径负责人。

### P4 全局／租户／账号容量准入

见第 6 节。

### P5 A/B 部署定义、发布组合记录与发布工具

见第 7 节。现有 `deploy/production/**` 仍归原路径负责人。

## 分组与集成

| 组别 | 接口 | 开发负责人 | 共享或相邻路径 |
| --- | --- | --- | --- |
| P1 | 双向认证、租户授权、撤销 | cursor-shuanggui-publish | `src/exec-protocol/**` 仍由 `exec-protocol-v1-min-loop` 拥有；同负责人 ≠ 单独落地 |
| P2 | 生产配置校验、能力状态、失败闭合 | cursor-shuanggui-publish | `src/exec-protocol/**`，`src/agents/sandbox/production-execution-mode.ts`（后者仍由 `forbid-production-host-fallback` 拥有） |
| P3 | 云电脑代理、重发现、目录互斥 | cursor-shuanggui-publish（集成） | `src/browser/**`、`src/agents/sandbox/account-computer-*.ts` 仍归原负责人 |
| P4 | 三层容量准入 | cursor-shuanggui-publish | 新生产配置入口；不得覆盖既有计费席位实现，除非与原负责人集成 |
| P5 | 部署定义与发布组合 | cursor-shuanggui-publish（集成） | `deploy/production/**` 仍归原负责人；不写 ledger |

下一步：按上表分组实现，先补生产剖面的类型与校验骨架（默认仍拒绝启用），再逐项提独立审核。香港回源、生产数据迁移与 ledger 写入，仍须在候选与恢复方案齐备后单独放行。
