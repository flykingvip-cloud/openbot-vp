# Cursor 任务指令：Phase STAGING-DEPLOY（仅 Staging）

把下面整段复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-STAGING-DEPLOY-BRIEF.md`

**前置：**

| 项                    | 状态                                                                |
| --------------------- | ------------------------------------------------------------------- |
| RC0-PREP 返工         | **PASS**（2026-07-20 验收）                                         |
| `RECOMMENDED_RC0_TIP` | **`9aceda7349`**（完整 `9aceda7349da2190e00bb2fbb029175a517ecde7`） |
| Staging GO            | `GO_WITH_GATES`（见 `rc0-prep/RC0-PREP-HANDOFF.md`）                |
| **Production**        | **`NO_GO` — 本 brief 禁止生产 cutover**                             |

**必读：**

- `docs/design/convergence-evidence/2026-07-20/rc0-prep/RC0-PREP-HANDOFF.md`
- `…/rc0-prep/candidate-tip.md`
- `…/rc0-prep/release-record-DRAFT.md`
- `…/readyz-waivers/wecom.md` / `rc0-prep/readyz-waiver-status.md`
- 共享树 `deploy/production/RELEASE_RECORD.md`（只读格式对照）
- 执行计划 §11–12

**维护者闸门：**  
开始部署前须有维护者（或既有 proxy）在 handoff 勾选 **「允许 staging」**。若会话中 owner 已说「继续/部署 staging」，可视为本波授权；**仍不得** 碰生产。

---

## 角色

| 字段      | 值                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------- |
| **Task**  | `repository-wide-branch-convergence`                                                                  |
| **Agent** | `cursor-convergence-staging`                                                                          |
| **允许**  | 在 **staging** 环境构建/部署 `9aceda7349`；写 staging 报告；本地 docker build（若有 staging compose） |
| **禁止**  | 生产机/生产容器/生产 RELEASE cutover；registry 推 **生产** tag；把 wecom 失败面扩大却标绿             |

```text
TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
WORKTREE=/Users/daniel/AI项目/openbot-convergence
# checkout tip for build:
#   git -C $WORKTREE fetch  # if needed
#   git -C $WORKTREE switch --detach $TIP
# 或从 $WORKTREE 建临时 worktree 指到 $TIP，避免弄脏 convergence 分支 tip
```

---

## 硬禁令

1. **禁止** 修改生产 `openbot-gateway-rc`、生产镜像 tag `rc-amd64-v69` 的线上实例。
2. **禁止** 将 `PRODUCTION_GO` 写成 YES。
3. 部署对象 **必须** 是 **`9aceda7349`**，不得用被 monthly-usage 污染的 branch HEAD（除非维护者书面改 tip）。
4. readyz 仅允许已知 `{wecom}`；新增 failing 探针 → **STOP** 并 NO_GO。
5. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-staging
   ```

---

## 目标

1. 基于 **TIP** 产出可部署的 staging 制品（docker 镜像或 staging 脚本规定的产物）。
2. 部署到 **staging**（主机/compose 以仓库 `deploy/` 与维护者指定为准；若无 staging 环境，完成 **可部署包 + 部署手册** 并标 `STAGING_ENV=MISSING`）。
3. Smoke 通过（见下）。
4. 写 `staging/` 证据与 handoff。

---

## Smoke 清单（最低）

| #   | 检查                                                                   | 期望                              |
| --- | ---------------------------------------------------------------------- | --------------------------------- |
| 1   | `healthz`（admin/biz/gw 或 staging 等价）                              | 200                               |
| 2   | `readyz`                                                               | 200 **或** 仅 `failing:["wecom"]` |
| 3   | 登录 / platform auth 可达                                              | 成功或记录阻塞                    |
| 4   | `chat.history` 抽样（有 session 时）                                   | 非 5xx                            |
| 5   | knowledge localFolder 能力：K1 或 K2 抽样（API/测试在 staging 配置下） | 成功或记录配置缺口                |
| 6   | 回滚说明                                                               | 如何退回 v69 镜像                 |

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/staging/
  env.md                      # staging 主机/URL/compose 文件
  image.md                    # 镜像 tag、digest、构建命令、源 SHA=TIP
  deploy-log.md               # 部署步骤与结果
  smoke.md                    # smoke 表
  readyz.md                   # 实际 readyz body
  rollback.md                 # 回滚到 85eee3e7 / rc-amd64-v69
  STAGING-HANDOFF.md          # STAGING_GO 结果；PRODUCTION 仍 NO
```

可选：在 **非生产** registry 推 `openbot:rc-convergence-20260720`；**禁止** 覆盖生产 tag。

---

## 步骤建议

### 0) 检出干净 tip

```bash
cd /Users/daniel/AI项目/openbot
git worktree add ../openbot-rc0-staging 9aceda7349da2190e00bb2fbb029175a517ecde7
cd ../openbot-rc0-staging
# 确认
git rev-parse HEAD   # 必须等于 TIP
git merge-base --is-ancestor 85eee3e7b987b14b3f83301e3f200b3e1d797cc6 HEAD
```

### 1) 构建

优先使用 **完整** 前端+后端同源构建（RC0-PREP 已警告勿盲用 v69 layer Dockerfile）。  
记录命令与 digest 到 `image.md`。

### 2) 部署 staging

按 `deploy/` 中 staging 文档；若只有 production 脚本，**复制为 staging 参数** 并改端口/容器名，**绝不** 指向生产域名/容器名。

### 3) Smoke

执行上表；全文写入 `smoke.md` / `readyz.md`。

### 4) 报告 commit

在 **convergence 分支** 或 staging worktree 提交 docs（若 staging worktree 无 docs 历史，把报告拷回 `openbot-convergence` 再 commit）：

```text
docs(convergence): staging deploy evidence for RC0 tip 9aceda7349

Task: repository-wide-branch-convergence
Agent: cursor-convergence-staging
```

### 5) HANDOFF

- `STAGING_RESULT=SUCCESS|PARTIAL|FAILED`
- `PRODUCTION_GO=NO`
- 阻塞列表
- 维护者下一步：是否书面批准生产

---

## 验收标准（STAGING PASS）

- [ ] 制品源 SHA = `9aceda7349…`
- [ ] Staging 部署成功 **或** 有 `STAGING_ENV=MISSING` + 完整本地镜像与手册
- [ ] Smoke 表完整；readyz 失败面 ⊆ `{wecom}`
- [ ] `staging/` 证据齐全且已 commit
- [ ] **无** 生产变更

**FAIL：** 动了生产；或用了污染 tip；或 readyz 新增失败却标成功。

---

## 一键开场

```text
RC0-PREP 已验收 PASS。请执行 Staging 部署（禁止生产）：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-STAGING-DEPLOY-BRIEF.md

必须使用 RECOMMENDED_RC0_TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
（不要用 convergence 分支上含 monthly-usage 的脏 tip）。
产出 docs/.../staging/* 并 commit。
PRODUCTION_GO 保持 NO。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-staging
```

---

## 生产（本 brief 之后，且仅维护者）

另开 **人工** 流程：二次签字、备份、灰度、更新正式 `RELEASE_RECORD.md`。  
Agent 默认 **不** 执行生产 cutover。
