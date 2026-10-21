# 批次 3：版本与权限一致（现状矩阵 + 复现结论）

祖先：开工时 `origin/main` = `c0782c3b1529cde44bd716662ce3682488b60ae4`（批次 2 squash，PR #24）。`git merge-base --is-ancestor origin/main HEAD` 在该点为真。本批不改生产默认旗，不部署。

本批只加计划版本护栏，并记下 submit / self_advance / accept 的**现状**。没有放宽这些动作的调用者、handler 范围或旗标。

## 复现结论

加载仍是 `taskId + todolistId` → 该 id 日志最后一行（`latestById`）。卡片上的 `version` 原先不回传。

| 边界                                                      | 结论                                                                                                                                                                     | 证据                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 再次 `propose` 默认新 UUID，旧 id 标 `superseded`         | **否定**「旧卡确认生效」。旧 id 确认不写 `confirmed`，新 id 保持 `proposed`                                                                                              | `todolist-version-binding.test.ts`「new id supersede」                                                                                                          |
| 显式沿用同一 `todolistId` 再 propose（版本 +1，步骤已换） | **证实**改前缺口：不带 `expectedVersion` 会确认**新步骤**。现拒绝：旧版本 `stale_version`，省略 `expected_version_required`，错版本 `version_mismatch`。带上新版本才确认 | 同文件「same id re-propose」                                                                                                                                    |
| `revise` 更换步骤（同一 id）                              | **证实**改前缺口：版本不递增，省略版本的确认落到修订后的步骤。现步骤变化则版本 +1；旧版本 / 省略版本不写确认；旧版本的再次 revise 也不改写步骤                           | 同文件「step revise bumps version」                                                                                                                             |
| 只写退回原因、不改步骤                                    | **否定**内容陈旧。版本不变，同一版本确认的仍是原步骤                                                                                                                     | 同文件「reason-only revise」                                                                                                                                    |
| 并发两次确认同一版本                                      | 锁内重读。只有一行 `confirmed`，另一边 `confirmation_consumed`。确认本身不调用 wake / submit / accept                                                                    | 同文件「concurrent confirms」                                                                                                                                   |
| 服务入口与 RPC                                            | 与上面同一套 reason。RPC `reasonCode` + `details.reason` 可区分，报文不含步骤正文                                                                                        | `todolist-acl-rpc.test.ts`「service and RPC refuse stale plan confirms」                                                                                        |
| `expectedSubmissionId`                                    | **未削弱**。缺省 `expected_submission_id_required`，错 id `submission_version_mismatch`                                                                                  | `pendingSubmissionMatches` 断言 + `collab-s3-submit-review-versioning.test.ts`「accept binds expectedSubmissionId」                                             |
| 会议确认票据                                              | **否定**「旧票仍能批准」。过期 / 已消费 / payload 变化在消费时失败，批准不发生。本批不改会议代码                                                                         | `src/organization/meeting-confirmation.test.ts`（`payload_mismatch`）、`src/agents/tools/meeting-tool.test.ts`、`ui/.../meeting-confirmation-card.node.test.ts` |

拒绝原因（调用方消息与日志同一 code，日志只有 id / 版本 / 状态，没有步骤正文）：

| code                        | 何时                               | 调用方可见文案       |
| --------------------------- | ---------------------------------- | -------------------- |
| `stale_version`             | `expectedVersion` 是更小的正整数   | 旧版本已失效         |
| `version_mismatch`          | 版本对不上，且不是更小的正整数     | 计划版本不匹配       |
| `card_invalid`              | 该 id 最新行已是 `superseded`      | 旧版本已失效         |
| `expected_version_required` | 步骤或版本已经变过，请求却没带版本 | 确认必须绑定计划版本 |
| `confirmation_consumed`     | 该版本已经确认过                   | 该确认已生效         |

对话卡复用批次 2 文案「旧版本已失效」，不新造一套。`version_mismatch` / `stale_version` / `card_invalid` 都落到这句；reason code 仍分开。

未改计划时，省略 `expectedVersion` 仍可确认当前行（既有调用方不用改）。计划内容或版本变过之后，省略版本不能再确认。

## 权限矩阵（现状，本批未放宽）

网关方法都在 `operator.write`（`src/gateway/method-scopes.ts` 的 `WRITE_SCOPE`）。协作 RPC 的演员是 `resolveDeliveryAclActor`，不是请求体里自报的 id。

| 动作              | 谁可以                                                                                                                                                                                                                                                           | 在哪检查                                                                     | self_advance                                                                              | 本批                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| `submitForReview` | **仅认领人**。否则 `actor_not_claimant`。须 UUID `submissionId`、非空 `artifactVersion`、非空正文。旗标 `claimContract` 关则 `flag_off`                                                                                                                          | `claim-contract.ts` `requireClaimantActor`，在 `submitBoardItemForReview` 内 | **不**调用 submit / accept / finalize（`self-advance.ts` 文件头；该文件不引用这两个函数） | 未改                           |
| accept            | 函数体**没有**「必须是协调者 / 授权人」的第二道角色检查。能解析出的 `actorId` 进入 `acceptBoardItemSubmission`。必须 `expectedSubmissionId` 等于当前 pending，否则 `expected_submission_id_required` 或 `submission_version_mismatch`。须 reason，并勾齐验收标准 | `acceptBoardItemSubmission` + `pendingSubmissionMatches`                     | 不得                                                                                      | 未改匹配规则                   |
| return            | 同样没有协调者角色校验。绑定 `expectedSubmissionId`                                                                                                                                                                                                              | `returnBoardItemSubmission`                                                  | 不调用                                                                                    | 未改                           |
| `trySelfAdvance`  | L2 `botMaySelfAdvanceWithoutHuman` 平台默认 false。默认写模式 dry_run。`execute` 还要 `mode=execute` 且群在 allowlist。五条资格都过才推进，且 `decisionMode` 仍是 `human_required`                                                                               | `self-advance.ts` `trySelfAdvance`；RPC `runCollaborationSelfAdvance`        | 自身不交卷、不验收                                                                        | 未改旗标与资格                 |
| 确认 Todolist     | 所有者默认不能自确认，除非该 id 同时在服务端授权确认人或协调者名单里。请求里的 `authorizedConfirmerIds` / `coordinatorBotId` 被忽略                                                                                                                              | `isAuthorizedConfirmer`；名单来自 `resolveTrustedAclForStoredTodolist`       | 不调用                                                                                    | 只增加版本绑定，确认人规则不变 |
| 修订 Todolist     | 与确认同一套授权人。步骤变化才递增 `version`                                                                                                                                                                                                                     | `reviseTodolist`                                                             | 不调用                                                                                    | 旧版本不能改写新计划           |

`git diff origin/main...HEAD` 里 submit / self_advance / accept 的权限判断没有放宽。`pendingSubmissionMatches` 仍拒绝空的和错误的 `expectedSubmissionId`。
