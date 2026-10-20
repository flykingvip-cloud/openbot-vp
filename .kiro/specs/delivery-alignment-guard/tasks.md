# Implementation Plan: 交付前进性守卫（Delivery Alignment / Forward-Only Guard）

## Agents

> 实施前由 owner 在下方签名并在 Loom 注册(per `AGENTS.md` Multi-Agent Collaboration)。未签名前请勿在同一路径并行开工。

- `codex-delivery-guard` · role: owner · scope: 交付前进性守卫全栈(LIVE 解析 / 前进性核心判定 / Gate1 cutover 脚本 / Gate2 CI+合并回环 / Gate3 提交期告警 / 文档对齐)· paths: `.kiro/specs/delivery-alignment-guard/**`, `scripts/delivery/**`, `deploy/production/scripts/verify-delivery-alignment.sh`, `.github/workflows/delivery-sot-alignment.yml` · since: <YYYY-MM-DD>

**Loom 注册(开工第一步)：**

```
pnpm loom register --task delivery-alignment-guard:codex-delivery-guard \
  --owner codex-delivery-guard --session-id <uuid> --ide codex --agent codex-delivery-guard
```

**每个提交 trailers：**

```
Task: delivery-alignment-guard
Agent: codex-delivery-guard
```

提交用 `scripts/committer "<msg>" <file...>`,仅本任务文件;**禁止 `git add .`**。共享文件(`committer`/`worktree-audit.ts`/`package.json`/`RELEASE_RECORD.md`/`AGENTS.md`)narrow diff。

## ⚠ 头等纪律（本任务因何而生，务必先读）

本规格起因于一次真实倒退:有人从**共享脏树**提交了比生产还旧的 user-modeling 变体(`0b47c51b` 缺 `tenant-membership.ts`,而线上 `e860bba` 有)。所以本任务**自身**必须示范正确姿势:

1. **在隔离 worktree 完成**,base 必须**已包含当前 LIVE**:`git worktree add ../openbot-delivery-guard <base-containing-LIVE>`。不要在共享脏树里写/提交。
2. **狗粮自检**:交付前用你自己的 `verify-delivery-alignment.sh --candidate <本分支tip>` 跑一遍,必须 `allow`。
3. **只读守卫**:任何脚本都不得改生产/切分支/建弃 stash/动 worktree。
4. **不要**尝试去 land 或修复那个 `0b47c51b`——它只是验收 fixture 的现实来源,不在本任务范围。

## Overview

依据 [requirements.md](./requirements.md) 与 [design.md](./design.md),建立"生产只能沿 git 历史前进"的机器强制不变量,三处设闸。**核心判定为单一 TS 纯函数,shell/CI/committer 共用**。

```text
Phase 0  隔离 worktree + 审计 + Loom + 确认 LIVE 端点/容器路径 + fail-before
  ↓
Phase 1  核心纯函数 forward-guard.ts + 单测(含真实案例 fixture)  ★判据地基
  ↓
Phase 2  resolve-live-sha.ts(端点→podman→注入)+ 单测
  ↓
Phase 3  Gate1：verify-delivery-alignment.sh(补齐缺失脚本)+ 冒烟   ★拦截倒退
  ↓
Phase 4  Gate2：CI「SoT 不落后生产」+ 合并回环脚本
  ↓
Phase 5  Gate3：提交期落后告警接入 committer/worktree-audit(默认非阻断)
  ↓
Phase 6  文档对齐(RELEASE_RECORD / 交付标准 / AGENTS.md)+ 端到端 + 狗粮自检
```

### 依赖关系

| 任务块        | 阻塞 | 被阻塞 |
| ------------- | ---- | ------ |
| 1.x 核心判定  | —    | 3/4/5  |
| 2.x LIVE 解析 | —    | 3/4    |
| 3.x Gate1     | 1、2 | 6      |
| 4.x Gate2     | 1、2 | 6      |
| 5.x Gate3     | 1、2 | 6      |

---

## Phase 0 — 隔离、审计、契约、fail-before

- [ ] **0.1** 人工/操作者提供含 LIVE 的 base;`git worktree add ../openbot-delivery-guard <base>` 并只在该目录工作。确认 base 满足 `is-ancestor(LIVE, base)`。
- [ ] **0.2** 读 `AGENTS.md` 交付链段、`deploy/production/RELEASE_RECORD.md`("Latest cutover"=LIVE 来源)、`scripts/write-build-info.ts` + `dist/build-info.json`(字段 `commit`)、`scripts/committer`、`scripts/worktree-audit.ts`、`scripts/loom.ts`(TS+tsx 惯例)。
- [ ] **0.3** Loom 注册 owner(见上),填 `since`。
- [ ] **0.4** **确认 LIVE 读取通道(不要臆断)**:① 网关是否有含 `build-info.commit` 的版本/健康端点(查 `src/version.ts`/`git-commit.ts`/健康路由);② 容器内 build-info 实际路径 `podman exec openbot-gateway-rc ls -l <candidate paths>`(很可能 `/app/dist/build-info.json`)。记录结论到 design §3。
- [ ] **0.5** **Fail-before 测试**:先写下真实案例 fixture 断言(`is-ancestor(live,cand)=false` + 删除 `tenant-membership.ts` → block),此刻应因实现缺失而失败;Phase 1 使其变绿。

---

## Phase 1 — 核心前进性判定（纯函数 + 单测）★

- [ ] **1.1** `scripts/delivery/forward-guard.ts`:`isForwardOnly(live,candidate,git)`、`detectRegressedPaths(...)`(至少 `--diff-filter=D` 整文件删除)、`decideDelivery(...)`(汇总 allow/block + fail-closed + intentional-revert)。零 `any`,`git` 注入化。
- [ ] **1.2** `forward-guard.test.ts`(临时 git 仓库 fixture):前进→allow;落后→block;背离→block;删除识别;`live=null && !allowUnknownLive`→block;`intentionalRevert`→allow。
- [ ] **1.3** **真实案例 fixture 变绿**:构造 live 含某文件、candidate 缺该文件且非其后代 → block 且命中该文件(等价 e860bba/0b47c51b,满足 R2.4)。
- [ ] **1.4** `OPENBOT_TEST_PROFILE=low pnpm test scripts/delivery/forward-guard`.

---

## Phase 2 — LIVE 解析（端点 → podman → 注入）

- [ ] **2.1** `scripts/delivery/resolve-live-sha.ts`:按 0.4 结论,端点优先 → `podman exec` 退化 → `--live-sha` 注入;reader 注入化以便单测。
- [ ] **2.2** 与 `RELEASE_RECORD.md` "Latest cutover · Source revision" 交叉校验,不一致以容器为准 + 告警。
- [ ] **2.3** fail-closed:不可得 → 返回 null(由 `decideDelivery` 在 cutover 场景转 block)。
- [ ] **2.4** 单测(注入 reader,不真连 SSH/HTTP):三级回退 + 交叉校验告警 + null 路径。

---

## Phase 3 — Gate 1：verify-delivery-alignment.sh（补齐缺失脚本）★

- [ ] **3.1** `scripts/delivery/cli.ts`:薄 CLI,子命令 `verify`,输出 JSON + 退出码(0=allow,20=block 倒退,21=LIVE 未知)。
- [ ] **3.2** `deploy/production/scripts/verify-delivery-alignment.sh`:`set -euo pipefail`;默认 candidate=`git rev-parse HEAD`;调 `cli.ts`;支持 `--candidate/--live-sha/--intentional-revert/--allow-unknown-live`。**只读**。
- [ ] **3.3** 失败输出可操作:LIVE/CANDIDATE、is-ancestor 结果、回退文件清单、下一步(rebase/merge LIVE)。
- [ ] **3.4** 冒烟:`--live-sha <A> --candidate <B>` 前进=0 / 倒退=20;`--intentional-revert "reason"`=0;无 LIVE 且未 allow=21。
- [ ] **3.5** shellcheck 通过(若 CI 含);脚本 `chmod +x`。

---

## Phase 4 — Gate 2：CI「SoT 不落后生产」+ 合并回环

- [ ] **4.1** `package.json` 加 `delivery:check-sot`(调 cli.ts:assert `isForwardOnly(LIVE, origin/<SoT>)`)。narrow diff。
- [ ] **4.2** `.github/workflows/delivery-sot-alignment.yml`:定时 + 对 SoT 分支 push 触发;CI 用 `RELEASE_RECORD` 的 LIVE 注入(不直连生产);失败=SoT 落后。
- [ ] **4.3** 合并回环辅助脚本:产出把 LIVE cutover SHA 并回 `origin/<SoT>` 的**可评审**合并(不 `--force`、不自动推,遵守 git_safety)。
- [ ] **4.4** 单测/dry-run:构造 SoT 落后生产 → 检查失败;SoT 含 LIVE → 通过。

---

## Phase 5 — Gate 3：提交期落后告警（committer / worktree-audit）

- [ ] **5.1** 复用 `decideDelivery` 的 `isForwardOnly(LIVE, HEAD)`,接入 `scripts/worktree-audit.ts`(优先)或 `scripts/committer`。
- [ ] **5.2** `!isForwardOnly` → 醒目告警(LIVE SHA + rebase/merge 指引);**默认非阻断**;`DELIVERY_GUARD_STRICT=1`/关键分支 → 阻断。
- [ ] **5.3** LIVE 不可解析 → 静默跳过(仅 verbose),不影响本地开发。
- [ ] **5.4** 非回归测试:告警不改变正常提交的退出码/暂存范围(除 strict);LIVE 落后仅告警。

---

## Phase 6 — 文档对齐 + 端到端 + 狗粮自检

- [ ] **6.1** 新建/补齐 `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`(记录守卫 + 三闸 + 不变量)。
- [ ] **6.2** `deploy/production/RELEASE_RECORD.md` 顶部加"cutover 前必过 `verify-delivery-alignment.sh` + 强制 merge-back";更新 `AGENTS.md` 交付链段,使"承诺存在的脚本"与实际一致。
- [ ] **6.3** **狗粮自检**:`deploy/production/scripts/verify-delivery-alignment.sh --candidate <本任务分支tip>` 必须 `allow`。
- [ ] **6.4** `pnpm tsgo`(零 `any`)+ `pnpm check` + `OPENBOT_TEST_PROFILE=low pnpm test scripts/delivery` 全绿;`bun scripts/agent-attribution.ts` 无 UNATTRIBUTED/CONFLICT。

---

## 完成定义（否定清单）— 不得在以下情况宣称完成

- 判据用"最新提交/提交时间/磁盘内容"而非 `is-ancestor(LIVE, 候选)`；
- LIVE 取自文档而非运行制品(端点/容器 build-info)；
- **没有**真实案例 fixture(e860bba/0b47c51b 等价:落后 candidate + 删除 `tenant-membership.ts` → block)；
- 误伤合法向前 cutover / 正常本地提交(无非回归测试)；
- LIVE 未知在 cutover 场景未 fail-closed；
- **无** `--intentional-revert` 逃生阀(紧急回滚被误伤)；
- 守卫改动了生产状态 / 切分支 / 动 stash / 动 worktree(必须只读)；
- 逻辑复制到 shell 与 TS 两份(必须单一实现)；
- 从共享脏树 land(必须隔离 worktree)或未过自身狗粮自检；
- `pnpm tsgo` 非零 `any` 或 `pnpm check`/相关 `pnpm test` 未绿。

---

## 给 Codex 的执行提示

1. **判据只有一个**:`is-ancestor(LIVE, 候选)`。写代码/测试/脚本时反复回到这条,不要引入"时间新旧"等替代判据。
2. **LIVE 以运行制品为准**:先花 Phase 0.4 把"端点还是 podman、容器内路径是什么"搞确定,别臆断路径。
3. **最短见效路径 = Phase 1+3**:核心纯函数 + `verify-delivery-alignment.sh` 一旦就绪,就能对 `--live-sha e860bba1b0 --candidate 0b47c51bfe` 演示 BLOCK——这就是本任务的价值证明。
4. **只读、可回滚、不误伤**:守卫是"闸"不是"手";紧急回滚要能过(`--intentional-revert`);正常向前和正常提交绝不能被挡。
5. **以身作则**:隔离 worktree、narrow diff、trailers、`loom register`、交付前狗粮自检——本任务本身就是"如何不把旧文件搞上云"的范例。
