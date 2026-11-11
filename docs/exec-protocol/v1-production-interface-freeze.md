# 生产适配接口冻结（t134）

2026-11-11 16:46 CST（Asia/Shanghai）。[#272](https://github.com/flykingvip-cloud/openbot-vp/pull/272) 已合入 `main` `de3464bb81202cba27e2302862e2f591a6cfcf09`，交付的是隔离协议；生产模式拒绝启用仍然有效。本文只冻结后续生产适配的模块接口，不是生产启用，也不是解除门禁。解除任一生产门禁必须独立审核，禁止删除 `OPENBOT_PRODUCTION_EXECUTION_MODE` 或借用 `exec-protocol-v1-isolation` 上线。`NODE_ENV=production` 不等于生产启用。

唯一负责人：`cursor-shuanggui-publish`（双规发布）。共享文件仍归原路径负责人，由本任务集成。隔离任务 `exec-protocol-v1-min-loop` 继续拥有 `src/exec-protocol/**`；本任务新增生产剖面文档与后续生产专用文件，不抢占 `deploy/production/**`、`src/browser/**` 及其他已有路径。

未签收的生产超时、证书期限、监听地址不以隔离数值外推。接口先冻结，再分组开发。

## P1 A→B 双向认证、租户授权与撤销

- 入口：A 作为客户端，B 作为服务端，必须双向认证；任一方证书无效、过期、已撤销或租户授权不匹配时，请求失败，不执行。
- 身份：生产身份不得复用隔离回环或 SSH 转发；不得把香港 `x-forwarded-user` 在未受控边界直接注入 A/B。
- 租约：生产租约表示待签收；隔离 `exec1_` + 64 位十六进制不得直接定为生产格式。
- 撤销：撤销立即拒绝新请求；进行中的执行按已冻结取消语义结束，不自动改写终态。
- 失败：B 不可达或认证失败返回明确错误（沿用 `EXEC_UNREACHABLE` 或等效生产错误码），A 不得改在本机执行。

## P2 生产配置校验、执行能力状态与失败闭合

- 配置加载必须先检查生产门禁：`OPENBOT_PRODUCTION_EXECUTION_MODE=production` 在生产剖面未齐备时拒绝启用，不回填隔离已签收值。
- 生产剖面必须显式提供：绑定地址与端口、双向认证材料、超时与重试、租户授权来源。缺项拒绝启动。
- 执行能力状态与网关 `/healthz`、`/readyz` 分开；B 不可用时能力状态为不可用，入口可继续存活，但不得接收新的执行任务冒充成功。
- 失败闭合：不可达、认证失败、容量拒绝、成果校验失败都必须是明确失败或待核实，禁止回落到 A 或旧香港网关。

## P3 云电脑代理、重发现与登录目录互斥

- 现有云电脑生命周期与浏览器目录实现仍归原路径负责人；本任务只定义 1+3 约束并做集成。
- 切后云电脑只在 B 上开启；重发现不得依赖 `127.0.0.1` 冒充跨机。
- 同一浏览器用户目录不得由新旧实例同时写入；争用时后到者必须失败退出，不得并行打开。
- 代理与重连失败时功能明确降级，不得回退到 A 宿主或香港网关本地浏览器。

## P4 全局／租户／账号容量准入

- 三层独立限流：B 全局上限、租户上限、账号或任务上限。超限排队或拒绝，不得 silently 在 A 执行。
- 崩溃、取消、进程重启后配额必须释放。
- 不得把 `PROTOTYPE_MAX_CONCURRENT=8` 或隔离测试并发当作生产全局保护。
- 具体数字待签收；接口先接受显式配置，缺项时生产模式拒绝启用。

## P5 A/B 部署定义、发布组合记录与发布工具

- 现有 `deploy/production/**` 仍归原路径负责人；本任务定义 1+3 组合记录要求并集成，不直接改账本。
- 日常更新在 A 内替换容器；香港保持指向 A 的受控入口，不反复改回源，不重新迁移全部数据。
- 发布包以 digest 固定 A/B 组合；B 未更新也要记录实版。
- 每次发布前从当时实际运行的 A/B 与香港配置确认基线，不能只凭上次发布记录。
- 本任务不写 `releases.jsonl`，不改香港回源；那两项仍须单独放行。

## 分组与集成

| 组别 | 接口 | 开发负责人 | 共享或相邻路径 |
| --- | --- | --- | --- |
| P1 | 双向认证、租户授权、撤销 | cursor-shuanggui-publish | `src/exec-protocol/**`（已由 `exec-protocol-v1-min-loop` 拥有，同负责人） |
| P2 | 生产配置校验、能力状态、失败闭合 | cursor-shuanggui-publish | `src/exec-protocol/**`，`src/agents/sandbox/production-execution-mode.ts` |
| P3 | 云电脑代理、重发现、目录互斥 | cursor-shuanggui-publish（集成） | `src/browser/**`、`src/agents/sandbox/account-computer-*.ts` 仍归原负责人 |
| P4 | 三层容量准入 | cursor-shuanggui-publish | 新生产配置入口；不得覆盖既有计费席位实现，除非与原负责人集成 |
| P5 | 部署定义与发布组合 | cursor-shuanggui-publish（集成） | `deploy/production/**` 仍归原负责人；不写 ledger |

下一步：按上表分组实现，先补生产剖面的类型与校验骨架（默认仍拒绝启用），再逐项提独立审核。
