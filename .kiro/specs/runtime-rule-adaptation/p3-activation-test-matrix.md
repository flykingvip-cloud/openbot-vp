# P3 激活状态转换与失败测试矩阵（契约验收；本轮不实施）

- 状态：配合 `effective-policy-lifecycle.md` 供验收。本轮只交矩阵，不实现激活器、不写类型、不接线、不改 P1／P2 源码，不改变 `activationAllowed=false`，不启用策略，不写生产配置。
- 盘点／行号基线 SHA：`9b65109f41dee30b892a6faff493e46e735cab8d`
- 工作树登记 SHA（仅登记上下文）：`4a786626a1e2892043f57b3832ddf2a407be284a`
- 时间：2026-11-12 18:56（Asia/Shanghai，UTC+8）
- 判定以生命周期契约为准。同一输入不得再写“结果 A 或结果 B”。凡失败案，既有生效快照必须保持，且不得部分写入。
- 成功 CAS 的正例若出现在本矩阵中，只允许使用**测试夹具白名单**（或明确审批夹具）。该名单不是生产运行时白名单。独立验收关闭白名单之前，生产白名单视为空；空名单上的非夹具成功激活不得被写成预期成功。
- 本矩阵中的宿主数字、身份、哈希均为测试夹具，不是生产配置读数。未打开的生产开关（如 `collaboration.policySnapshot`）不得在用例里被假定为已开启。
- 变更记录（2026-11-12 19:18，Asia/Shanghai，UTC+8）：有限 P3 实施已按本矩阵编写预检与 CAS／失败测试。本轮不是 P3 代码验收、合并或部署批准。成功正例仅使用测试夹具白名单。

默认前提（某案未另写时适用）：可信身份与 `TaskBoardScope` 匹配；任务活且未墓碑；磁盘 `writeEpoch` 与请求 `expectedWriteEpoch` 相等；`expectedPolicyVersion` 三项与当前权威一致；提案为封闭 `policy_proposal`；已对同一提案身份得到 `shadow_accepted`；宿主门禁为 `test_entry` 或 `explicit_approval`；当前授权重评为 `host_authorized`；权限轴为 `tune`；测试夹具白名单命中该 ruleId／字段／行动；无未知或禁止字段。P1／P2 公开入口的 `activationAllowed` 在所有案件中若被观察，必须仍为 `false`。

## 1. 入口隔离与 P1／P2 不变式

### A-01 经校验器请求激活：拒绝，且 `activationAllowed` 仍为 false

| 项 | 内容 |
| --- | --- |
| 前置 | 合法 `policy_proposal` 可得到 `shadow_accepted`。调用的是 `validateRuntimeRuleProposal`，不是 `activateApprovedRuntimeRuleProposal`。提案或宿主若夹带 `activateNow`／`activationRequested` 等禁止字段则更应结构性 `blocked`。 |
| 输入 | P1 双参数入口；不调用激活入口。 |
| 预期 | 校验结果 `activationAllowed === false`。即使合法收紧且 `authorizationAssessment=host_authorized`，也不写入任务板，不产生生效快照。 |
| 既有快照 | 保持不变（本应无因本调用产生的新快照）。 |
| 不得发生 | 不得因合法校验而激活；不得返回 `activationAllowed=true`；不得把校验器变成激活入口。 |

### A-02 经影子运行器请求激活：拒绝，且 `activationAllowed` 仍为 false

| 项 | 内容 |
| --- | --- |
| 前置 | 调用 `runShadowRuleAdaptation`。模型输出或工具参数试图激活、写入 `activationAllowed=true`，或调用不存在的激活工具。 |
| 输入 | P2 影子入口。 |
| 预期 | `ShadowRunResult.activationAllowed === false`。控制快照不变，无业务工具，不写任务／策略。若走了校验，校验结果同样 `activationAllowed === false`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得因影子成功自动调用激活入口；不得把伪造的 `activationAllowed=true` 泄漏到产品结果。 |

### A-03 P1／P2 公开类型在激活设计落地后仍恒为 false

| 项 | 内容 |
| --- | --- |
| 前置 | 即使未来实现了激活入口，回归仍调用 `validateRuntimeRuleProposal` 与 `runShadowRuleAdaptation`。 |
| 输入 | 已验收 P1 矩阵／样例与 P2 替身案件。 |
| 预期 | 所有公开产品结果 `activationAllowed === false`，与 P1／P2 冻结契约相同。 |
| 既有快照 | 这些调用不改变生效快照。 |
| 不得发生 | 不得修改 P1 校验器源码或 P2 影子结果类型去放开该字段。 |

## 2. 结构、绑定与未核准候选

### B-01 缺少绑定字段：结构性拒绝

| 项 | 内容 |
| --- | --- |
| 前置 | 其余项可合法。分别缺：`authorizationReference`、`taskId`、`expectedWriteEpoch`、完整 `expectedPolicyVersion`、`approvedCandidateIdentity`、`hostActivationGate`、身份／作用域。 |
| 输入 | 不完整的激活请求。 |
| 预期 | `rejected`，理由含 `structural_missing_binding`（或等价稳定码）。不进入写入。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得用默认值补齐缺失绑定后激活。 |

### B-02 未知字段或禁止字段：结构性拒绝

| 项 | 内容 |
| --- | --- |
| 前置 | 提案或激活信封出现未知键，或 P1 `FORBIDDEN_PROPOSAL_KEYS` 中的键。 |
| 输入 | 含未知／禁止字段的请求。 |
| 预期 | `rejected`／结构性 `blocked` 语义，`structural_unknown_field` 或 `structural_forbidden_field`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得忽略未知字段继续激活。 |

### B-03 绑定不匹配（作用域、任务、授权引用、预期版本）

| 项 | 内容 |
| --- | --- |
| 前置 | 请求中的 scope／`taskId`／身份与任务板或授权引用指向的对象不一致，或 `expectedPolicyVersion` 与提案内绑定不一致。 |
| 输入 | 字段齐全但绑定交叉。 |
| 预期 | `rejected`（身份为 `identity_scope_mismatch` 或绑定失败码）。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得按“相近任务”或跨作用域写入。 |

### B-04 未核准候选／未登记／禁止落盘替身

| 项 | 内容 |
| --- | --- |
| 前置 | 输入是未登记候选、仅有草稿、或 P2 `p2_persist_forbidden` 替身；或 `approvedCandidateIdentity` 与当前提案不一致。 |
| 输入 | 未核准身份。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得把替身或改写后的提案当成已核准候选。 |

### B-05 `shadow_accepted` 不是激活凭证

| 项 | 内容 |
| --- | --- |
| 前置 | 同一提案已 `shadow_accepted`，但缺少 `hostActivationGate`，或门禁不是 `test_entry`／`explicit_approval`。 |
| 输入 | 只有影子通过，无宿主门禁。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得因影子合法而激活。 |

### B-06 `rule_candidate`／`candidate_validated` 不能激活

| 项 | 内容 |
| --- | --- |
| 前置 | 输入种类为 `rule_candidate`，或校验结果为 `candidate_validated`。 |
| 输入 | 候选激活请求。 |
| 预期 | `rejected`。计划“候选不能激活”。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得把 `candidate_validated` 当作登记或激活凭证，不得经临时 ID 混入生效策略。 |

### B-07 白名单为空：拒绝

| 项 | 内容 |
| --- | --- |
| 前置 | 生产／非夹具路径上运行时白名单为空（独立验收前的规定状态）。即使提案是 P0 的 shadow 候选字段，且已 `shadow_accepted`、门禁齐全、授权为 `host_authorized`。 |
| 输入 | 对空名单做激活。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得把 P0 候选自动升格为白名单；不得发明 ruleId 或可调权限；不得填写或声称生产白名单内容。 |

### B-08 未知或旧的实现／策略版本

| 项 | 内容 |
| --- | --- |
| 前置 | `implementationVersion` 未知，或 `expectedPolicyVersion` 中 `protocolVersion`／`compilerRevision`／`policyHash` 与当前权威不同（含旧哈希）。 |
| 输入 | 未知或旧版本绑定。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得按路径未变或 git 祖先关系推断兼容并激活。 |

### B-09 缺少预期版本或预期版本陈旧

| 项 | 内容 |
| --- | --- |
| 前置 | 缺 `expectedWriteEpoch` 或 `expectedPolicyVersion` 任一项为结构性缺失（见 B-01）。本条覆盖：字段存在但 `expectedWriteEpoch` 小于磁盘世代，或策略三项与当前权威相比已陈旧，且尚不足以判为并发冲突叙事时，仍须拒绝。与 C-01 同时可测时，并发写入后的陈旧预期归 `conflict`。 |
| 输入 | 陈旧或缺失的预期版本。 |
| 预期 | 缺失 → `rejected`（结构）；已有更新世代 → `conflict`；仅策略版本陈旧而无并发写入 → `rejected`（过期／陈旧提案）。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得用当前磁盘版本自动改写请求后再激活。 |

## 3. CAS、持久化、重启与隔离（计划 §8 必选）

### C-01 CAS 竞争：不得覆盖较新版本

| 项 | 内容 |
| --- | --- |
| 前置 | 两条合法激活请求读到同一 `expectedWriteEpoch=N`。请求 A 先成功，磁盘世代变为 `N+1` 并写入快照 S_A。请求 B 随后提交仍带 `expectedWriteEpoch=N`。 |
| 输入 | 并发／相继的第二条 CAS。 |
| 预期 | A：`activated`，快照 S_A。B：`conflict`，生效仍为 S_A，`writeEpoch` 仍为 A 之后的世代。 |
| 既有快照 | B 不得改写 S_A。 |
| 不得发生 | 不得用过期快照覆盖较新版本；不得出现部分字段来自 B 的混合快照。 |

### C-02 过期提案

| 项 | 内容 |
| --- | --- |
| 前置 | `expectedPolicyState=expired`（或 `cancelled`／`tombstone`），或宿主显式截止时间已过。任务或策略绑定已过期。 |
| 输入 | 过期提案激活。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得发明默认 TTL 让夹具“碰巧未过期”；无宿主截止点时只按状态与版本绑定判断。 |

### C-03 权限撤销后激活

| 项 | 内容 |
| --- | --- |
| 前置 | 校验时曾为 `host_authorized`，激活当下授权引用重评为已撤回（`host_unauthorized` 或记录不存在）。 |
| 输入 | 带旧授权引用的激活。 |
| 预期 | `rejected`。不得激活。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得复用旧 `authorizationAssessment=host_authorized` 作为激活时授权。 |

### C-04 规则下架后激活或继续依赖

| 项 | 内容 |
| --- | --- |
| 前置 | 目录中该 `ruleId` 已下架或不存在；或激活后模拟下架再回退／再激活。 |
| 输入 | 仍引用已下架规则的请求。 |
| 预期 | `rejected`。若已有不依赖该规则的合法快照，予以保留；依赖已下架规则的权利不得继续行使。 |
| 既有快照 | 不因失败写入新的依赖下架规则的快照。 |
| 不得发生 | 不得凭历史快照继续启用已下架规则。 |

### C-05 激活持久化失败：无部分激活

| 项 | 内容 |
| --- | --- |
| 前置 | CAS 比较将通过，但注入写入／rename／锁失败，或抛出持久化错误。 |
| 输入 | 本将成功的激活请求。 |
| 预期 | `persist_failed`。磁盘上的 `writeEpoch` 与生效快照与调用前一致。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得留下只写了部分字段、或世代已加而快照未完整冻结的状态。调用方已返回的结果不得被晚到成功写入改写。 |

### C-06 回退：新版本变更并重核当前授权

| 项 | 内容 |
| --- | --- |
| 前置 | 已有合法快照 S1，随后成功激活到更紧的 S2。当前授权仍允许回到 S1 的值。调用 `rollbackActivatedRuntimeRulePolicy` 目标为 S1 的已授权有效值。 |
| 输入 | 回退请求，带当前 `expectedWriteEpoch`。 |
| 预期 | `activated`（新世代），新快照 S3 内容为经当前授权重核后的目标值，而不是磁盘物理倒回。`writeEpoch` 递增。 |
| 既有快照 | S2 成为历史；S3 为当前生效。 |
| 不得发生 | 不得删除参数让编译回到更宽默认并称作回退；不得跳过 CAS。 |

### C-07 回退不得恢复已撤销权利

| 项 | 内容 |
| --- | --- |
| 前置 | S1 曾包含随后被撤销的权限或已下架规则。当前授权已不再包含该权利。请求回退到 S1。 |
| 输入 | 目标为已撤销权利的回退。 |
| 预期 | `rejected`。当前生效保持（通常为撤销后的合法快照）。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得复活已撤销权限；不得把历史快照当不可撤销权利。 |

### C-08 回退不得复活取消或墓碑任务

| 项 | 内容 |
| --- | --- |
| 前置 | 任务已取消或写入 `tombstones`。请求回退或激活“恢复旧策略并继续该任务”。 |
| 输入 | 针对已取消／墓碑任务的回退或激活。 |
| 预期 | `rejected`。 |
| 既有快照 | 不复活任务，不清除墓碑。 |
| 不得发生 | 不得把放宽或回退写成恢复已取消任务的入口。 |

### C-09 重启读取以 state 持久化为准

| 项 | 内容 |
| --- | --- |
| 前置 | 成功激活并持久化快照 S。进程内存中另有未持久化的影子结果或不同的校验对象。模拟进程重启后只打开持久化任务板。 |
| 输入 | `readActivatedRuntimeRulePolicy`。 |
| 预期 | 读到的正是 S（含 ruleId、实现版本、参数、作用域、来源、schema／编译版本、生效节点、时间、变更者、各版本轴）。 |
| 既有快照 | 保持 S。 |
| 不得发生 | 不得用影子内存、校验器输出或晚到模型文本作为重启后的激活来源或补写来源。 |

### C-10 身份隔离

| 项 | 内容 |
| --- | --- |
| 前置 | 租户 A／用户 A／会话 A 的任务板上有快照 S_A。使用租户 B 或用户 B 或另一会话的身份读取或激活同一 `taskId`／路径。 |
| 输入 | 跨身份的 `readActivatedRuntimeRulePolicy` 或激活／回退／撤销。 |
| 预期 | `rejected` 或不可见（失败关闭），不得返回 S_A，不得写入 B 的板，也不得改 A 的板。 |
| 既有快照 | S_A 保持不变。 |
| 不得发生 | 不得因文件路径可猜中而跨租户成功；作用域键不完整必须失败。 |

## 4. 撤销、Agent 故障与事实不足

### D-01 撤销授权后的已生效策略

| 项 | 内容 |
| --- | --- |
| 前置 | 已激活 S。随后宿主撤回该授权引用。再调用依赖该授权的动作或再次激活／回退到依赖该授权的状态。 |
| 输入 | `revokeActivatedRuntimeRulePolicy` 及后续依赖请求。 |
| 预期 | 撤销本身在授权方操作下可成功记入新世代；之后依赖已撤权利的激活／回退 `rejected`。仍合法且不依赖已撤权利的当前策略保留。 |
| 既有快照 | 不恢复被撤权利。 |
| 不得发生 | 不得继续把 S 当有效授权。 |

### D-02 Agent 不可用：保留仍合法的现策略

| 项 | 内容 |
| --- | --- |
| 前置 | 已有合法生效快照 S。影子 Agent／模型不可用，或 `runShadowRuleAdaptation` 失败。 |
| 输入 | Agent 故障期间的读与无关动作。 |
| 预期 | `readActivatedRuntimeRulePolicy` 仍返回 S。不自动激活任何待决提案。 |
| 既有快照 | 保持 S。 |
| 不得发生 | 不得因 Agent 故障清空策略，也不得“全部失败继续”地绕过强制门禁。 |

### D-03 强制事实不足：阻止相关动作或等待

| 项 | 内容 |
| --- | --- |
| 前置 | 缺少身份、作用域、当前有效值、授权评估、兼容性或预期策略状态等强制事实。 |
| 输入 | 激活或依赖该事实的动作。 |
| 预期 | `rejected` 或明确等待／需要信息；相关动作不得执行。不依赖该事实的普通问答或既有合法策略不被全局冻结。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得笼统“全部失败继续”，也不得“所有聊天冻结”。 |

### D-04 权限轴独立（选择／调参／修改创建／停用）

| 项 | 内容 |
| --- | --- |
| 前置 | 当前授权仅有 `tune`，请求 `disable` 或 `select`／`create`。或相反。 |
| 输入 | 权限轴与授权不符的激活或回退。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得用调参权停用规则，或用停用权实施未授权的选择／创建。 |

## 5. 参数权威、无任务绑定与成功夹具（负例优先）

### E-01 不得写入第二套配置或绕过硬门禁

| 项 | 内容 |
| --- | --- |
| 前置 | 请求试图同时改 `OpenBotConfig`、operatingState、打开 `collaboration.policySnapshot`、或绕过 `SYSTEM_INVARIANTS`／硬下限（例如把 contextTokens  cap 删掉或降到硬下限以下，或把可见回复上限放到 12 以上）。 |
| 输入 | 越权或第二权威写入企图。 |
| 预期 | `rejected`。生产配置文件与编译硬门禁不变。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得把激活实现成写配置；不得钳制后把原非法提案当成功。 |

### E-02 不得用商业 `planVersionId` 作为 CAS 轴

| 项 | 内容 |
| --- | --- |
| 前置 | 请求只绑定或错误绑定商业 `planVersionId`，缺少 `expectedWriteEpoch`／`expectedPolicyVersion`，或试图用订阅计划版本覆盖任务板 CAS。 |
| 输入 | 以商业计划版本冒充 plan／策略版本。 |
| 预期 | `rejected`。 |
| 既有快照 | 保持不变。 |
| 不得发生 | 不得把 commerce／credit 的 `planVersionId` 当作激活 CAS 成功条件。 |

### E-03 无任务绑定可以咨询但不能激活

| 项 | 内容 |
| --- | --- |
| 前置 | 只有咨询性提案，无 `taskId`／任务板绑定。P1／P2 咨询可进行。 |
| 输入 | 无任务绑定的激活请求。 |
| 预期 | `rejected`。校验或影子若被调用，仍只是咨询，`activationAllowed === false`。 |
| 既有快照 | 无任务则无任务级快照可写；不得创建隐式任务来完成激活。 |
| 不得发生 | 不得为激活而自动建任务。 |

### E-04 测试夹具白名单上的合法成功 CAS（非生产白名单）

| 项 | 内容 |
| --- | --- |
| 前置 | 仅测试：夹具白名单命中；同一提案已 `shadow_accepted`；门禁为 `test_entry`；授权重评为 `host_authorized`；绑定完整且与磁盘一致。可选用 P0 已描述的有界收紧字段作为夹具素材，但必须标明这是夹具名单，不是已验收生产白名单。 |
| 输入 | `activateApprovedRuntimeRuleProposal`。 |
| 预期 | `activated`。返回前冻结的快照含 §6 所列字段。`writeEpoch` 从磁盘值加一。`readActivatedRuntimeRulePolicy` 读到同一快照。P1／P2 入口若再被调用，`activationAllowed` 仍为 `false`。 |
| 既有快照 | 被新快照取代；旧快照只作历史。 |
| 不得发生 | 不得声称生产白名单已有内容；不得改生产配置；不得接线主链强制；不得把该成功写成治理已接通。 |

## 6. 范围外（本矩阵不要求本轮实现或扩到 P4）

- 主链强制执行、个人与协作真实消费者链、新旧来源切换开关（P4）。
- 候选规则的发布、实现与生产引用（P5）。
- 打开或验收 `collaboration.policySnapshot` 生产开关。
- 独立验收非空白名单的具体生产 ruleId 清单。
- 提交、推送、合并、部署。

实现若开始，必须先能稳定复现本矩阵失败案与 C-01／C-05／C-09／C-10／E-04，且不改 P1／P2 的 `activationAllowed=false`。在白名单独立验收前，E-04 以外不得出现生产路径成功激活。
