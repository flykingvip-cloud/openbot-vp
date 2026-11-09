# T9 组终稿投递补链 — 最小设计（仅设计，不实施）

日期：2026-11-10（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`  
性质：**设计评审稿**。不授权实现、合入、部署、真实外发。

## 1. 目标链（仍未闭合）

> 组终稿确定 → 整体验收 → 授权交付 → 实际回执 → 同版本恢复／重投。

成员成果桥 M1–M3（`requestAcceptedArtifactDelivery`／grant／进程内 recover）**已验收**，但是：

- 作用域为 `member_artifact` 显式请求；
- `evaluateMemberArtifactDeliveryEligibility` 对 `scope === "group_final"` **直接 deny**（`group_final_not_member_artifact`）；
- **不得**用成员桥关闭本格。

## 2. 断点证据（当前 tip／受测同源）

| 断点 | 证据 |
| --- | --- |
| 验收写入版本 | `acceptBoardItemSubmission`（`claim-contract.ts`）在 status→`accepted` 时写入 `acceptedArtifactVersion`（及 `acceptedSubmissionId`／criteria／proxy 字段），并清空 `pendingEventRelay` |
| 接受后不再调度执行 | `triggerPostSubmissionEventAdvance`：若 `item.status === "accepted"`，清 stale pending 后返回 `accepted_no_further_exec_schedule`，**不**进入 dispatcher／wake 执行 |
| 无组终稿 outbound 消费者 | 生产路径中，board 上 `acceptedArtifactVersion` 的读者仅为成员桥模块（policy／command／state／delivery）；**没有**「组终稿确定后自动集成→投递→回执」的消费者 |
| 成员桥显式拒绝组终稿 scope | `accepted-artifact-delivery.ts`：`group_final` → deny |

结论：验收态与版本钉存在；**组终稿对象的授权交付与回执链缺失**。这是主链断点，不是文档问题。

## 3. 设计原则

1. **沿现有 command／policy／state／delivery 补链**，不另建执行器、不新开 Gateway 旁路调度器。
2. **复用**成员已接受成果模式（eligibility → association → grant → send claim → receipt → recover），但 **scope／触发／授权主体** 与成员显式请求区分。
3. 组终稿确定 ≠ 成员 artifact 外发；整体验收条款与成员 item accept 可共享 board 字段，但交付意图必须是独立 `group_final` 意图。
4. 模型／渠道边界只用 doubles；本设计不碰真实 send。
5. Flag／默认行为保留迁移前语义；不靠统一 OFF 冒充安全。

## 4. 与成员桥的差异

| 维 | 成员桥（M1–M3） | 组终稿桥（拟） |
| --- | --- | --- |
| Scope | `member_artifact` | `group_final` |
| 触发 | 显式 `requestAcceptedArtifactDelivery` | 组终稿**确定＋整体验收通过**后的授权步骤（仍须显式授权命令，禁止 accept 副作用里静默外发） |
| 客体 | 单 board item 已接受成员产物 | 组级终稿对象（可由多项 accepted 聚合或单独 team deliverable／终稿版本钉；首切片钉**单一终稿版本**） |
| Eligibility | 已实现；拒绝 `group_final` | 新增 `evaluateGroupFinalDeliveryEligibility`（或扩展现函数的 group_final 分支），**不**复用成员 deny 当通过 |
| 授权主体 | trusted issuer + channel account outbound scope | 同上端口，另要求：整体验收 actor、组终稿版本、未撤销的组终稿授权 |
| 发送 | `sendAcceptedArtifactBridge`／queue | **复用**同一 delivery 发送／recover 端口，intent 带 `scope=group_final` |
| Accept 副作用 | 无外发 | **保持** `accepted_no_further_exec_schedule`；外发不挂在 accept 自动路径 |

## 5. 步骤 → 现有端口映射

| 链步骤 | 拟议行为 | 端口／落点 |
| --- | --- | --- |
| 组终稿确定 | 钉组终稿版本（artifactVersion／deliverable 链接／content hash）；写 state，不 send | **state**：组终稿记录（可挂 task／board 汇总或独立 `group_final` intent 预备行）；只读 claim-contract 已接受字段作输入 |
| 整体验收 | 校验：所需成员／终稿条款已 checked；版本匹配；拒绝裸聊天「完成」 | **policy**：整体验收纯函数；**command**：验收命令（可薄封装现有 accept 结果聚合，不替代 `acceptBoardItemSubmission`） |
| 授权交付 | trusted issuer + `evaluateChannelAccountOutboundScope` + 签发 `group_final` grant；association 先于 send | **policy** grant／eligibility；**state** txn（仿 `accepted-artifact-delivery-txn`）；**command** `requestGroupFinalDelivery`（新命令名，内部调既有 delivery 端口） |
| 实际回执 | 渠道 send double／实渠（实渠非本切片）；写 delivered／receipt | **delivery**：复用 `writeAcceptedArtifactQueueFile`／`sendAcceptedArtifactBridge` 模式，intent 区分 scope |
| 同版本恢复／重投 | 进程重启后按 grant+intent 恢复；版本漂移拒绝；撤销拒绝 | **delivery** `recoverAcceptedArtifact*` 扩展识别 `group_final`；撤销走既有 revoke 路径 |

**禁止**：新 executor；在 `triggerPostSubmissionEventAdvance` 的 accepted 分支里直接 send；用成员 `requestAcceptedArtifactDelivery` 偷偷传 `group_final`。

## 6. 最小首切片（实施时 — 本文件不实施）

1. Policy：`group_final` eligibility（accepted 终稿版本完整、target 可规范化、非 member 混用）+ 与成员 deny 对测。
2. State：一条 `group_final` delivery intent／association（版本钉 + keyHash），无 send。
3. Command：`requestGroupFinalDelivery`（或等价命名）——仅在整体验收＋授权通过后写 association／可选 grant；**不**自动调用渠道。
4. 测试：doubles only at model／channel；覆盖 deny／revoke／version mismatch／重启 recover 窗口。
5. **不**改 `acceptBoardItemSubmission` 使其副作用外发；**不**改 `accepted_no_further_exec_schedule` 语义。

后续切片（非本设计首责）：真实渠道回执、聚合多成员终稿、UI／RPC 暴露、与 PPT GAP 交界。

## 7. 测试计划（doubles）

| 场景 | 期望 |
| --- | --- |
| 未整体验收请求组终稿交付 | deny |
| `scope=member_artifact` API 传入组终稿版本 | 不升格为 group_final |
| 版本钉漂移／错误 hash | deny；无 send |
| 授权后撤销再 send／recover | refuse；无重复外发 |
| association 后进程重启 | 同版本 recover；无 grant 不 send |
| channel double 失败 | intent=unknown／blocked 可重试策略与成员桥一致；不盲重放 |
| accept 路径 | 仍只得 `accepted_no_further_exec_schedule`；send 计数 0 |

边界：模型与渠道用 doubles；不接真实模型、不接真实渠道。

## 8. 失败／未知／撤销／重启窗口

与成员桥对齐：

- **失败**：send 失败 → 保留 intent，分类可重试 vs 终端；
- **未知**：崩溃在 permit／send 中途 → recover 扫描，禁止重复成功投递；
- **撤销**：grant.revokedAtMs 或组授权撤销 → 一切 send／recover 拒绝；
- **重启**：只恢复已 association＋未撤销＋版本一致的 `group_final` intent。

## 9. Non-goals

- 真实外发／真实模型／生产重启验收／实物 PPT GAP  
- 合并、部署、DIGEST、切 LIVE  
- D0–D5／S0–S7 委派补充  
- 关闭「真实运行 GAP」清单  
- 另建执行器或 Gateway 旁路调度  
- 把成员桥验收算作组终稿完成  

## 10. 设计评审接受标准

1. 审阅方确认断点证据表成立，且同意成员桥 ≠ 组终稿链。  
2. 确认补链只走 command／policy／state／delivery，无新执行器。  
3. 确认首切片范围（eligibility＋association＋授权命令＋doubles 测试）可独立验收，且不修改 accept→no_further_exec 语义。  
4. 确认失败／撤销／重启窗口与成员桥同构、scope 隔离。  
5. 确认 Non-goals；本设计通过 **不** 等于实施放行，更不等于 T9 最终验收通过。  

**本设计待独立评审；通过前不实施。**
