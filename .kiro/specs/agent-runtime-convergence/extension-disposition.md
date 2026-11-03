# M0 扩展执行面与去留清单

基线：`2ea87d9d6fbafa6384710ca65931b83c86fdf871`。Owner：codex-runtime-manager；Contributor：runtime-extension-audit。

范围：源码只读审计；未加载扩展、未运行脚本、未读取/输出配置秘密。有效生产配置未知。以下为架构治理分类，不是漏洞定性或删除授权。

## 判别标准

检查谁持有计划、选择下一步、维护重试/恢复状态、启动子运行、宣布完成。正常原子工具和初始化不能因使用 spawn 就认定第二执行器。路径边界仅约束代码从哪里加载，不约束加载后的控制能力。

## 证据与处置

| 执行面              | 配置→加载→调用证据                                                                                                                                                | 默认/有效启用                                                           | 控制权与处置建议                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 内部 hooks          | `src/config/types.hooks.ts` module；`src/hooks/loader.ts:51` enabled 门，`:94`/`:174` import，`:116`/`:188` 注册                                                  | internal.enabled 缺省不进入；生产未知                                   | 可执行宿主事件逻辑。迁受审查扩展 ID；纯观测保留，任务控制迁原主线                                          |
| Webhook transform   | `src/gateway/hooks-mapping.ts:172–182` load/call/mergeAction，`:364` importFileModule                                                                             | 需显式 transform；生产未知                                              | 可执行动作改写。纯转换改声明式；复杂转换迁受审查适配器，不持有主任务恢复状态                               |
| 插件 hooks/services | `src/plugins/types.ts:292` hook、`:299` Gateway method、`:301` service；`src/plugins/registry.ts:110–118`；`src/plugins/services.ts:58` start                     | 安装与加载决定；生产未知                                                | 服务生命周期与事件改写。保留能力插件，声明副作用和取消；任务控制权回收核心，不删除全部插件                 |
| Lobster             | `extensions/lobster/src/lobster-tool.ts:72` spawn，`:185–189` pipeline→run，`:215` workflow runtime；envelope resumeToken                                         | `extensions/lobster/index.ts:11` sandbox 排除、`:16` optional；调用未知 | 明确外部工作流、审批与恢复。作为受控子工作流迁移或候选退役，先查消费者和恢复令牌，不能当原子工具隐藏控制权 |
| OpenProse           | `extensions/open-prose/index.ts` 仅分发 skills；`extensions/open-prose/skills/prose/SKILL.md:9` 模型模拟 VM，`:13` Task→sessions_spawn，`:252` session 触发子会话 | 装载/使用未知                                                           | 提示词驱动的编排运行时。迁为核心计划输入或候选退役；Skill 不自授调度权，先确认用户资产替代                 |
| BOOT.md             | `src/hooks/bundled/boot-md/handler.ts` startup→runBootOnce；`src/gateway/boot.ts:35` 文件、`:138` runBootOnce、`:174` agentCommand                                | hook/文件/启动条件决定；生产未知                                        | 原执行器的隐式启动入口。保留启动适配，任务登记来源、身份和审计，不允许隐藏主计划                           |
| CLI Agent backend   | `src/config/types.agent-defaults.ts` cliBackends/command；`src/agents/cli-runner.ts:328` supervisor.spawn                                                         | 供应商/配置决定；未知                                                   | 区分纯推理提供者与带工具的委派运行时；核实内部重试、状态和权限后受控适配                                   |
| 媒体/链接 CLI       | `src/link-understanding/runner.ts:68` runExec(command,args)；media runner CLI 分支                                                                                | 配置和环境探测；未知                                                    | 原子能力候选，保留并注册取消/超时/输出验证，禁止业务规则任意指定控制脚本                                   |
| Secret exec         | `src/secrets/resolve.ts:462` spawn                                                                                                                                | 显式 exec provider；未知                                                | 凭据基础设施适配，保留在可信运维域，不向业务规则开放任意执行                                               |
| Pi 设置             | `src/agents/pi-project-settings.ts:7` shellPath/shellCommandPrefix，`:25` policy                                                                                  | 默认 sanitize；trusted 放开；生产未知                                   | 执行行为覆盖，非独立循环；trusted 单列特权来源，不能由任务材料切换                                         |

## task-orchestration 的独立只读分支

不能将整个目录判为“默认关闭、绝不执行”。`src/task-orchestration/types.ts:22` 的 LIVE_INVOKE=false 限制另一调度分支；`feature.ts` 四个编排开关默认关闭，但 `OPENBOT_ORCH_READONLY_INVOKE` 独立且默认开启。`dispatch.ts:326` 查只读开关，`:352–354` 加载并调用 invokeReadonlySurface。

`gateway-hook.ts` 的不 invoke 不能推广到整个目录；complex-task-loop 也含结果整形/验收，不因名字有 loop 就认定第二执行器。

建议拆分归属：只读获取→上下文/能力；路由判断→公共策略；执行请求→原主线；结果核验→交付。生产触发链、资源范围、副作用待实证，不整目录删除。

## 有效运行清单与退役门槛

- 代码存在、默认启用、实际加载、实际调用四级证据分开；本次只完成前两级源码证据。
- 后续只提取扩展 ID、来源、开关、哈希、触发、控制权、消费者及取消恢复方式，不输出凭据。
- 退役先查消费者、持久化状态与恢复资产；没有证据标待核实，不静默删除。
- 替代路径须保留任务/消息/运行身份、授权、取消、预算及交付回执。
- 对照可双读，禁止双发业务动作；旧决定权退场必须有事件序列证明。
- 能力仅返回结果，事件只传事实，不允许任意监听者推进主任务。
- 每项清理独立可回退，配置和旧资产迁移有兼容说明。

配置最终仅声明数据、规则与注册能力 ID；可执行代码归受审查模块。本文不批准停用任何入口。

材料完成；产品和运行配置未改。— runtime-extension-audit
