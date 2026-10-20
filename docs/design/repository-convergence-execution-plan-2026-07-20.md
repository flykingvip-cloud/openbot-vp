# OpenBot 仓库收敛执行计划（务实版）

**状态：** **`BASE LOCKED`（2026-07-20 proxy sign-off）**  
**Locked SHA：** `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`  
**Decision：** `docs/design/convergence-base-decision-2026-07-20.md`  
**含义：** Day0 证据完成且代理维护者已锁 base；landing **仅** 在 `convergence/2026-07-20` worktree。共享树仍禁止批量 merge；**新** 生产 RC cutover 需二次确认。  
**日期：** 2026-07-20  
**Owner：** repository-convergence（文档）/ Human maintainer（Base 与生产）  
**Task：** `repository-wide-branch-convergence`  
**Agent：** `grok-evolution-closure`  
**Spec / Loom：** `.kiro/specs/repository-wide-branch-convergence/tasks.md` · `.loom/registry.yaml` task id 同上  
**上位文档：** [repository-wide-branch-convergence-plan-2026-07-20.md](./repository-wide-branch-convergence-plan-2026-07-20.md)（治理宪法）  
**本文件角色：** 在不动共享工作树批量 merge 的前提下，把宪法压成 **可排期、可停机、可验收** 的执行序列。  
**审查响应：** 九项初审已落实；复审补齐 Loom/spec 登记与安全候选 L3 路由。

---

## 0. 一句话目标

用 **独立 worktree + 半自动 feature ledger + 横切不变量优先**，在 2–3 周内产出 **可复现的 RC0**（身份/会话/知识闭环 + 同源 UI/backend），其余功能显式 landed / deferred / rejected；在此之前 **禁止** 用“HEAD 更新”直接推生产。

---

## 0.1 批准门槛（审查结论落地）

| 项                        | 严重度 | 要求                                                        | 本修订                 |
| ------------------------- | ------ | ----------------------------------------------------------- | ---------------------- |
| Canonical base 仅靠 CI 绿 | P0     | 候选 base 必须通过 **生产关键能力 parity 对比**             | §4                     |
| 未认领自动 park-branch    | P0     | 超时只许 **freeze-evidence**；park 仅 owner/人工 patch      | §7.3                   |
| 远程审计仅 git refs       | P1     | tags/PR/已删分支/cherry 等价/merge·squash                   | §8.0–8.2               |
| readyz known-fail 过宽    | P1     | **带截止日的 waiver**；未扩大失败面；否则禁入生产           | §11.0                  |
| 数据仅“有备份点”          | P1     | 格式版本、dry-run、读兼容、restore 演练、一致性、不可逆阻断 | §11.1                  |
| 移动端仅抽检              | P1     | 协议编译 + 登录握手 + tenant/session 字段兼容测试           | §10.6 / §11.1          |
| Manifest 字段不足         | P2     | 扩展 auth/tenant/storage/migration/wiring/…                 | §8.6                   |
| 知识单路径演示            | P2     | 成功/越权/隔离/幂等/失败恢复/重启 自动化                    | §10.5 / 附录 D         |
| 计划 untracked            | P2     | 任务登记 + 归因提交                                         | 本文件 header + commit |

**未完成 §4 parity 包与 §7.3 处置规则前，不得签署 Day 0 Canonical Base 决策。**  
**未完成 §8 远程审计扩展前，不得创建 convergence worktree 并开始 landing（允许只读取证）。**

---

## 1. 现状锚点（执行日需重采）

> 下列数字以起草时快照为准；Phase A 脚本会刷新。

| 项                                       | 快照（2026-07-20）                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| 共享工作树分支                           | `fix-scoped-package-templates`                                                           |
| HEAD（示例）                             | `35e390762b`（会变化）                                                                   |
| vs `origin/fix-scoped-package-templates` | ahead ~334                                                                               |
| 脏文件                                   | ~48                                                                                      |
| 生产 revision（上位文档）                | `85eee3e7…` / 镜像 `openbot:rc-amd64-v69`                                                |
| 上位文档已确认                           | 无单一“最新分支”；RC 与 main 分叉；工作树多 owner                                        |
| 重要提醒                                 | **HEAD 相对 `origin/main` 可有数百独有提交；生产行为 ≠ `origin/main`；CI 绿 ≠ 功能完整** |

**硬约束（继承上位文档）：**

- 共享工作树 = **证据现场**，不是集成场地。
- 执行前/中 **禁止** 在共享树：`merge` / `rebase` / `cherry-pick` 批量 / `stash` 清场 / 删分支 / 未归因提交。
- Agent **不得** 自行切换共享树分支、**不得** 自行 `git worktree add` / 创建 park 分支 / production cutover。
- 未认领内容 **不得自动处分**（见 §7.3）。

---

## 2. 成功定义（分阶）

### 2.1 RC0 成功（本计划主交付，约 D10–D15）

- Canonical base 书面锁定，且 **parity 包已通过**（§4.2）。
- 横切不变量（tenant/session/method-scopes）有测试与 known-fail **+ 有效 waiver**。
- 知识导入 **自动化验收矩阵** 通过（§10.5），非单次人工演示。
- 客户端协议门禁通过（§10.6）。
- 数据升级/回滚门禁通过（§11.1）。
- UI 与 backend **同一 commit** 全量镜像；release record 含 SHA + digest。
- Feature ledger v0 中 RC0 范围包有 landed / deferred / rejected 决策，无“悬空候选”。
- **生产准入另需：** readyz waiver 有效且失败面未扩大；否则 RC0 可只停在 staging。

### 2.2 全量收敛成功（上位文档 §16，本计划 Phase F 之后）

- 活跃/历史/PR/tag 候选已分类；有价值功能 landed 或书面 DEFER/REJECT。
- 工作树无 UNATTRIBUTED/CONFLICT；hotfix/RC 回灌策略运转。
- 生产灰度完成且 **可验证回滚**。

**在 RC0 之前，状态只能写 `in progress` / `RC0 staging-ready` / `RC0 prod-blocked-on-waiver`，不得写“全仓库已同步”。**

---

## 3. 组织与轨道

### 3.1 角色

| 角色              | 职责                                                               | 人数建议    | 登记名（Day 0 前书面确认）                                     |
| ----------------- | ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------- |
| Human maintainer  | 拍板 base（含 parity 签字）、功能取舍、**readyz waiver**、生产窗口 | 1           | _TBD — 阻断 Base 签字若空_                                     |
| Convergence owner | 唯一 lander；热文件协调；非产品冲突 24h 默认裁决                   | 1           | docs/Day0: `grok-evolution-closure`；merge lander: _TBD human_ |
| Domain reviewers  | Auth/Tenant、Gateway/Session、Knowledge、UI/Mobile、Deploy         | 各 1 或兼任 | _TBD_                                                          |
| Feature owners    | 闭环证据；**仅在自己确认的独立 worktree** 执行 park                | 按包        | 按 feature ledger                                              |
| Release owner     | 干净构建、staging、数据演练、record、rollback                      | 1           | _TBD_                                                          |
| Hotfile owner     | method-scopes / server-methods / i18n / package.json 接线          | 1           | _TBD_（可与 convergence owner 兼任）                           |
| Security reviewer | GHSA/security 候选；独立于 feature owner；私密证据                 | 1           | _TBD — 见 §8.2 L3_                                             |

名单定稿写入：`.kiro/specs/repository-wide-branch-convergence/tasks.md` Role roster 与 Base 决策单。

### 3.2 三轨并行（共享树只读）

```text
Track A  证据与账本     取证 + 全方位远程审计 + 半自动 ledger v0
Track B  基线与场地     维护者拍板（含 parity）+ 人类创建 convergence worktree
Track C  优先包落地     4A→4B→4B′→会话/知识薄包 → RC0
```

新功能默认 **禁止** 再进共享 `fix-scoped-package-templates` 工作树；一律由 **人类** 建 feature worktree，并登记 ledger `target_wave`。

---

## 4. 决策树：Canonical Base（Day 0 硬门禁）

**未书面确认前，禁止任何 merge 进 convergence。**  
**仅 “政策主干 + CI/构建可信” 不足以选定 base。**

### 4.1 候选集合

至少评估三个候选（可并列跑 parity，再选一）：

| 候选 ID | 典型 ref                                                  | 说明                                                        |
| ------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| C-main  | `origin/main` @ 锁定 SHA                                  | 政策主干候选；**不能**因 CI 绿直接胜出                      |
| C-dev   | `fix-scoped-package-templates` 上 **干净可构建** 锁定 SHA | 非共享脏 tip；须先剥离/冻结脏文件证据                       |
| C-prod  | 生产 revision `85eee3e7…`（示例，以 release record 为准） | 行为锚点；默认 **不作** merge base，仅 rollback/parity 对照 |
| C-rc    | `origin/release/candidate-20260712`                       | 默认功能源 + 历史 RC，非 base，除非维护者书面指定           |

### 4.2 硬门禁：生产关键能力 Parity 包（P0）

每个候选 base 相对 **生产运行基线（C-prod）** 与 **当前已验收能力清单** 输出 `base-parity-<candidate>.md`，至少覆盖：

| 维度                 | 必须回答                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **生产关键功能清单** | 生产在用能力是否仍在候选 tip 可达？缺失项列表 + 严重度                                                 |
| **数据格式**         | config / tenant store / session / KB index / memory / billing / connector 的 schema 或版本字段是否兼容 |
| **RPC 面**           | 生产客户端依赖的 method 是否仍注册；method-scopes 是否覆盖                                             |
| **客户端协议**       | Control UI / employee / macOS/iOS/Android 握手与关键 DTO 是否兼容（编译或契约测试）                    |
| **部署能力**         | 镜像构建、Nginx/域名、env 矩阵、healthz/readyz、回滚路径是否可用                                       |

**判定规则：**

1. **CI 绿色 ≠ 功能完整** — CI 只是必要条件之一。
2. 任一维度出现 **P0 缺口且无迁移/回填计划** → 该候选 **淘汰** 或仅可作 `ACCEPT_WITH_REWORK` 源，不得锁为 base。
3. 维护者签署决策单时必须附：**所选候选的 parity 报告路径 + 未闭合缺口的处置（迁入 RC0 / DEFER / 阻断）**。
4. HEAD 相对 main 的“数百独有提交” **默认不** 整枝并入 base；只作为 feature 候选池。

### 4.3 决策流程（修订后）

```text
Step 0: 固定对照锚点
  - production_sha / image / release record
  - critical_feature_checklist.md（从生产与验收记录生成）

Step 1: 对 C-main、C-dev（及可选 C-rc tip）跑 §4.2 parity
  - 产出 base-parity-*.md

Step 2: 维护者选择唯一 base
  Q-policy: 政策上是否要求最终汇入 main？
    - 是 → 优先 C-main，但仅当 parity 无未闭合 P0
    - 否/ C-main P0 失败 → 选 C-dev 干净 SHA，并登记 “回灌 main” 为后续 wave
  Q-rc: C-rc 仅作源，除非书面仍为发布线
  Q-prod: C-prod 永不单独当 integration base（除非维护者紧急冻结线）
  Q-bulk: 禁止 “整枝数百提交 = 主线”

Step 3: 写入决策单（附录 A）并锁定 SHA
```

### 4.4 推荐落盘

```text
branch:   convergence/2026-07-20
worktree: <独立干净目录，仅人类创建>
base:     <parity 通过后的锁定 SHA>
evidence: docs/design/convergence-evidence/2026-07-20/base-parity-*.md
```

---

## 5. 时间盒总览

| Phase  | 名称                     | 日历（建议）           | 出口门禁                                         |
| ------ | ------------------------ | ---------------------- | ------------------------------------------------ |
| **D0** | 冻结 + parity + 拍板     | 第 0–1 天              | Base 决策单 **含 parity 附件** + 禁令生效        |
| **A**  | 取证 + 脏文件冻结规则    | D0–D1                  | 证据文件 + 认领表；超时仅 freeze-evidence        |
| **B**  | 全方位远程审计 + 账本 v0 | D1–D4                  | ledger 去重（含 cherry 等价）；≤50–80 active     |
| **C**  | 场地就绪                 | D2–D3（parity 通过后） | 人类 worktree；基线 build                        |
| **D**  | 优先落地                 | D3–D12                 | 4A+4B+4B′+会话/知识+客户端协议门禁               |
| **E**  | RC0                      | D12–D15                | 同源镜像 + 数据演练 + waiver + staging；生产另判 |
| **F**  | 扩展收敛                 | D15+                   | 上位 §16                                         |
| **G**  | 长期治理                 | 与 E 并行              | manifest CI、分支 TTL、provenance                |

若 D0 parity/拍板拖延：**整计划时钟停表**。

---

## 6. Phase D0：冻结与拍板

### 6.1 动作

1. 生成 `critical_feature_checklist.md`（生产在用 + 已验收能力）。
2. 对候选 base 跑 **§4.2 parity**（可只读 agent 辅助，签字必须人类）。
3. 维护者填写并签署 **Canonical Base 决策单**（附录 A）。
4. 宣布共享工作树 **只读集成禁令**。
5. 指定 convergence / release / 热文件 owner。
6. 启动 48h **脏文件认领**（附录 B）；公示超时 = freeze-evidence only。

### 6.2 明确禁止

- 共享树 merge/rebase/cherry-pick/stash 清场。
- 未归因提交；**未认领自动 park / 自动建分支**。
- Agent 切换共享树分支或创建 worktree/park 分支。
- 生产叠 layer / 用脏树出镜像。
- 无 parity 附件的 Base 签字。

### 6.3 出口

- [ ] `base-parity-*.md` 齐全且维护者已阅
- [ ] 决策单落盘并锁定 SHA
- [ ] 角色名单与禁令周知
- [ ] 脏文件认领表发出

---

## 7. Phase A：取证（Track A）

### 7.1 产出路径

```text
docs/design/convergence-evidence/2026-07-20/
  git-status-snapshot.txt
  branch-ref-inventory.tsv
  tag-ref-inventory.tsv              # 含 release/生产 tag 可达性
  worktree-inventory.txt
  remote-ahead-behind.tsv
  production-release-baseline.md
  unattributed-and-conflict-files.md
  known-fail-baseline.md
  readyz-waivers/                    # 见 §11.0
  base-parity-*.md
  critical_feature_checklist.md
  remote-audit/                      # 见 §8.0
    pr-inventory.tsv
    deleted-branch-recoverable-shas.tsv
    patch-id-equivalents.tsv
```

### 7.2 共享树允许的动作

- 只读 `git` / `gh` 查询；**只写** 证据目录下的新文件。
- **不** `git gc --prune`、不删分支、不改业务源码（除非单独任务且有归因）。

### 7.3 脏文件处置矩阵（P0 修订）

| 处置                  | 谁可以执行                                                 | 条件                                                                       |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `commit-to-stream`    | **已确认 owner**，在 **其独立 worktree/分支**              | 有 Task、可测、不整文件热文件                                              |
| `park-branch`         | **仅已确认 owner** 在独立 worktree；或 **人类** 导出 patch | 有价值未完成；**禁止** 从混合脏树按文件自动切分支                          |
| `patch-bundle`        | 人类 / owner                                               | `git diff` / 分文件 patch + **内容哈希** 清单；存证于 evidence，不改共享树 |
| `discard`             | owner 书面确认                                             | 生成物/过期实验                                                            |
| `freeze-evidence`     | 默认 / 超时自动（唯一自动项）                              | 保留共享树现状作证据；**禁止 land**；不推远程                              |
| `integration-hotfile` | 仅 convergence owner（在 convergence worktree）            | 热文件接线                                                                 |

**超时规则（48h）：**

- 未认领 → **仅** `freeze-evidence`。
- **不得** 自动 `park-branch`、自动 commit、自动 worktree。
- 之后若需 park：owner 认领 → 人类或 owner 在干净 worktree 检出相关提交/应用 **patch-bundle** → 再推 `park/...`。
- 混合脏树中交叉修改 **不得** 按路径机械拆分进不同分支。

### 7.4 出口

- [ ] 证据文件带时间戳
- [ ] 认领表：每文件 owner 或 `freeze-evidence`
- [ ] 无“系统已自动 park”类记录

---

## 8. Phase B：全方位远程审计 + 账本（Track A）

### 8.0 远程审计范围（P1 — 超出 git branch refs）

机器 + `gh` 只读，产出 `remote-audit/`：

| 来源             | 内容                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Branches**     | 全 `origin/*` ahead/behind、日期、作者活跃度                                                |
| **Tags**         | 全 tags；**release tags**；生产 image 对应 tag/SHA **可达性**（是否仍在远端、是否祖先关系） |
| **GitHub PRs**   | open / closed / merged；head SHA、merge commit、squash 后 tip                               |
| **PR 元数据**    | review 结论摘要、CI 结论（pass/fail/取消）、关联 issue/spec                                 |
| **已删远程分支** | 经 `refs/pull/*/head`、`refs/pull/*/merge`、仍可达的 commit 恢复候选列表                    |
| **等价判断**     | `git cherry` / **patch-id** 聚类；标记 `already-equivalent`，禁止重复 land                  |
| **历史形态**     | merge commit vs squash vs rebase 后的 **功能等价** 行合并到同一 `feature_id`                |

**不做全方位审计，不得声称 ledger 完整。**

### 8.1 不要做的事

- 不对每个 commit 手工打满 10 类标签。
- 不把 patch-id 相同的提交当成多个 feature。

### 8.2 分类层级

| 层  | 范围                                    | 方式                    |
| --- | --------------------------------------- | ----------------------- |
| L0  | branches + tags + PR inventory          | 机器                    |
| L1  | 路径启发式粗域                          | 机器                    |
| L1b | patch-id / cherry 等价折叠              | 机器                    |
| L2  | 高价值分支 + 高价值 PR + 可恢复已删 tip | 人聚合成 feature        |
| L3  | candidate / conflict / **security**     | 人审 + 决策（安全见下） |

#### L3 安全候选路由（P2 / 复审必补）

审计全部 PR、历史提交与可恢复 deleted tips 时，**可能触及安全修复或 advisory**。强制路由：

| 规则                     | 要求                                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **先读 trust model**     | 任何 security / GHSA / advisory / CVE / 鉴权绕过类候选，审查前先读根目录 [`SECURITY.md`](https://github.com/upbeyond/openbot/blob/main/SECURITY.md) 与仓库 trust/threat 边界（含 out-of-scope 与 false-positive 模式）。   |
| **独立 reviewer**        | 安全候选 **不得** 仅由提出该 feature 的 owner 自审；须指定 **Security reviewer**（可与 Human maintainer 兼任，但须在 roster 点名）。                                                                                       |
| **私密证据路径**         | 含未公开细节的 repro、PoC、密钥痕迹、未发布 advisory 正文 → 只放 **私密** 路径（例如本地/维护者保险库、GitHub Security Advisory private fork），**禁止** 写入 `docs/design/convergence-evidence/**` 公开树或普通 PR 描述。 |
| **公开 ledger 脱敏**     | `feature-ledger.csv` 仅可出现：`feature_id`、`security-sensitive` 标签、公开已合并 SHA、**已发布** GHSA id、决策枚举；**不得** 粘贴未公开 advisory 正文、利用步骤或秘密材料。                                              |
| **决策遵循 trust model** | 严重度与是否 `ACCEPT_*` / `DEFER` / `REJECT` 以 `SECURITY.md` 验收门槛与边界为准；parity-only / prompt-injection-only 等 out-of-scope 模式不得抬成 P0 合并理由。                                                           |
| **合并通道**             | 未公开安全修复优先走 private advisory 流程（见 `SECURITY.md` Maintainers / GHSA CLI）；公开树 landing 仅在披露策略允许之后。                                                                                               |
| **分类标记**             | ledger `decision` 旁或 `status` 使用 `security-sensitive`；远程审计机筛关键词（`GHSA-`、`CVE-`、`security`、`advisory`）一律进 L3 安全队列，不得静默 `ACCEPT_AS_IS`。                                                      |

### 8.3 高价值来源（L2 必做）

分支（可增删）：

1. `origin/release/candidate-20260712`
2. `fix-scoped-package-templates`（干净 tip / 已验收区间）
3. `origin/wip/main-uncommitted-2026-07-13`
4. `origin/kiro-hybrid-isolation/hybrid-gateway-isolation`
5. `origin/kiro-daibai/chat-checkpoint-rollback`
6. `origin/pr/edgsc-knowledge-universe`
7. `origin/pr/workbench-enterprise-ui`
8. `origin/pr/platform-auth-control-ui`
9. `origin/pr/data-directory-lifecycle`

另加：与上述路径重叠的 **open/merged PR**、指向生产/RC 的 **tags**、audit 列出的 **recoverable deleted tips**。

Dependabot / 纯 chore：单独 batch。

### 8.4 Feature ledger v0

```text
feature_id,domain,source_kind,source_ref,source_shas,equivalent_shas,owner,status,
ui,rpc,auth,storage,runtime,tests,docs,deploy,
dependencies,conflicts,decision,target_wave,manifest_path
```

- `source_kind` ∈ branch | tag | pr | pull_ref | patch_bundle
- `equivalent_shas`：patch-id 折叠结果
- **规模：** active ≤50–80 行

### 8.5 决策枚举

`ACCEPT_AS_IS` | `ACCEPT_WITH_REWORK` | `REIMPLEMENT_ON_CURRENT_ARCH` | `DEFER` | `REJECT` | `NEEDS_PRODUCT_DECISION` | `ALREADY_EQUIVALENT`

禁止理由：仅“分支更新”或“PR 更新”。

### 8.6 Feature manifest（P2 扩展）

路径：`docs/design/convergence-evidence/2026-07-20/feature-manifests/*.yaml`

```yaml
knowledge_import:
  feature_id: knowledge_import
  decision: ACCEPT_WITH_REWORK
  target_wave: D-knowledge
  ui_kinds: []
  rpc_methods: []
  runtime_modules: []
  auth_rules: [] # method scopes / roles
  tenant_scope: [] # isolation boundaries
  storage: [] # files/sqlite/index paths
  migration: [] # version bumps / expand-contract
  startup_wiring: [] # server-methods, maintenance, env
  observability: [] # metrics/logs/ready probes
  client_contracts: [] # UI/mobile protocol models
  deploy_assets: [] # nginx, compose, scripts
  tests: []
  rollback_test: [] # named restore/rollback cases
```

CI：Phase D 起 **warn**；RC0 关键包 **error**（缺闭环字段或测试引用）。

### 8.7 出口

- [ ] `remote-audit/` 齐备
- [ ] ledger 已折叠等价提交
- [ ] Top 包 manifest 含扩展字段
- [ ] RC0 范围冻结

---

## 9. Phase C：集成场地（Track B）

**前置：** §4 决策单已签；§8.0 远程审计至少 L0+L1b 完成（L2 可并行收尾）。

### 9.1 仅人类创建 worktree

```bash
git fetch origin --tags
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'  # 若需 PR refs
git worktree add ../openbot-convergence <LOCKED_BASE_SHA>
cd ../openbot-convergence
git switch -c convergence/2026-07-20
```

Agent **不得** 代为执行上述命令。

### 9.2 基线门禁

```bash
pnpm install
pnpm build
pnpm tsgo   # 记录基线；后续只允许改善
```

记录 Node/pnpm、build、tsgo 基线、**生产 readyz 现状**（不等于永久豁免）。

### 9.3 热文件单 owner

| 文件/区                                    | Owner                 |
| ------------------------------------------ | --------------------- |
| `package.json` / lockfiles                 | convergence owner     |
| `src/gateway/method-scopes.ts` 等          | convergence + Gateway |
| i18n `en.ts` / `zh-CN.ts`                  | UI + convergence      |
| `ui/src/ui/app.ts` / employee render-model | UI                    |
| 协议模型（含 Swift/Kotlin 共享契约）       | UI/Mobile + Gateway   |
| `deploy/production/**`                     | release owner         |

### 9.4 出口

- [ ] worktree 路径与 base SHA 写入决策单
- [ ] 基线报告
- [ ] 热文件 owner 公示

---

## 10. Phase D：优先落地（Track C）

每个子波：**实现 → P0/P1 → 热文件 wiring commit → checkpoint → 下一波**。

### 10.1 D0 — 构建基础（4A）

Checkpoint：`pnpm build` 相对基线无回归。

### 10.2 D1 — 身份 / 租户 / 权限（4B）

Checkpoint：权限负向 + tenant isolation scoped tests。

### 10.3 D2 — 横切不变量（4B′）

| 不变量           | 验收要点                                                             |
| ---------------- | -------------------------------------------------------------------- |
| Session 读写同根 | tenant 写路径 + history promote（空较新 entry 不挡 heal）            |
| method-scopes    | 相对 known-fail **不恶化**                                           |
| Attribution      | 热文件策略保持                                                       |
| Health           | healthz 活；readyz 见 §11.0（**无有效 waiver 不得把 503 当永久绿**） |

### 10.4 D3 — 会话 / Gateway 薄包

Checkpoint：登录 → roster → chat.history 刷新后仍在（自动化或脚本化）。

### 10.5 D4 — 知识 / 数据薄包（P2 加强）

**不得** 仅用“一条路径可演示”关闭。

**自动化验收矩阵（最低）：**

| 用例            | 要求                                   |
| --------------- | -------------------------------------- |
| 成功路径        | 导入 → 索引/物化 → 检索/Agent 可见     |
| 越权拒绝        | 无权限主体失败且无数据泄漏             |
| Tenant A/B 隔离 | A 数据对 B 不可见                      |
| 重复同步幂等    | 二次同步不产生重复权威对象或可接受去重 |
| 失败恢复        | 中途失败可重试/可诊断                  |
| 重启持久化      | 进程重启后状态与索引一致               |

Checkpoint：矩阵全部 pass，或 fail 项进入 **带 owner 的 known-fail**（非 readyz 类，知识域默认不允许无截止日挂起）。

### 10.6 客户端协议门禁（P1 — 非全量功能、非纯抽检）

**延后：** 移动端全量 UX/feature parity。  
**RC0 必做（自动化）：**

| 平台       | 最低门禁                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| Android    | 协议/模型相关模块 **编译**；登录握手测试；tenant/session 关键字段序列化兼容测试 |
| iOS        | 同上（含 `GatewayModels` 等共享协议源）                                         |
| macOS      | 同上（Control UI bootstrap / 登录路径契约）                                     |
| Control UI | 与 Gateway 的 session/tenant bootstrap 契约测试                                 |

共享工作树若已有移动端/登录 WIP：**冻结为 evidence 或由 owner 迁入 feature 分支**；convergence 只收 **契约测试通过** 的变更。

### 10.7 明确延后（ledger DEFER）

- 移动端全量产品功能
- 商业大包（除非已验收且无第二 SoT）
- 架构冲突大爆炸 UI
- 无 patch-id 归属的重复实现

### 10.8 验证分层

| 级别   | 何时          | 内容                                                                     |
| ------ | ------------- | ------------------------------------------------------------------------ |
| **P0** | 每 feature 包 | scoped tests + typecheck + lint + manifest 闭环勾选                      |
| **P1** | 每子波末      | gateway/session/tenant/knowledge + **客户端协议门禁**                    |
| **P2** | RC0 前        | build + 全量 test 差分（pass / known-fail / new-fail）                   |
| **P3** | staging       | 黄金路径矩阵 + multi-tenant + **readyz 策略 §11.0** + **数据演练 §11.1** |

---

## 11. Phase E：RC0

### 11.0 readyz / readiness 策略（P1）

**禁止：** 生产当前 `readyz=503`（如 wecom）自动继承为永久 known-fail。

**规则：**

1. 每个失败探针单独建 waiver 文件：  
   `docs/design/convergence-evidence/2026-07-20/readyz-waivers/<probe>.md`
2. Waiver **必须** 含：
   - probe 名与错误摘要
   - **影响范围**（租户/渠道/是否 block 登录与核心 chat）
   - **owner**
   - **截止日期**（到期未修 → 阻断生产，可保留 staging）
   - 是否 RC0 引入/扩大失败面的对比证据（staging vs 生产基线）
3. **RC0 → staging：** 允许在有效 waiver 下部署。
4. **RC0 → 生产：**
   - 无有效 waiver 的失败 → **禁止**；
   - 有 waiver 但 **失败面扩大** → **禁止**；
   - 核心路径（登录、chat、知识导入矩阵）被 waiver 波及 → **禁止**，除非维护者 **二次** 签署生产例外（独立段落，不得复用旧 waiver）。

### 11.1 数据迁移与可验证恢复（P1）

RC0 准入除“写明备份点”外，必须具备：

| 项               | 要求                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| 数据格式版本清单 | tenant store、session、KB index、memory、billing、connector credentials 等版本表 |
| upgrade dry-run  | 在副本或 staging 执行升级，记录日志与差异                                        |
| 前后版本读兼容   | 旧数据可被新代码读取（或 expand-contract 已完成）                                |
| restore 演练     | 从备份恢复到可服务状态（有时间盒记录）                                           |
| 回滚后一致性验证 | 回滚镜像后抽样校验会话/知识/凭证仍一致或可接受降级                               |
| 不可逆迁移阻断   | 无双写/无回滚路径的迁移 **不得** 进入 RC0 生产；须拆期或提供正向修复工具         |

### 11.2 RC0 准入清单

- [ ] RC0 范围 ledger 全 landed 或书面移出
- [ ] convergence 干净；无 UNATTRIBUTED/CONFLICT
- [ ] UI+backend 同 commit；image digest 入 record
- [ ] P2 无未解释 new-fail
- [ ] 知识矩阵 §10.5 pass
- [ ] 客户端协议门禁 §10.6 pass
- [ ] 数据门禁 §11.1 pass
- [ ] readyz：有效 waiver 或全绿；**生产** 另满足 §11.0.4
- [ ] 前一镜像 + 备份 + restore 演练记录

### 11.3 发布动作

1. 锁定 SHA 全量 build（禁止脏 layer）。
2. Staging + 数据演练 + 知识/登录矩阵。
3. 生产灰度仅在 §11.0 生产条件满足时进行。
4. release record：SHA、digest、feature ids、waivers、rollback。

### 11.4 RC0 不包含

- 全部分支已合并
- 移动端全量 feature parity
- 无决策的历史分支关闭

---

## 12. Phase F / 13. Phase G

同前：按 ledger 扩展 4E→4H；manifest CI、分支 TTL、provenance、hotfix 24h 回灌。  
Manifest CI 校验字段扩展为 §8.6 全集。

---

## 14. 每日站会与硬停止

站会检查：Base/parity、freeze-evidence 堆积、checkpoint、new-fail、readyz waiver 到期、共享树是否被 merge。

**硬停止：**

- 未认领内容被自动 park/提交
- 无 parity 的 base 变更
- 共享树集成 merge
- 生产部署在 waiver 过期或失败面扩大时仍进行
- new-fail 无主理人

---

## 15. 首周任务板（修订）

### Day 0–1

- [ ] critical feature checklist + 候选 base parity
- [ ] 维护者签署 Base 决策单（附 parity）
- [ ] 禁令 + 角色
- [ ] 脏文件认领（超时 = freeze-evidence only）

### Day 1–2

- [ ] 取证目录 + known-fail
- [ ] 远程审计 L0/L1/L1b（tags/PR/patch-id）
- [ ] **勿** 在 base 未签前创建 convergence landing

### Day 2–4

- [ ] L2 ledger + 等价折叠
- [ ] 人类创建 convergence worktree
- [ ] 基线 build

### Day 3–12 / 12–15

- [ ] D0–D4 子波 + 客户端协议 + 知识矩阵
- [ ] 数据演练 + readyz waiver
- [ ] RC0 staging；生产另判

---

## 16. 与上位文档映射

| 上位 Wave | 本计划                            |
| --------- | --------------------------------- |
| Wave 0    | D0 + A（+ freeze-only 超时）      |
| Wave 1–2  | B（远程全审计 + 决策）            |
| Wave 3    | C（人类 worktree）                |
| Wave 4    | D（含 4B′、客户端协议、知识矩阵） |
| Wave 5–6  | E（waiver + 数据恢复 + 生产另判） |
| Wave 7    | G（扩展 manifest）                |

---

## 附录 A — Canonical Base 决策单（模板）

```markdown
# Convergence Base Decision

- Date:
- Maintainer:
- Candidates evaluated: C-main / C-dev / C-rc (list SHAs)
- Parity reports attached:
  - base-parity-main.md:
  - base-parity-dev.md:
- Critical feature checklist path:
- Locked base ref/SHA:
- P0 gaps remaining and disposition:
- Rationale (policy + parity, not CI-only):
- RC 20260712 role: historical source | still release line
- Production SHA role: rollback + parity anchor only | (other)
- Whole-branch mainline of fix-scoped-package-templates: NO | YES (justify)
- Convergence branch name:
- Worktree path (human-created):
- Sign-off:
```

## 附录 B — 脏文件认领表

```text
path, owner, task_or_spec, status, disposition, deadline, notes
```

`disposition` ∈  
`commit-to-stream` | `park-branch` | `patch-bundle` | `discard` | `freeze-evidence` | `integration-hotfile`

**超时默认 disposition = `freeze-evidence`。**  
`park-branch` 仅当 owner 已确认且在独立 worktree 或已存在 patch-bundle。

## 附录 C — Checkpoint 模板

```markdown
## Checkpoint <id> — <date>

- Commit:
- P0/P1:
- Client protocol gates:
- Knowledge matrix (if applicable):
- Hotfile wiring:
- New-fail / known-fail delta:
- Sign-off:
```

## 附录 D — RC0 黄金路径与矩阵

**控制面：**

1. 登录 → tenant/seat → roster → chat（history 刷新仍在）
2. 重启后会话/作业可恢复
3. healthz 活；readyz 按 §11.0

**知识矩阵：** 成功 / 越权 / A-B 隔离 / 幂等 / 失败恢复 / 重启持久化

**数据：** §11.1 全项

**客户端：** §10.6 编译 + 握手 + 字段兼容

## 附录 E — readyz Waiver 模板

```markdown
# Waiver: <probe-name>

- Observed on (prod/staging/sha):
- Error summary:
- Impact scope:
- Owner:
- Expires on:
- Introduced/expanded by RC0? evidence:
- Compensating controls:
- Maintainer sign-off for staging:
- Maintainer sign-off for production (if any):
```

---

## 17. 修订记录

| 日期       | 变更                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-20 | 初版：三轨、RC0、半自动 ledger、4B′                                                                                                                                |
| 2026-07-20 | 响应审查：base parity 硬门禁；超时仅 freeze-evidence；全方位远程审计；readyz waiver；数据可验证恢复；客户端协议门禁；manifest 扩展；知识自动化矩阵；计划归因与状态 |
| 2026-07-20 | 复审：状态升为 `APPROVED FOR DAY 0`；Loom + `.kiro/specs/repository-wide-branch-convergence` 登记；§8.2 L3 安全候选路由；角色 roster 占位                          |
