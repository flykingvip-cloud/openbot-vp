# OpenBot 能力安装治理返工问题清单

## 验收结论

当前 Phase 1 到 Phase 5 不能按完成态验收。

主要问题不是“没有代码”，而是多条关键链路仍停留在 stub 或局部演示状态：目标机器人安装落点丢失、安装没有写入真实运行时绑定、Da Bai 代理没有进入统一安装服务、企业脱敏提交与平台审核没有共享同一条数据链。

## 返工目标

返工后必须满足这些不变量：

1. 员工从某个机器人发起安装时，安装必须落到该目标机器人。
2. Da Bai 只能发送安装请求，不能直接替目标机器人绑定能力。
3. 机器人自装必须复用统一安装治理链路。
4. 安装状态、配置状态、治理状态必须分离并可追踪。
5. 企业资产未完成脱敏时不得提交平台。
6. 企业提交与平台审核必须读写同一份提交记录。

## P0 必须返工

| 编号 | 问题                                                     | 证据                                                                                                                                                                                                                  | 影响                                                     | 返工动作                                                                                                                                       | 验收标准                                                                                                                                                                    |
| ---- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | 员工点击某个机器人“安装能力”后，目标机器人 ID 被丢弃     | `ui/src/ui/ports/employee/render-model.ts:3636` 忽略 `_robotId`；后续安装使用 `state.assistantAgentId ?? "main"`，见 `ui/src/ui/ports/employee/render-model.ts:3414`、`ui/src/ui/ports/employee/render-model.ts:3433` | 安装落点可能错误，违背“安装最终落到目标机器人”的核心原则 | 在员工端状态中保存当前安装目标机器人；所有 `employee-install.*` 请求必须携带该目标机器人 ID；禁止回退到默认 `main`，除非用户明确选择默认机器人 | 从“销售助手”点击安装时，RPC payload 中 `targetRobotId` 必须是销售助手 ID；安装历史、运行时绑定、企业事件都指向同一目标机器人                                                |
| P0-2 | 员工安装确认后没有写入真实运行时绑定                     | `src/gateway/server-methods/employee-install.ts:333` 只更新 `stubInstallRequests`；没有调用真实 store 或 runtime binding 同步                                                                                         | UI 显示安装成功，但机器人运行时不会真的拥有该能力        | 将 `employee-install.confirm` 接入真实安装服务；写入安装请求记录、运行时绑定、员工资产记录和企业治理事件                                       | 安装确认后可在 `agent-runtime.list-bindings` 查到目标机器人对应 binding，且 binding 带有 `installRequestId`、`tenantInstallSource`、`configurationState`、`governanceState` |
| P0-3 | 现有运行时同步会选租户下任意健康 agent，而不是目标机器人 | `src/gateway/runtime-binding-sync.ts:57` 从 tenant agents 中选 deployed/healthy runtime agent                                                                                                                         | 即使接入同步，也可能装到错误机器人                       | 修改同步接口，强制接收 `targetRobotId` 或 `runtimeAgentId`；只允许写入该目标机器人对应 runtime；找不到目标 runtime 时返回明确错误              | 对同一租户下两个机器人安装同一能力时，只目标机器人新增 binding，另一个机器人不受影响                                                                                        |
| P0-4 | Da Bai 代理和机器人自装请求没有进入统一安装服务          | `src/gateway/server-methods/agent-install-request.ts:166` 接受后只把状态改为 `installing`                                                                                                                             | Phase 2 只有请求状态机，没有真实安装闭环                 | `agent-install.request-accept` 应创建或转入统一 `employee-install` 安装请求；目标机器人审核通过后继续执行风险、配置、安装、绑定流程            | Da Bai 发送请求后，目标机器人接受，最终能在目标机器人 runtime binding 中看到能力；请求记录可追溯到 binding                                                                  |
| P0-5 | 企业提交平台没有校验脱敏状态                             | `src/gateway/server-methods/enterprise-capability.ts:1935` 只要有 `capabilityId` 就返回 submitted                                                                                                                     | 违反“未经脱敏不得上平台”的硬约束                         | 为企业脱敏建立持久会话和 sanitized package；`submit-to-platform` 必须校验会话完成、无未解决 finding、已生成通用能力包                          | 未执行 `sanitization-confirm` 或仍有 unresolved findings 时，`submit-to-platform` 必须失败                                                                                  |
| P0-6 | 企业提交与平台审核不是同一条数据链                       | `enterprise-capability.submit-to-platform` 返回临时 `submissionId`；`platform-capability.enterprise-submissions` 读取 `stubEnterpriseSubmissions`                                                                     | 企业端提交后，平台端看不到真实提交                       | 建立共享 submission store；企业端提交写入该 store；平台端列表、详情、发布、拒绝都读写该 store                                                  | 企业端提交后，平台端 `platform-capability.enterprise-submissions` 能查到同一个 `submissionId`                                                                               |

## P1 应返工

| 编号 | 问题                                            | 证据                                                                                                  | 影响                                             | 返工动作                                                                                                          | 验收标准                                                                               |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1-1 | “我的资产”承担了实际安装操作面                  | `ui/src/ui/views/my-accumulation.ts:554` 提供三类安装按钮                                             | 产品职责偏移，削弱“我的机器人是主安装入口”的设计 | 将“我的资产”中的安装动作降级为记录视图或“安装到其他机器人”二级动作；主安装流程从 `My Robots` 发起并携带目标机器人 | 新安装主路径必须从机器人卡片或机器人详情进入；资产详情只做历史、配置、复用和上行       |
| P1-2 | 安装配置项未形成首次使用阻断                    | `employee-install.confirm` 可进入 `pending-configuration`，但没有和机器人调用权限/运行时 binding 联动 | 待配置能力可能被误认为可用                       | 对 `configurationState: "pending"` 的 binding 设置不可调用或 disabled/warming 状态；机器人调用时返回“待配置”原因  | 未配置能力不能被机器人实际调用；配置完成后状态转为可用                                 |
| P1-3 | 企业治理事件是静态 stub，不由真实安装行为产生   | `src/gateway/server-methods/enterprise-capability.ts:1743` 返回固定事件                               | 企业端无法治理真实员工安装行为                   | 安装、卸载、限制、禁用、外部归档等动作统一写入 governance event store                                             | 员工安装外部能力后，企业治理事件列表出现对应事件，含员工、目标机器人、来源、风险与状态 |
| P1-4 | 外部/本地扫描结果没有影响后续安装决策           | `employee-install.scan-external` 和 `preview-risk/create-request` 分离，没有共享扫描记录              | 高风险能力仍可绕过扫描直接创建请求               | 外部/本地安装必须引用有效 scan result；高风险或 block 推荐不得直接安装                                            | 未扫描外部能力时创建请求失败；扫描为 block 时 confirm 失败或进入送审                   |
| P1-5 | 平台发布没有接入 capability governance registry | `platform-capability.publish-enterprise-capability` 只更新 stub submission 状态                       | 平台“发布成功”后市场/registry 不会出现能力       | 发布时创建或更新 `capability-governance` registry/proposal 记录，保留企业来源与 sanitized package provenance      | 发布后平台能力市场或 governance registry 可查到新能力                                  |
| P1-6 | 新模型字段未完整投影到业务视图                  | `tenantInstallSource`、`installRequestId` 只在类型和部分测试中出现，实际投影使用有限                  | UI 无法准确解释安装来源、配置和治理状态          | 更新 employee、enterprise、runtime projection，统一展示来源、请求追踪、配置状态和治理状态                         | 员工资产详情、企业机器人视图、运行时详情三处能看到一致状态                             |

## P2 建议返工

| 编号 | 问题                                          | 证据                                                                                             | 影响                               | 返工动作                                                                  | 验收标准                                                     |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| P2-1 | 测试主要覆盖 stub 返回，缺少跨模块闭环测试    | 当前新增测试只验证 handler 本身返回                                                              | 容易出现“测试绿但产品链路断”的情况 | 增加集成测试覆盖员工安装到 runtime、Da Bai 请求到安装、企业提交到平台审核 | 至少覆盖 6 条端到端场景，并验证真实 store 状态               |
| P2-2 | 状态命名存在两套风格                          | gateway 模型使用 `not-required`，早期设计文档和部分 UI 使用 `not_required` 风格                  | 后续接入容易出现映射错误           | 统一状态命名，或集中提供 mapper，避免各层自行转换                         | 类型、RPC payload、UI projection 使用同一套枚举或显式 mapper |
| P2-3 | 平台审核缺少“退回修改”和“enterprise-only”实现 | `platform-capability.ts` 仅有 publish/reject                                                     | 不满足 Phase 4 的审核分支          | 补充 return-for-modification、enterprise-only action 和状态迁移           | 平台审核支持发布、拒绝、退回修改、仅企业内使用四种结论       |
| P2-4 | 企业脱敏 finding 不可逐项处理                 | `sanitization-confirm` 只统计 replacements 数量                                                  | 不能审计每个敏感项如何处理         | 保存 finding、replacement、resolved 状态和 operator 信息                  | 每个 finding 可追踪原字段、替换值、处理人、处理时间          |
| P2-5 | 员工安装体验仍使用 `confirm/alert`            | `ui/src/ui/ports/employee/render-model.ts:3426`、`ui/src/ui/ports/employee/render-model.ts:3441` | 体验粗糙，难以展示复杂风险和配置项 | 替换为正式安装确认、风险提示、配置弹窗或面板                              | 风险项、权限、配置项在 UI 中结构化展示，不依赖浏览器弹窗     |

## 推荐返工顺序

1. 修复目标机器人 ID 丢失，确保所有安装请求都携带真实目标机器人。
2. 改造运行时同步，让安装绑定写入指定目标机器人。
3. 将 `employee-install.confirm` 接入真实安装服务和 runtime binding。
4. 将 Da Bai 代理和机器人自装接入同一个安装服务。
5. 建立 governance event store，让员工安装真实生成企业事件。
6. 建立 enterprise sanitization session store 和 shared platform submission store。
7. 将平台发布接入 capability governance registry。
8. 补齐端到端测试和 UI 正式弹窗。

## 最小重新验收用例

| 用例  | 操作                                     | 必须验证                                                                                 |
| ----- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| E2E-1 | 从“我的机器人”的销售助手点击安装平台能力 | `employee-install.create-request.targetRobotId` 是销售助手；runtime binding 写入销售助手 |
| E2E-2 | 从外部/本地安装能力                      | 必须先有 scan result；中高风险显示强提醒；高风险策略可阻断或送审                         |
| E2E-3 | 安装需要配置的能力                       | 安装后进入 `pending-configuration`；机器人不能调用；配置完成后可用                       |
| E2E-4 | Da Bai 给销售助手发送安装请求            | 请求进入销售助手审核队列；接受后进入统一安装服务；最终绑定到销售助手                     |
| E2E-5 | 员工安装外部能力                         | 企业治理事件出现未认证外部能力事件，企业可限制或禁用                                     |
| E2E-6 | 企业资产提交平台                         | 未脱敏提交失败；脱敏完成后生成 submission；平台端可查到同一 submission                   |
| E2E-7 | 平台发布企业提交                         | 发布后 capability governance registry 出现平台能力条目                                   |

## 返工完成定义

只有同时满足以下条件，才建议重新申请验收：

1. P0 全部关闭。
2. P1 至少关闭 P1-1 到 P1-5。
3. 最小重新验收用例 E2E-1 到 E2E-7 全部通过。
4. 新增测试不只验证 stub 返回，而是验证真实 store 和跨模块状态。
5. 手动演示能从员工端、企业端、平台端看到同一条安装/提交链路。
