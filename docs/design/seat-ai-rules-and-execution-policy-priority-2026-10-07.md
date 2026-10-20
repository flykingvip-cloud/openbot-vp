# 席位级 AI 规则与执行策略：优先级和上限

日期：2026-10-07  
状态：设计基线。本文件不授权改设置页，也不新增产品控件。  
基线：`origin/main` `c805dcddf`（能力中心：MCP 候选工具发现，去映射 / 申请授权，无一键安装）。

专家审阅（附件 analysis §四「不要按原文落地」，实施顺序第 3 条）把两件事明确排除在当前设置页之外：

- 员工偏好里跨机器人「AI 规则」大文本框。偏好已有用户建模。自由文本对所有机器人生效会与岗位指令、机器人指令、企业策略抢优先级。席位级偏好可做，但须写明企业策略优先，且不是当前第一优先。
- 设置页三段式「自动 / 需审批 / 仅演练」。已有另一套审批（关闭 / 未命中时询问 / 总是询问）加凭证策略加执行位置。缺「员工只能收紧不能放宽」的上限模型，也没有面向用户的演练档。照抄会各说各话。

实施顺序第 3 条：席位级 AI 规则、执行策略控件，先写清优先级与上限，再考虑设置页。

本文件只完成这一步。后续设置页 PR 必须先满足文末闸门。

先例是协作治理协议，不另起一套说法：`EffectivePolicy = L1 ∩ L2`，下层只能在边界内收紧；自定义规则摘要是行为指导，不是强制约束（`docs/design/collaboration-governance-protocol-v1.1-2026-09-03.md`）。设置页说的、编译器算出的、运行时执行的，必须是同一条有效策略。

## 现状

以下以代码为准。今天没有一条从「企业硬策略」排到「会话临时指令」的统一编译器。各层各写各的，文本层只是拼进系统提示。

### 企业硬策略（运行时强制，文本不能放宽）

这些层决定能不能做，不靠模型自觉。

| 机制                 | 代码                                                                                                             | 实际语义                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 协作 L1-Hard         | `src/gateway/collaboration-dispatch/effective-policy.ts` 的 `SYSTEM_INVARIANTS`                                  | `l2CannotWidenL1`。L2 请求超出天花板时，编译器写入 `PolicyClamp`（请求值、有效值、原因），有效值取天花板。见 `src/gateway/collaboration-dispatch/policy-compiler.ts`                                                 |
| Fabric 策略运行时    | `src/fabric/policy-runtime.ts` 的 `decide`                                                                       | 只吃硬信号：scope、allowlist、approval、risk。未决审批默认拒绝。风险分只收紧沙箱和网络，不放宽                                                                                                                       |
| 策略模拟里的放宽检测 | `src/fabric/replay.ts` 的 `isRelaxation` / `dryRunDiff`                                                          | 把 DENY 改成非 DENY，或减弱沙箱 / 重新打开网络，记为 relaxation。模拟本身不执行工具                                                                                                                                  |
| 执行审批三态         | `src/infra/exec-approvals.ts`                                                                                    | `ExecAsk = off \| on-miss \| always`。`requiresExecApproval`：`always` 必问；`on-miss` 仅在 `security=allowlist` 且分析失败或允许列表未命中时问；`off` 不问。默认 `security=deny`、`ask=on-miss`、`askFallback=deny` |
| 审批收紧函数         | 同文件 `minSecurity`、`maxAsk`                                                                                   | 安全级别取更严（`deny < allowlist < full`）。询问取更常问（`off < on-miss < always`）。`src/agents/bash-tools.exec.ts` 用它们合并配置与本次请求                                                                      |
| 执行位置（命令）     | `ExecHost = sandbox \| gateway \| node`                                                                          | 未提升权限时，请求的 host 必须等于已配置 host，否则直接拒绝                                                                                                                                                          |
| 企业运营身份上限     | `src/gateway/enterprise-operational-identity-types.ts`、`src/gateway/enterprise-operational-identity-runtime.ts` | `EffectiveActions = 席位策略 ∩ enrollment ∩ 能力`。员工只能在企业已放行的动作里再缩小，不能扩权。协作委托同样只能再交                                                                                                |
| 数据访问编译         | `src/gateway/enterprise-data/data-access-policy-store.ts`                                                        | 只有 `targetKind=seat` 的策略能编译成 `SeatActionGrant`。department / role 只登记，编译抛 `DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED`                                                                                   |
| 治理动作矩阵         | `src/gateway/governance-policy.ts`                                                                               | 角色不能跨租户。`tenant-admin` 不能 `approve`。`worker-agent` 只能读自己的 worker 资源                                                                                                                               |
| 保留策略             | `enterprise-memory.governance.retention.get/update`                                                              | 企业管理员设置 `standard \| financial \| custom`，以及活跃 / 归档 / 删除天数。员工端不能改这组天数                                                                                                                   |

产品文案里的审批三态在 `ui/src/i18n/locales/zh-CN.ts`：`off` 为「关闭」，`onMiss` 为「未命中时」，`always` 为「始终」。专家审阅里的「未命中时询问 / 总是询问」指的就是这组枚举，不是另一套控件。

### 企业软策略（指导，不单独授权）

- 协作组 `systemInstructions` 在 `src/gateway/collaboration-dispatch/resolve-effective-policy.ts` 标明 **guidance only**。编译结果放在 `effective.guidance`，不进入 L1 硬不变量。
- 组章程、运行阶段提示由 `src/auto-reply/reply/runtime-context-assembly.ts` 拼进系统提示。
- 保留天数旁边的说明句是治理文案，不是第二套保留开关。

软策略可以告诉模型「怎么说、先复述什么」。它不能把硬策略拒绝的动作说成允许。

### 岗位 / 角色模板（今天不是指令文本）

- `src/gateway/billing/ai-job-templates.ts` 的 `AI_JOB_TEMPLATES` 把岗位映射到权益档、建议席位角色和建议机器人配额。没有岗位指令正文。
- 席位上的 `defaultAgentAssetIds` 表示这个岗位绑定哪些机器人资产，不是提示词。
- 数据访问策略的 department / role 目标只能登记，不能编译成运行时 Grant。

因此「岗位指令压过机器人指令」在今天还没有一个指令存储。岗位层现有的是权益、资产绑定和未编译的策略登记。

### 机器人指令（工作区引导文件，可被更高层覆盖）

- 每个机器人工作区注入 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md` 等（`src/agents/workspace.ts`）。
- `src/agents/system-prompt.ts` 写明：有 `SOUL.md` 时体现其人设，除非更高优先级指令覆盖它。`TOOLS.md` 不控制工具是否可用。
- 注入预算：单文件默认 20,000 字符，合计默认 150,000 字符（`src/agents/pi-embedded-helpers/bootstrap.ts`）。单文件读取上限 2MB。
- 渠道群组 / 话题的 `systemPrompt` 进入 `GroupSystemPrompt`，再进入同一段 extra system prompt。

这些文件是机器人自己的行为指导。它们不是企业策略，也不是席位偏好。

### 用户建模偏好（已有，结构化，按人而不是按席位）

- 画像字段是枚举，不是自由文本：语言、时区、输出格式、语气、`confirmationPreference`（`proactive` / `confirm_first`）、详略（`src/gateway/user-modeling/types.ts`）。
- `src/gateway/user-modeling/render.ts` 把它们渲染成 “Apply this user's learned preferences”。`proactive` 会写出「低风险步骤主动做，避免不必要的确认」。
- 存储键是 `tenantId:canonicalId` 的哈希；没有租户时用 `_local`（`src/gateway/user-modeling/user-key.ts`）。
- 租户可关：`gateway.userModeling.tenants[id].enabled`。推断默认关闭（`src/gateway/user-modeling/config.ts`）。
- `src/auto-reply/reply/get-reply-run.ts` 把这段和群指令、回合语言、运营身份等并列滤进 `extraSystemPromptParts`。没有冲突编译，也没有「与审批三态冲突则丢掉 proactive 句」。

这是人级风格偏好。它会进入该用户触发的各个机器人回合，但代码没有把它限制在某一个席位的机器人集合内。

### 会话临时指令（最低，且已有一部分收紧）

- `/exec host= security= ask=` 由 `src/auto-reply/reply/directive-handling.parse.ts` 解析。真正执行时，`bash-tools.exec.ts` 用 `minSecurity` / `maxAsk` 对配置天花板收紧。请求更松的 security 不会赢；请求更少询问的 ask 不会赢。
- 未提升权限时不能改 host。
- 回合语言、焦点续接、当前发言人不可信提示、一次性 `extraSystemPrompt` 都只是文本，不改审批文件。

### 凭证策略与执行落点（监督工人，不是 exec 三态）

这是第二条轴，不要和 `ExecHost` 合成一个下拉框。

| 轴           | 类型                                                    | 谁能写                             | 备注                                                                                                   |
| ------------ | ------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 命令执行位置 | `sandbox \| gateway \| node`                            | `tools.exec.host` 与审批配置       | 工具 `exec`                                                                                            |
| 工人凭证     | `enterprise_shared \| local_ide_login \| seat_personal` | 租户覆盖，仅 enterprise-admin 可改 | `seat_personal` 在 `src/gateway/supervisor/worker-policy-store.ts` 被拒绝，文案为推迟到 P3             |
| 工人落点     | `gateway \| node_agent`                                 | 同上                               | `local_ide_login` 在 `src/gateway/supervisor/execution-context.ts` 强制 `node_agent`，禁止跑在 Gateway |

界面文案（`ui/src/ui/supervisor/supervisor-types.ts`）：凭证是「企业共享 API Key（Gateway）」或「本机 IDE 登录（Node Agent）」；落点是「Gateway 宿主机」或「Node Agent（员工 Mac）」。成员只读，企业管理员可编辑。存储在租户级 `openbot-worker-execution-policies.json`。

### 演练（有引擎，没有用户档）

- `src/fabric/service.ts` 的 policy check 只裁决、不执行。
- `dryRunDiff` 用候选策略重放历史记录，标出放宽，无副作用。
- 消息工具、知识库打开、hooks、计费里还有各自的 `dryRun` 标志。它们不是员工设置里的「仅演练」。
- `ExecAsk` 没有第四个值。

### 已存在、本设计必须正视的缺口

这些不是文档可以假装已经封住的行为：

1. `src/agents/bash-tools.exec-host-shared.ts` 里，审批文件把 `ask` 设为 `off` 时，会压过运行时更严的 ask。这是放宽，不是收紧。
2. elevated 解析为 `full` 时，`bash-tools.exec.ts` 把 security 设为 `full`、ask 设为 `off`。这是操作者旁路，不是席位偏好。
3. 用户建模的 `proactive` 句子只活在提示词里，今天可以在文案上鼓励跳过确认，而审批三态仍由代码决定。两套说法会不一致。
4. 系统提示按拼接顺序注入，没有「谁赢」的编译记录。
5. 用户建模键在租户解析失败时落入 `_local`，不能当作企业席位规则的作用域。

## 优先级栈

从高到低。高的决定授权、工具是否可用、凭证、执行位置、审批和数据范围。低的只能在不放宽高的前提下，补充说法、格式和顺序。

| 序  | 层              | 谁写                                           | 冲突时                                                                                                                      |
| --- | --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | 企业硬策略      | 企业管理员 / 平台不变量                        | 永远赢。下层请求更宽则拒绝该请求，或钳制到天花板，并留下 clamp。不执行                                                      |
| 2   | 企业软策略      | 企业管理员                                     | 指导语。与硬策略矛盾的句子不能变成授权。运行时丢掉冲突句，硬策略照旧                                                        |
| 3   | 岗位 / 角色模板 | 企业管理员                                     | 今天只覆盖权益、机器人资产和未编译的访问登记。将来若有岗位指令正文，只能在 1、2 之内收紧，不能发工具、凭证、host 或审批豁免 |
| 4   | 机器人指令      | 该机器人的工作区（`SOUL.md` / `AGENTS.md` 等） | 只约束这一个机器人。不能覆盖 1–3。`TOOLS.md` 继续不能开关工具                                                               |
| 5   | 席位偏好        | 该席位上的员工，在上限内                       | 只作用于本租户、本席位已绑定的机器人。不能覆盖 1–4 的禁止项。与硬策略冲突则失败关闭                                         |
| 6   | 会话临时指令    | 本回合 / 本会话                                | 最低。`/exec` 只能沿 `maxAsk` / `minSecurity` 收紧。不可信渠道正文不能写成策略                                              |

同层同时出现两条时：

- 对已有全序的控制项（security、ask），取更严的一边。这就是现有 `minSecurity` / `maxAsk`。
- 对没有安全全序的控制项（host、凭证策略、执行落点），员工侧不能改。企业写定的值保持不变。
- 两条纯文本互相矛盾，又都不是「把某个全序控制项收紧」时，该动作失败关闭：不选更宽的那句，不让模型自己挑。

覆盖关系：

- 1 覆盖 2–6 的任何放宽。
- 2 覆盖 3–6 里与企业软禁止相矛盾的指导，但不覆盖 1。
- 3 覆盖 4–6 里试图放宽岗位约束的文本。
- 4 覆盖 5–6 里与该机器人指令相矛盾的风格句；5 不能改写 `SOUL.md` 的岗位职责。
- 5 覆盖 6 里与席位偏好相矛盾的临时风格句；6 不能改席位存储。
- 6 不能覆盖任何更高层。

员工不能写 1 和 2。岗位模板不是员工自由文本。机器人工作区文件仍在 1–3 之下。席位偏好是员工能写的最高层，而且只在天花板内。

## 席位 AI 规则

席位规则是第 5 层的未来存储。它不是把用户建模换成一个大文本框，也不是 Cursor 那种对所有机器人生效的 Rules for AI。

### 作用域

- 主键是 `tenantId + seatId`。缺 `tenantId` 时读写都拒绝，禁止落入用户建模的 `_local`。
- 只注入该席位 `defaultAgentAssetIds`（以及同一席位的有效资产绑定）里的机器人。
- 不跨席位，不跨租户，不进入未绑定该席位的机器人。
- 与用户建模分开存。用户建模继续是人级结构化风格（语言、时区、语气、详略）。席位规则不能借用那份画像去绕过席位边界。
- 一个人有多个席位时，席位规则互不可见。人级风格可以仍按现有用户键注入，但其中任何「少确认、主动执行」的句子都受下一节的失败关闭约束。

### 长度和敏感内容上限

建议上限（实现时写成常量并测试，不要复用引导文件的 20,000 / 150,000，否则席位文本会淹没岗位和机器人指令）：

- 单条不超过 500 个字符（含空白）。
- 一个席位合计不超过 2,000 个字符。
- 一个席位最多 8 条。
- 超出则整次保存失败，不截断后静默生效。截断会把后半句禁令切掉，留下前半句放宽。

保存前拒绝整条，已存规则不变：

- 密钥、令牌、私钥、连接串、口令。
- 要求关闭审批、跳过安全、提升权限、改 host、改凭证策略、改执行落点。
- 点名其他租户、其他席位、或其他员工的数据。
- 把 `confirmationPreference` 或同义句写成「不用确认就执行」。审批三态不由这句话决定。

### 与企业策略冲突时的失败关闭

失败关闭指：冲突的内容不生效，动作按硬策略继续被拒绝或被钳制，不存在「宽的那一半仍然算数」。

- 保存时：与第 1 层或第 2 层禁止项冲突的规则整条拒绝。其余已生效规则不改。响应里返回被拒绝的原因，不写入。
- 运行时：企业策略变严之后，已经存下的席位规则若现在冲突，从本回合注入中剔除，不进入模型上下文。记录 clamp（规则 id、冲突层、原因）。执行仍走硬策略。
- 不把席位规则编译进 Fabric `decide` 的允许条件。它最多是被过滤后的指导语。
- 用户建模若渲染出与当前 `ask` 冲突的 proactive 句，同样剔除，改留「仍服从当前审批」。这是现有字段的收口，不是新文本框。

## 执行策略上限模型

不新增「自动 / 需审批 / 仅演练」控件，也不把这三档映射成新的枚举。员工只能在企业已经写好的天花板里，把现有旋钮拧紧。

企业天花板是现有字段，不是平行对象：

| 员工想收紧的事 | 用现有字段                                    | 更严的方向                                            | 员工能否动                                                   |
| -------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 更常询问       | `ExecAsk`：`off` → `on-miss` → `always`       | `maxAsk`                                              | 能，且只能朝 `always`                                        |
| 更少命令权限   | `ExecSecurity`：`full` → `allowlist` → `deny` | `minSecurity`                                         | 能，且只能朝 `deny`                                          |
| 命令在哪跑     | `ExecHost`                                    | 没有给员工用的全序                                    | 不能。保持企业配置的 host                                    |
| 工人用谁的凭证 | `CredentialPolicy`                            | `enterprise_shared` 与 `local_ide_login` 不是松紧阶梯 | 不能。继续只由 enterprise-admin 写。`seat_personal` 维持拒绝 |
| 工人在哪跑     | `ExecutionPlacement`                          | 同上                                                  | 不能。`local_ide_login` 继续强制 `node_agent`                |

收紧的判定和今天的代码对齐：

- 会话或席位请求的 ask 若比天花板更少询问，有效值仍是天花板（`maxAsk`）。
- 请求的 security 若比天花板更宽，有效值仍是天花板（`minSecurity`）。
- 请求改 host、凭证或落点：拒绝该请求，有效值不变。
- 企业把天花板拧紧后，席位上一次保存的更松选择立即失效，下次解析直接落到新天花板。不需要员工再保存一次。

在任何设置页出现之前，必须先处理两个现有旁路，否则「不能放宽」在代码上是假的：

- 审批文件 `ask=off` 压过更严运行时 ask 的分支，不能被席位或会话触发。若保留，只能是企业操作者的显式 break-glass，并且席位 UI 读不到这个开关。
- elevated `full` 把 security 打成 `full`、ask 打成 `off`，同样不是席位偏好。席位规则和会话 `/exec` 不能打开它。

凭证的「再收紧」若要做，走已经存在的运营身份交集：员工在企业 `IdentityUsagePolicy` 已允许的动作里再缩小 enrollment。不要新造一个凭证三态。

## 演练档

需要单独定义，因为它容易被做成第三段审批。

定义：演练是 Fabric 已有的只裁决路径。调用 policy check 或 `dryRunDiff`，产出允许、拒绝或收紧，以及会不会构成放宽。不调用有副作用的工具，不写审批放行，不改允许列表。

和「仅 Dry Run」的关系：

- Cursor 的「仅演练」不落成 `ExecAsk` 的新值，也不替换「关闭 / 未命中时 / 始终」。
- 演练与审批正交。一次演练仍用同一套天花板计算「如果真执行，会不会要审批」。它不弹审批，也不把 `ask` 改成 `off`。
- 演练结果不能当作下一次真执行的预授权。

本阶段不要求做面向用户的演练档。没有闸门里的回归测试之前，设置页不出现「演练」选项。

## 明确不做

- 设置页不做 Cursor 式、跨机器人的 AI 规则大文本框。席位规则的正文上限和失败关闭未落地之前，连席位内的小文本框也不做。
- 设置页不照抄「自动 / 需审批 / 仅演练」三段。审批继续用 `off / on-miss / always`，凭证和执行落点继续用监督策略里的现有字段。
- 不做绕过能力中心映射的一键工具。发现、映射成企业能力、再席位授权，这条边界保持不变。本基线已有 MCP 候选发现且无一键安装，设置页不能补上一个 Add。
- 不把用户建模改成自由文本，也不把 `proactive` 接到审批开关上。
- 不把 `seat_personal` 凭证策略提前打开。
- 不把 department / role 数据访问策略直接编译成 Grant。那是另一条未完成的编译限制，本设计不顺便放开。

## 后续实施闸门

下面全部满足之后，才允许另开设置页控件 PR。缺任何一条，设置页继续不出现席位规则文本框和执行策略新控件。

1. 有一个优先级编译器（或明确挂到现有协作编译与 exec 合并上），测试覆盖六层：更高层赢，放宽被钳制，冲突文本被剔除。断言里能看到 clamp，而不是只看提示词里「碰巧没有那句话」。
2. 席位规则的读写以 `tenantId + seatId` 为界。缺租户拒绝。不能读到其他席位、其他租户或 `_local` 用户建模桶。注入列表只含该席位绑定的机器人。
3. 500 / 2,000 / 8 的上限，以及密钥和「跳过审批 / 改 host」类内容的拒绝，有失败测试：超限和敏感内容保存前后存储字节不变。
4. 执行路径上，会话和席位都不能把 ask 降到天花板之下，也不能把 security 升到天花板之上。审批文件 `ask=off` 压过更严 ask 的路径已关闭，或已标成席位不可达的 break-glass，并有测试挡住席位调用。
5. 凭证策略和执行落点的写接口仍只有 enterprise-admin。员工和会话请求改这两个字段时返回拒绝，存储不变。
6. 若要做演练，只调用 policy check / `dryRunDiff`，不增加 `ExecAsk` 枚举，不把演练结果写成下次执行的允许。
7. 用户建模的 proactive 句在企业 ask 不是 `off` 时不再注入「避免确认」。测试锁定渲染结果。
8. 设置页 PR 只编辑上述现有字段在天花板内的收紧值。不新增平行三态，不新增跨机器人文本框，不新增能力安装按钮。

在此之前，员工可见的行为保持今天的产品：结构化用户建模、企业治理里的保留与策略、执行审批三态、以及仅企业管理员可改的凭证策略和执行落点。
