# 任务进度与交付物追踪灰度单（准备，不是部署申请）

- 起草时间：2026-11-16 22:10 CST（Asia/Shanghai）；试点 / 费用与镜像指定方式于 2026-11-16 22:31 CST 按授权人 t21u 补记。
- 状态：**还不可作为生产部署或生产灰度启用申请。** 授权人已指定生产试点为 001 企业的 CEO 账号，并授权审计方按需要设定费用上限。镜像 registry digest 仍未实际构建，本单未编造 digest，也没有使用“pending / 提交后回填”作为申请用语。正式灰度启用、生产部署和 `deploy/production/releases.jsonl` 账本变更仍保留为授权人最终批准步骤，本轮未执行。
- 范围：仅“任务进度与交付物追踪”。不等待知识增强、诊断投递或自动修复。诊断修复已单独提交，但不作为本单放行条件。
- 起草人 / 隔离交付 owner：`auditbot-batch1`

## 镜像如何指定（仓库规则；digest 仍未填写）

候选镜像必须同时满足以下条件，才能写入本单的 digest 字段：

1. 构建对象是最终要上的完整 git SHA（40 位十六进制）。本 PR 当前 tip 是 `202bf2ae5b7475be1367c36a64f5c65bb5c258e0`。若先合入 `main`，必须以合入后的 SHA 重新构建，不得沿用旧 tip 的 digest。
2. 平台必须是 `linux/amd64`。
3. 对该 SHA 打 annotated git tag `provenance/sha-<前 12 位>`。本 tip 对应 `provenance/sha-202bf2ae5b74`。每个切换必须用该 provenance 标签构建的镜像**重建容器**，禁止热覆盖 `/app/dist`（生产 README R9）。
4. 灰度单与账本填写的 `artifactDigest` 必须是 registry digest：`sha256:` 后接 64 位十六进制。不得用 Image ID，不得用 `OPENBOT_BUNDLED_VERSION`，不得用现网 LIVE 镜像 `sha256:e7babfa174f3a98762ed7b43ea7af932e8ddb0a5c6155522eb19856c5eadc61b`，也不得用账本 seq 165 的 `sha256:c0234ea2c8908e4068fd26004ac24b8b4945cf032bd097537fbc1df0e707845b` 顶替本候选。
5. 运行时 `/app/dist/build-info.json` 的 `commit` 必须等于该完整 SHA，且等于镜像 OCI `revision` 标签；不得出现 `commit=null`。检查脚本：`deploy/production/scripts/verify-live-image-identity.sh`。
6. 官方发布路径：在候选 SHA 上推送 provenance tag 后，由 `.github/workflows/docker-release.yml` 发布到 GHCR。工作流按 `ghcr.io/${{ github.repository }}` 命名，本仓对应 `ghcr.io/flykingvip-cloud/openbot-vp`。生产脚本 `cutover-from-ghcr.sh` 的默认仓库是 `ghcr.io/upbeyond/openbot`，实际填写时必须写清本次构建所推送或拉取的仓库与 digest，二者不要混用。当前 GitHub Actions 账单无法恢复，这条官方发布路径暂时不可用。
7. 替代路径：在具备 docker/buildx 或 podman、且资源足够的维护者环境按同一平台构建。不要在约 3.5GB 的生产机上裸构建（会 OOM）。审计箱没有可用的 `docker` / `podman` / `nerdctl` / `buildah` / `ctr` 客户端；`0.0.0.0:2375` 上有监听进程，但未把它当作安全隔离构建运行时。本轮未构建、未推送，digest 仍空缺。因此本单仍不是部署申请。

## 候选版本（已确定的仓库事实）

- 基线：`origin/main` = `67fc9b6461d30d97ea587c218b6914240b88344f`（PR #300 合入）
- 候选分支：`batch1/t20-task-progress-canary-20261116`
- 候选 SHA：以本 PR 推送后的分支 tip 为准。补记前 tip 为 `202bf2ae5b7475be1367c36a64f5c65bb5c258e0`；本补记合入后以新的 tip 为准，完整 SHA 写在绑定该 tip 的 PR 评论中。不得使用 `commit=null`。
- 网关 / UI 来源提交：与候选 SHA 相同（本批无独立 UI 构建产物）。
- 镜像 ID / Registry digest：**未填写。** 原因见上一节。因为 digest 未填，本单不是部署申请。
- `OPENBOT_BUNDLED_VERSION`：仅作自报版本证据，不能替代 digest。

## 试点账号与负责人（授权人 2026-11-16 t21u 已指定试点，并授权设定费用上限）

- 生产试点租户：`001`（现网 CEO 验收记录中，该租户对应企业显示名称 upbeyond）。
- 生产试点账号：001 企业的 CEO 账号。现网 CEO 员工会话身份为 `90fed19a-1c8b-4420-87e0-bcc6165e32fa`（会话 `agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa`；个人设置显示名称 CEO，所属企业 upbeyond，岗位 CEO）。身份依据：`/workspace/openbot-live-acceptance-ceo/pkg1-rerun/RESULT.md` 与同目录验收记录。本轮未对现网账号目录再做只读采集；若该账号后来被轮换，启用前须用当时有效的 CEO 员工身份复核。未使用隔离演示身份 `tenant-a` / `user-a` 作为生产试点。
- 隔离范围说明：当前实现的准入是**租户允许名单**，不是账号允许名单。若共享实例写入 `OPENBOT_PROGRESS_LEDGER_TENANT_ALLOWLIST=001`（或等价 `gateway.progressLedger.tenantAllowlist`），企业 001 下其他账号也会进入进度能力范围。本单不能据此宣称“仅 CEO 一人”的账号级灰度。若授权人要求只对 CEO 账号开放，需要再补账号级门控，或为该账号使用独立实例。
- 生产负责人：授权人未另行指定其他人；本单将试点负责人记为上述 001 企业 CEO 账号。
- 费用上限：观察期内合计 **USD 20**（授权人 2026-11-16 t21u 授权审计方按需要设定）。任务进度本身不必然产生上游模型费用，但试点账号在观察期内的正常对话可能产生费用。官方预算闸是调用后入账，不是调用前预留：越过上限的那一次请求可能超支，下一次必须被拦截，否则触发停止条件。
- 建议观察期：若被批准启用，连续 7 个自然日，或授权人另行指定的窗口。该建议不是已批准的观察窗口。
- 隔离演示身份（仅作演示证据，不是生产试点）：`tenant-a` / `user-a`，见 `/workspace/openbot-vp-audit/batch1-evidence/t20-official-progress/`。

## 配置差异与隔离范围（已实现；试点租户按 t21u 套用为 001）

`OPENBOT_PROGRESS_LEDGER_ENABLED` 是进程全局开关：env `{1,true,yes,on}` **或** `gateway.progressLedger.enabled === true` 即可打开。`env=0` **不能**覆盖 `config.enabled=true`。默认值不会打开这个进程全局开关。

会话任务进度投影还有一个独立来源：`OPENBOT_CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE` 默认开启，因此即使两个进程全局来源都未设置，会话任务仍可能写入并投影进度。长周期 cron 的 `createCronLedgerSession` 也不走这个全局门。

共享实例要宣称单租户灰度，必须设置非空租户允许名单：

- `OPENBOT_PROGRESS_LEDGER_TENANT_ALLOWLIST`
- 和/或 `gateway.progressLedger.tenantAllowlist`

允许名单为空且进程开关打开，是进程范围启用，不是单租户灰度。清空允许名单不是安全回滚，因为它会把准入扩大到所有租户。允许名单设为 `001` 是企业 001 范围，不是仅 CEO 账号。

关闭必须覆盖全部开启来源。安全关闭是关闭开关，而不是只写 `OPENBOT_PROGRESS_LEDGER_ENABLED=0`：

- `OPENBOT_PROGRESS_LEDGER_SHUTDOWN=1`，和/或 `gateway.progressLedger.shutdown=true`
- Shutdown 优先于所有开启来源，并停止会话任务进度投影与新的 ledger seed
- 环境变量在同进程下一次请求生效；配置文件变更需要进程重启（或使 `loadConfig()` 缓存失效）

| 项                                                                                       | 生产当前默认           | 若本灰度被批准后的建议取值                   | 回滚                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `OPENBOT_PROGRESS_LEDGER_ENABLED`                                                        | 关（unset / 非显式真） | 可开，但不能单独作为单租户证明               | 不能只设 `0`；须同时处理 config.enabled              |
| `OPENBOT_PROGRESS_LEDGER_TENANT_ALLOWLIST` / `gateway.progressLedger.tenantAllowlist`    | 空（不限制）           | `001`（企业范围，不是仅 CEO 账号）           | 不要清空名单；改用 shutdown 或把试点从非空名单中移除 |
| `OPENBOT_PROGRESS_LEDGER_SHUTDOWN` / `gateway.progressLedger.shutdown`                   | 关                     | 保持关                                       | 设为真以停止投影                                     |
| ConversationTask close-requires-evidence                                                 | 默认开                 | 保持现有默认，除非授权人要求连证据写入一并停 | 仅靠进度 env=0 不够；shutdown 会停止投影             |
| ConversationTask activation 五开关、知识自动生成、诊断自动修复、外部投递、四个编排主开关 | 默认关                 | 保持关；本单不包含这些能力                   | 保持关                                               |

代码运行时默认值本批未把进程全局开关翻成默认开。Account Worker 示例文案与 `considerReadonlyInvoke` 注释仅作说明，不是生产批准。

## 成功指标

1. 试点用户可发起任务，并在进度视图中看到进行中状态。
2. 任务完成后可取得真实交付物（文件内容存在且可打开），而非仅有占位 URI。
3. 刷新或重新打开会话后，任务状态仍为已完成（或已关闭），交付物仍可读取。
4. 重复提交同一任务入口不会创建第二条互相冲突的进行中任务（幂等或同 task id）。
5. 允许名单之外的租户不会获得进度投影，也不能读取该试点租户的任务库与交付物。本项按租户 `001` 验证，不把企业 001 内其他账号视为“名单之外”。
6. 观察期内无跨租户写入、无生产执行模式拒绝被绕过、无未批准的自动修复或外部投递。
7. 观察期内合计费用不超过 USD 20；越过上限后的下一次上游调用被官方预算闸拦截。

## 停止条件

- 跨租户读取或写入成功。
- 出现不可逆删除、自动修复执行、或外部频道投递。
- 生产执行模式拒绝被绕过。
- 观察期内合计费用超过 USD 20，或官方预算闸未能拦截下一次上游调用。
- 进度状态在刷新后丢失或与交付物不一致，且无法在观察期内修复。
- 共享实例在允许名单为空时被当作单租户灰度启用。
- 共享实例在仅允许租户 `001` 时被当作“仅 CEO 账号”灰度启用。

## 回滚方案与真实 OpenBot 演练

- 生产回滚（未执行）：设置 shutdown（env 和/或 config，配置变更需重启）；不要只写 `OPENBOT_PROGRESS_LEDGER_ENABLED=0`；不要清空租户允许名单；保持其余未批准开关关闭。镜像回退在 digest 未填前不能作为可执行步骤。
- 恢复必须符合仓库前向发布规则：`deploy/production/scripts/verify-forward-only.sh`。恢复 SHA 必须是候选的祖先（除非有批准的 `--intentional-revert`）。本轮允许的恢复版本是 `origin/main` `67fc9b6461d30d97ea587c218b6914240b88344f`。本批未改 ledger 存储格式。
- **撤销先前结论：** Python 监听器演练不等于应用回滚通过。该记录只作为历史索引保留在 `/workspace/openbot-vp-audit/batch1-evidence/release-prep/rollback-drill.json`。
- 本轮已在审计箱用候选 OpenBot 官方 API 和独立持久化目录做真实回滚演练（不触达生产或香港容器）：见 `/workspace/openbot-vp-audit/batch1-evidence/t20-rollback/rollback-drill.json`。演练步骤：打开进度并完成一个任务 → 应用 shutdown（环境变量按真实机制在下次调用生效）→ 新请求不再投影、原交付物仍可读取 → 重新启用后同一交付物与已完成进度仍可读。

## 与知识增强 / 诊断投递 / 自动修复的关系

本单独立。知识复用已进入正式入口集成验证，诊断转换已单独修复，二者都可以作参考证据，但不作为本单放行条件，也不在本单启用外部诊断投递或自动修复。`DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true` 已在 origin/main 上，本批未改该常量，也不把本工作当作生产诊断投递启用。
