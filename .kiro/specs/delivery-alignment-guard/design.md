# 技术设计：交付前进性守卫（Delivery Alignment / Forward-Only Guard）

> 状态：立项设计 · 交付执行 owner：Codex
> 凡引用既有代码/事实均给出 repo 相对路径 + 已核实证据,Codex 据此对照。

---

## 0. 核心不变量与判据

> **生产只能沿 git 历史前进。** 对任意候选 `C`,必须 `is-ancestor(LIVE, C) == true`;否则会倒退,阻断。

- **LIVE = 运行制品自报的 commit**(不是文档)。已核实:`scripts/write-build-info.ts` 生成 `dist/build-info.json`,形如:
  ```json
  { "version": "1.0.1", "commit": "05f57a5eb7...", "builtAt": "2026-07-25T12:33:54Z" }
  ```
  运行容器带着它 → 可从「网关版本/健康端点」或 `podman exec <container> cat <build-info>` 读取。
- 已核实缺口:`deploy/production/scripts/verify-delivery-alignment.sh` **不存在**;`scripts`/`deploy`/`.github` 里**无任何 `merge-base`/`is-ancestor` 守卫**。本规格补齐。
- 已核实真实案例判据(必须成为测试):`is-ancestor(e860bba1b0, 0b47c51bfe)=false`;`diff --diff-filter=D` 命中 `src/gateway/user-modeling/tenant-membership.ts`。

---

## 1. 组件与目录

```
scripts/delivery/
  forward-guard.ts            # 核心纯函数(单一实现，被 shell/CI/committer 复用)
  forward-guard.test.ts       # vitest：前进/落后/背离/回退识别/fail-closed/豁免 + 真实案例 fixture
  resolve-live-sha.ts         # LIVE 解析(端点优先 → podman exec 退化 → --live-sha 注入)
  resolve-live-sha.test.ts
  cli.ts                      # 供 shell 调用的薄 CLI(node --import tsx)，输出 JSON/退出码

deploy/production/scripts/
  verify-delivery-alignment.sh  # Gate 1：cutover 前守卫(补齐 AGENTS.md 承诺的缺失脚本)

.github/workflows/
  delivery-sot-alignment.yml    # Gate 2：CI「SoT 不落后生产」

（Gate 3 接入既有）scripts/committer 或 scripts/worktree-audit.ts
```

> 与仓库惯例一致:核心用 TS + `tsx` 运行(仿 `scripts/loom.ts`、`scripts/worktree-audit.ts`),shell 只做薄封装。

---

## 2. 核心判定（`scripts/delivery/forward-guard.ts`，纯函数，可注入 gitRunner）

```ts
export type GitRunner = (args: string[]) => { code: number; stdout: string };

/** is-ancestor(live, candidate)：live 是否被 candidate 包含。等价 git merge-base --is-ancestor。 */
export function isForwardOnly(live: string, candidate: string, git: GitRunner): boolean {
  return git(["merge-base", "--is-ancestor", live, candidate]).code === 0;
}

export interface RegressionReport {
  deleted: string[]; // 候选相对 live 整文件删除(--diff-filter=D)
  reverted: string[]; // 受保护路径上净删除内容的文件(可选，二期)
}

/** 候选相对 live 删除/回退了哪些(受保护)文件。 */
export function detectRegressedPaths(
  live: string,
  candidate: string,
  opts: { protectedGlobs: string[]; git: GitRunner },
): RegressionReport;

export interface GuardDecision {
  verdict: "allow" | "block";
  forwardOnly: boolean;
  regressions: RegressionReport;
  reasons: string[];
  intentionalRevert?: { approved: true; reason: string };
}

/** 汇总裁决：forwardOnly 且无回退 → allow；否则 block（除非 intentionalRevert 已批准）。 */
export function decideDelivery(input: {
  live: string | null; // null = 未知
  candidate: string;
  protectedGlobs: string[];
  git: GitRunner;
  allowUnknownLive?: boolean; // 默认 false → LIVE 未知即 block(fail-closed)
  intentionalRevert?: string; // 显式回滚原因；提供则放行并记录
}): GuardDecision;
```

- `gitRunner` 注入化,单测用**临时 git 仓库 fixture** 构造前进/落后/背离三种拓扑,无需真实 SSH。
- `protectedGlobs` 初始:`src/**`、`ui/src/**`、`dist/**`(可配)。整文件删除必报。
- **fail-closed**:`live == null && !allowUnknownLive` → block（reason: "LIVE 未知"）。

---

## 3. LIVE 解析（`scripts/delivery/resolve-live-sha.ts`）

优先级(前者可得即用,不做后者):

1. **端点**:若网关暴露版本/健康端点含 `build-info.commit`(Codex 需在 Phase 0 确认端点;`src/version.ts` / `git-commit.ts` 是线索),HTTP GET 读取。**最轻,免 SSH**。
2. **容器**:`podman exec <container> cat <in-container build-info path>`(经 `ssh <prod-host>`)。**只读**。
3. **注入**:`--live-sha <sha>`(测试/离线/审计)。

已核实运行参数(来自 `deploy/production/RELEASE_RECORD.md`):生产 host `root@8.217.93.71`,容器 `openbot-gateway-rc`,`node openbot.mjs gateway`。**在容器内 build-info 路径 Codex 需在 Phase 0 确认**(很可能 `/app/dist/build-info.json`;不要臆断,先 `podman exec ... ls`)。

解析后与 `RELEASE_RECORD.md` "Latest cutover · Source revision" 交叉校验,不一致 → 以容器为准 + 告警(记录漂移;这正是当前 v114/v115 漂移的可观测化)。

---

## 4. Gate 1 — `deploy/production/scripts/verify-delivery-alignment.sh`

薄封装,逻辑全在 TS：

```bash
#!/usr/bin/env bash
set -euo pipefail
# 只读守卫：不改生产/分支/stash/worktree
CANDIDATE="${CANDIDATE:-$(git rev-parse HEAD)}"
# 解析 LIVE（端点→podman→--live-sha），跑核心判定，输出 JSON + 退出码
node --import tsx scripts/delivery/cli.ts verify \
  --candidate "$CANDIDATE" \
  ${LIVE_SHA:+--live-sha "$LIVE_SHA"} \
  ${INTENTIONAL_REVERT:+--intentional-revert "$INTENTIONAL_REVERT"}
# 退出码：0=allow，20=block(倒退)，21=LIVE 未知 fail-closed
```

- `--intentional-revert "<原因>"`:显式批准回滚 → 放行并把原因回显/落日志(供 RELEASE_RECORD 记录)。
- 失败输出必须**可操作**:打印 LIVE/CANDIDATE、`is-ancestor` 结果、回退文件清单、下一步建议(rebase/merge LIVE)。

集成点:cutover runbook 在 `pnpm build:docker` **之前**必须过此脚本(在 RELEASE_RECORD 顶部与 runbook 明确要求)。

---

## 5. Gate 2 — CI「SoT 不落后生产」(`.github/workflows/delivery-sot-alignment.yml`)

```yaml
# 定时 + 对 SoT 分支 push 触发；只读；失败=SoT 落后生产
# 步骤：resolve LIVE（--live-sha 可由 RELEASE_RECORD 注入，避免 CI 直连生产）
#      → git fetch origin <SoT>
#      → assert isForwardOnly(LIVE, origin/<SoT>) 否则 fail
```

- CI 环境不便 SSH 生产时:以 `RELEASE_RECORD.md` "Latest cutover" SHA 作为 LIVE 输入(容器为准的校验放在 Gate 1 部署机上)。
- 配套 `pnpm` 脚本(package.json `scripts`):`delivery:check-sot`(本地/CI 同款)。
- **合并回环脚本**:产出把 LIVE cutover SHA 并回 `origin/<SoT>` 的可评审合并(不 `--force`,不自动推;遵守 git_safety)。

---

## 6. Gate 3 — 提交期落后告警（接入 committer / worktree-audit）

- 复用 `decideDelivery` 的 `isForwardOnly(LIVE, HEAD)`。
- 接入 `scripts/worktree-audit.ts`(已是 pre-commit 闸门,最自然)或 `scripts/committer`：
  - `!isForwardOnly(LIVE, HEAD)` → 打印醒目告警(LIVE SHA + "先 rebase/merge 生产再提交,否则可能提交旧文件")。
  - **默认非阻断**(不打断正常提交);`DELIVERY_GUARD_STRICT=1` 或关键分支 → 阻断。
  - LIVE 不可解析(本地开发离线)→ 静默跳过(仅 verbose 提示),不影响日常。
- narrow diff,保持既有提交行为;加非回归测试(告警不改变退出码/暂存范围除非 strict)。

---

## 7. 安全与非破坏

| 动作        | 约束                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| 读 LIVE     | 端点 GET 或 `podman exec cat`(只读);不 `exec` 任何写命令                              |
| git 查询    | 只 `merge-base`/`diff`/`rev-parse`/`fetch`;**不** checkout/merge/reset/stash/worktree |
| 生产状态    | 绝不改镜像/容器/分支;守卫失败只阻断流程,不"修复"                                      |
| 回滚逃生阀  | `--intentional-revert "<原因>"` 必须存在,否则紧急回滚被误伤                           |
| fail-closed | LIVE 未知默认 block(cutover);本地提交告警则静默跳过(不同场景不同默认)                 |
| 秘密        | 不回显凭证;SSH 目标按名引用                                                           |

---

## 8. 测试策略（fail-before / pass-after）

- **纯函数单测(临时 git 仓库 fixture)**:
  - 前进(candidate 含 live)→ allow;落后(candidate 是 live 祖先)→ block;背离(互不为祖先)→ block。
  - `detectRegressedPaths` 识别整文件删除。
  - fail-closed:live=null 且未 allowUnknownLive → block。
  - `--intentional-revert` → allow 且记录原因。
  - **真实案例 fixture**:构造 `live` 含 `tenant-membership.ts`、`candidate` 缺它且非其后代 → block + 命中该文件(等价 e860bba/0b47c51b)。
- **resolve-live-sha 单测**:端点优先、podman 退化、`--live-sha` 注入、RECORD 交叉校验告警(注入 reader,不真连)。
- **shell 冒烟**:`verify-delivery-alignment.sh --live-sha <A> --candidate <B>` 对前进/倒退分别返回 0/20;`--intentional-revert` 返回 0。
- **committer/worktree-audit 非回归**:LIVE 落后时告警但默认不阻断;strict 阻断;LIVE 不可解析不影响正常提交。
- 运行:`OPENBOT_TEST_PROFILE=low pnpm test scripts/delivery`;`pnpm tsgo`;`pnpm check`;shellcheck(若可用)。

---

## 9. 所有权与协调（Loom）— ⚠ 本任务多为共享治理基础设施

**新建(冲突面小,优先拥有)**:

- `.kiro/specs/delivery-alignment-guard/**`
- `scripts/delivery/**`(全新)
- `deploy/production/scripts/verify-delivery-alignment.sh`(全新;补缺失)
- `.github/workflows/delivery-sot-alignment.yml`(全新)

**协调触点(他方 owner / 共享;narrow diff + 先沟通)**:

- `scripts/committer` 与 `scripts/worktree-audit.ts`(pre-commit 治理;Gate 3 接入,只加告警分支)
- `package.json`(加 `delivery:*` scripts)
- `deploy/production/RELEASE_RECORD.md`、`docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`、`AGENTS.md` 交付链段(文档对齐)

**关键工序纪律(本案例血的教训)**:

- **必须在隔离 worktree 完成**,从**已包含 LIVE 的 tip** 派生(`git worktree add ../openbot-delivery-guard <base>`,base 需含 LIVE);**禁止从共享脏树 land**。
- 落地前用本守卫**自检**:`verify-delivery-alignment.sh --candidate <本任务分支tip>` 必须 allow(狗粮验证)。
- `scripts/committer` 仅本任务文件;trailers 必带;开工先 `loom register`。
