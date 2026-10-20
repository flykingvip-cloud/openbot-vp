# 录制工作流 Implementation Tasks

## Agents

- codex-recording · role: owner · scope: 录制工作流方案与 Gork 团队实施拆解 · paths: .kiro/specs/workflow-recording/\*\*, docs/design/openbot-workflow-recording-implementation-plan-2026-07-17.md · since: 2026-07-17

## Delivery Rules

- 产品名称统一使用“录制工作流”，内部能力前缀使用 `workflow-recording`。
- Phase 1 仅覆盖 OpenBot 管理的浏览器动作和 OpenBot 工具调用；不承诺任意 macOS 应用录制。
- Replay 必须重新进入正常 Agent、Tool、Fabric、审批和审计链路，禁止直接回放副作用。
- 所有生成内容先进入 `draft`，用户明确保存后才成为个人 Skill；共享和发布继续走既有审核流程。
- 录制数据必须先脱敏再持久化；秘密只允许保存引用，不允许保存明文。
- 每个任务达到相关测试通过、类型检查无新增错误、文档和协议同步后才算完成。

## Milestone 0: Contract And Fixtures

- [ ] 0.1 定义录制会话、事件、证据、变量、断言和 Skill 草稿的 Zod 契约
  - 路径建议：`src/workflow-recording/contracts.ts`、`src/workflow-recording/contracts.test.ts`
  - 覆盖 schema 版本、事件序号、时间戳、来源、风险等级和脱敏状态。
  - 验收：合法事件往返不丢字段；未知版本、乱序事件和未脱敏秘密被拒绝。
- [ ] 0.2 建立黄金录制 fixtures
  - 至少覆盖“下载周期报表”“创建规范 Issue”“跨浏览器与 OpenBot 工具的混合流程”。
  - 验收：fixtures 不包含真实账号、令牌、手机号或个人路径。

## Milestone 1: Browser Recording MVP

- [ ] 1.1 实现录制会话状态机
  - 状态：`draft -> awaiting_consent -> recording -> processing -> review -> saved | discarded | failed`。
  - `start`、`stop`、`discard` 必须幂等；同一用户和设备只允许一个前台录制。
- [ ] 1.2 在 Browser Tool 边界采集结构化动作
  - 复用现有 `click/type/press/drag/select/fill/navigate/upload/dialog` 动作。
  - 每步记录动作前后 URL、页面标题、ARIA/AI snapshot 引用、必要截图和结果摘要。
  - 不记录键盘原始流；密码框和秘密字段只记录变量占位符。
- [ ] 1.3 采集 OpenBot 工具调用事件
  - 复用 `tool_execution_start` / result 事件，关联 `runId`、`toolCallId`、session 和 recording。
  - 消息发送、发布、删除、支付类动作标记为高风险副作用。
- [ ] 1.4 新增 Gateway RPC 与 scope
  - 建议方法：`workflow-recording.start/status/stop/discard/preview/save`。
  - `status/preview` 为 read；`start/stop/discard/save` 为 write；不得绕过设备身份与租户隔离。
- [ ] 1.5 实现本地持久化和保留策略
  - 原始录制与处理后草稿分层存储；支持 TTL、用户删除和崩溃恢复。
  - 验收：网关重启后可恢复 processing/review，过期原始截图会清理但已保存 Skill 不受影响。

## Milestone 2: Workflow Synthesis

- [ ] 2.1 实现事件归一化与去噪
  - 合并重复 snapshot、无意义等待和连续输入；保留失败重试作为候选恢复策略。
- [ ] 2.2 实现变量与偏好识别
  - 分类为 `input`、`preference`、`secret_ref`、`constant`、`derived`。
  - 所有推断都携带 evidence 和 confidence，低置信度项必须让用户确认。
- [ ] 2.3 实现步骤语义化
  - 定位优先级：Tool/API > DOM/ARIA > 文本与角色关系 > 视觉 > 坐标回退。
  - 生成前置条件、操作、等待条件、成功断言和失败恢复建议。
- [ ] 2.4 将 `skill-lifecycle.extract` 接入真实录制上下文
  - 保留未提供 recording 时的兼容行为；提供 recording 时生成真实 profile 和 runtime definition。
  - 不在该接口直接发布 Skill。
- [ ] 2.5 生成可编辑 Skill 草稿
  - 草稿必须包含触发描述、输入 schema、工具依赖、步骤、风险确认点和验证规则。
  - 保存后进入既有个人 Skill 生命周期与版本体系。

## Milestone 3: Review And Replay

- [ ] 3.1 实现录制审查 UI
  - 展示时间线、步骤、变量、截图、风险和成功标准；支持删除步骤、重命名变量和修改断言。
  - UI 中必须持续显示录制状态，并提供明确的停止与丢弃入口。
- [ ] 3.2 实现 Skill 草稿差异预览
  - 用户可比较“录制事实”和“生成步骤”，查看模型抽象或忽略了什么。
- [ ] 3.3 实现语义 Replay 编译器
  - 把 Skill runtime definition 编译为正常 Agent 任务上下文，不直接执行记录事件。
  - 每次执行重新解析目标、检查工具可用性并进入当前策略与审批链。
- [ ] 3.4 实现 dry-run
  - 检查依赖、目标可定位性、变量完整性、权限和预计副作用，不提交写操作。
- [ ] 3.5 实现 Replay 验证与运行报告
  - 保存每步状态、断言结果、人工确认、失败原因、耗时和 Skill 版本。

## Milestone 4: Safety And Quality

- [ ] 4.1 建立秘密检测与录制暂停策略
  - 覆盖 password input、token/key/cookie/header、OTP 和剪贴板敏感内容。
  - 检测到不可安全处理的敏感输入时暂停录制并提示用户。
- [ ] 4.2 接入 Fabric 决策与审计
  - Replay 每个副作用工具调用都生成新的 correlation 和审计记录。
  - 严禁复用历史 `ALLOW` 决策；历史记录只作为生成和解释证据。
- [ ] 4.3 建立质量评分
  - 指标至少包含 replay 成功率、人工接管率、元素定位稳定性、断言通过率和平均耗时。
- [ ] 4.4 建立回归评测集
  - 每个黄金流程至少有成功、页面轻微变化、权限不足、元素缺失、秘密输入五类场景。
- [ ] 4.5 完成威胁建模与隐私检查
  - 覆盖提示注入、恶意网页诱导、截图泄露、跨租户读取、Skill 供应链和录制指示器欺骗。

## Milestone 5: Desktop Expansion

- [ ] 5.1 完成 macOS 可行性验证
  - 使用 Accessibility API 获取应用、窗口、控件角色与动作；Screen Recording 仅作视觉证据。
- [ ] 5.2 定义 Mac Node 结构化 Computer Use 协议
  - 动作需支持 click/type/press/scroll/drag/wait/snapshot，并逐项受权限与 allowlist 控制。
- [ ] 5.3 支持首批白名单应用
  - 按稳定性逐个接入，不提供未经验证的“任意应用可靠回放”承诺。
- [ ] 5.4 桌面动作接入同一合成、审查、Replay 和审计管线

## Release Gates

- [ ] G1 浏览器 MVP：三个黄金流程连续运行 20 次，成功率不低于 90%，无秘密落盘。
- [ ] G2 内部试用：高风险动作 100% 进入确认或已有明确策略授权，无历史决策复用。
- [ ] G3 Beta：支持录制数据导出/删除、TTL、崩溃恢复、Skill 版本回滚和可观测指标。
- [ ] G4 Desktop Preview：仅在 Accessibility 与 Screen Recording 权限完整、录制指示器可见时启用。
