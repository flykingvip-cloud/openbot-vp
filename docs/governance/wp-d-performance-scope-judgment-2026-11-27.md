# WP-D 性能实验有效范围裁决

- 切片：S-13（仅裁决既有实验范围，不扩大测试战役）
- 日期：2026-11-27 Asia/Shanghai
- 仓库：https://github.com/flykingvip-cloud/openbot-vp
- 主干：`origin/main` = `d20d7f7cd45199da0b68d9623336d4e69c999223`（2026-11-27 20:51:21 +0800，合入 #354；fresh fetch 后与要求基线完全一致）
- 落点：`docs/governance/wp-d-performance-scope-judgment-2026-11-27.md`（既有治理过程文档目录下的范围裁决 / 证据备忘；不写入 `docs/docs.json`，不新建验收树）
- 方法：只根据已存在材料判断每项实验或主张为 **有效 / 无效 / 需要更多测试**。不新跑基准，不发明数字，不把 #344 串行构建测量当作服务隔离或计价域隔离收益。

本文件是对既有材料的范围裁决 / 证据备忘，不是新的验收体系，也不是生产或实验放行。#344 官方串行构建只证明指定审计盒上的构建耗时与内存；不得将其当作服务隔离或计价域隔离收益。WP-D / GW-01 隔离结论仍属「需要更多测试」。

---

## 1. 裁决摘要

| ID                  | 主张或实验                                                                                 | 实际测到的是什么                                                                                                             | 裁决                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C-344-BUILD         | #344 / WPL：官方 `pnpm build` 在串行子进程配置下可完成，并记录耗时与内存                   | 指定审计盒上的官方构建墙钟与 `/usr/bin/time -v` Max RSS（以及 PR 正文中另一套 `/proc` 进程树 RSS）                           | **有效**（仅限「该盒、该 HEAD、该计量方式下的官方串行构建」）。不得外推到发布构建机或 Node 22。                                         |
| C-344-ISOLATION     | 将上述串行构建数字当作 service-isolation 或 pricing-domain isolation 的收益或证明          | 无对应测量。#344 改的是官方构建调度（每份 tsdown 配置新子进程 + 默认 `RAYON_NUM_THREADS=2`），不是运行时服务隔离或计价域隔离 | **无效**。明确拒绝。                                                                                                                    |
| C-344-METER-COMPARE | 把 PR 正文的进程树 RSS / 开发者自报数字与独立审计的 `ru_maxrss` 直接比大小，或当作同一指标 | 两套计量本来就不是同一个量                                                                                                   | **无效**（独立审计已披露；本裁决维持）。                                                                                                |
| C-344-RELEASE-HOST  | 用本盒数字证明目标发布构建机内存充足或时限可接受                                           | 审计明确：未登录、未调度、未在 GitHub Actions / 官方 linux/amd64 发布机构复跑                                                | **需要更多测试**（若将来要作为发布门禁）。本切片不启动该测试。                                                                          |
| C-WPD-GW01          | 名为 WP-D / GW-01 的性能或隔离实验结论（含本地基线 `openbot-wp-d-gw01-baseline`）          | 在可引用的 GitHub 对象、`origin/main` 文档和本盒材料中，**没有**可核验的实验记录、数字或对比组                               | **需要更多测试**不得作出「有效」或「无效」的性能结论。现有可引用材料不足以支持任何隔离收益主张。未上库的 Mac 工作树不得在本切片中读取。 |
| C-WPB-ADJACENT      | WP-B 已合入切片（#323 / #328 等）证明了 WP-D 隔离性能收益                                  | 这些 PR 是网关租户歧义拒绝、计费回归隔离测试等功能/测试工作，不是 WP-D 性能实验                                              | **无效**（作为 WP-D 性能或隔离收益证据）。其自身功能范围不在本切片重判。                                                                |
| C-HIST-ISOLATION    | 2026-07 至 2026-10 的工作区/租户/大白隔离设计与证据，自动构成 WP-D 性能实验                | 仓库中有历史隔离文档与证据，但当前 `main` 无 `WP-D`、`计价域`、`服务隔离`、`pricing-domain` 等标识将它们标为 WP-D 性能实验   | **无效**（不得自动并入 WP-D 性能范围）。这些材料是否仍适用于其他工作包，需各自引用，不在本切片扩围。                                    |

一句话：目前唯一能站得住、且带数字的「性能」测量，是 #344 官方串行构建在审计盒上的耗时与内存；它 **不是** 隔离收益。真正的 WP-D（接入与控制面 / GW-01）实验记录尚未进入可引用主干，故不能从现有材料给出隔离收益的有效结论。

---

## 2. WP-D 本身能确定什么、不能确定什么

### 2.1 能确定的工作流归属

2026-11-23 架构整改送审稿的工作流记录（`/bot/workstream/openbot-architecture-remediation`，同日两条）写明：

- 权威仓库为 `flykingvip-cloud/openbot-vp`，唯一主干 `main`；
- 目标是在可治理的执行框架内，实现受权限、证据和版本约束的理解、规划、执行与进化；计划继承 R3.1 与网关整改附件的已完成清单、代码、测试和验收，**不另建平行架构或验收体系**；
- 五路执行划分中，WP-D 属于「接入与控制面」，与 WP-B、WP-I 以及相关 GW slices 并列。

据此，WP-D 的主题应落在接入与控制面（含网关相关切片），而不是官方构建器的内存调度。这足以拒绝把 #344 串行构建当作 WP-D 隔离收益，但还不足以从送审稿摘要中还原 WP-D 的实验设计、对照组、指标或已跑结果。

### 2.2 送审稿全文与 WP-D 实验记录未能在可引用源找到

在本次裁决的检索范围内，**没有找到** 2026-11-23 送审稿全文，也没有找到已合入主干的 WP-D 实验报告、指标表或对比日志：

- 当前 `origin/main`（`d20d7f7c`）源码与 `docs/` 中，对 `WP-D`、`工作包 D`、`性能实验`、`计价域`、`服务隔离`、`pricing-domain`、`service-isolation` 的检索无命中（`IT-CS-13` 等无关标识除外）；
- `git log` / GitHub 提交、PR、Issue 搜索同样没有 WP-D 性能实验文档或分支；远端存在 `arch-remediation-wp-b-slice1/2/3`，**没有** `arch-remediation-wp-d*`；
- 架构一致性清理计划（见第 5 节）使用的是 `WP-CU-A1` 等清单 ID，与送审稿字母编号 WP-A…WP-M 不是同一套工作包。

### 2.3 未上库的本地基线只能记为「存在过工作树」，不能当实验结果

知识库对齐工作会话中保存的本机 `git worktree` 列表（只读摘录，不是本次对 Mac 的访问）出现过：

```text
/Users/daniel/AI VP/openbot-wp-d-gw01-baseline    7eaf25345 (detached HEAD)
```

对该 SHA 的核验：

- `git cat-file` 在已 fetch 的 `origin` 对象库中：不是有效对象；
- GitHub API `GET /repos/flykingvip-cloud/openbot-vp/commits/7eaf25345`：HTTP 422，`No commit found for SHA: 7eaf25345`。

本切片授权明确禁止使用用户 Mac 或任何 `/Users/daniel` 路径，因此该工作树中的实验脚本、日志或数字 **未读、未引、未采信**。它只证明：曾有人在本地以 detached HEAD 建立过名为 `openbot-wp-d-gw01-baseline` 的工作树，且该提交从未进入 GitHub 权威库。在对象上库并附可引用测量记录之前，不能从「工作树存在过」推出任何有效或无效的性能结论。

---

## 3. 逐项裁决与引用

### 3.1 C-344-BUILD：官方串行构建测量（有条件有效）

**改动实际做了什么（不是隔离）。**

合入提交 `7dfe5c97d808f0c10836ed9ece9773ddd7d85978`（2026-11-24 08:21:52 +0800）标题为：

> fix: prerelease four convergence gates (18 regressions, diagnosis default-off, serial build) (#344)

#344 的第四项门槛是「官方构建测量」，不是隔离实验。合入后仍留在 `main` 上的 launcher 写明其目的是限制 **构建期** 模块图与原生 worker 内存：

```18:19:scripts/tsdown-build.mjs
// Fresh child per configuration bounds retained graphs / native worker memory.
// Keep every entry and every original option; no reduced release build.
```

```136:142:tsdown.config.ts
// The official build launches each configuration in a fresh process so bundles
// do not retain one another's module graphs. Direct tsdown invocation is unchanged.
const index = process.env.OPENBOT_BUILD_ENTRY_INDEX;
if (index !== undefined && (!/^\d+$/.test(index) || !configs[Number(index)])) {
  throw new Error("Invalid OPENBOT_BUILD_ENTRY_INDEX");
}
export default index === undefined ? configs : [{ ...configs[Number(index)], clean: false }];
```

子进程默认 `RAYON_NUM_THREADS=process.env.RAYON_NUM_THREADS ?? "2"`。配置数组由 7 个显式 `nodeBuildConfig(...)` 加上 `pluginSdkEntrypoints.map(...)` 展开组成。#344 PR 正文与三次独立构建日志均打印 `[build] tsdown configuration N/53`，共 53 次。当前 `main` 上该结构仍在；#346（`d326dbcc`，2026-11-25 00:24:55 +0800）只在清理输出前增加父选择器拒绝，并写明「Default launcher scheduling is preserved」「full tsdown artifacts were not rebuilt」。

**PR 正文自称测到了什么。** 见 #344 正文「官方构建测量」：

- `scripts/tsdown-build.mjs` / `tsdown.config.ts` 改为 53 份配置独立子进程串行构建（默认 `RAYON_NUM_THREADS=2`）；
- 官方 `pnpm build` 退出码 0，耗时 **136.73 秒**；
- 进程树 `/proc` 采样峰值 RSS **3.040 GiB**（3,264,081,920 bytes），本次无新增 OOM kill；
- 「串行构建应视为候选发布流程；本次结果不能证明所有发布机构都具备足够内存，审查方需在明确的发布构建机上复跑并记录内存峰值」。

**独立审计实际测到了什么（应优先引用这一套，且不可与上一套混用）。**

1. 对 PR HEAD `0f5824cc6aa3f726fb665e261579718a59f18466` 的独立验收（`/workspace/openbot-vp-audit/pr344-independent-audit/`）：
   - 命令：`/usr/bin/time -v -o serial-build-time.txt pnpm build`；
   - 时间：2026-11-24 00:05:44–00:08:00 CST（Asia/Shanghai）；
   - 退出码 0；墙钟 `2:15.30`（135.30 秒）；Max RSS **2935188 kB ≈ 2.799 GiB**；
   - 主机 `grok-bot-vm-358263807`，8 核 x86_64，MemTotal 16386416 kB，Swap 0，Node v24.22.1，非 GitHub Actions；
   - 审计原文：「`/usr/bin/time -v` 的 Max RSS，**不是**进程树 RSS 求和，也不等于 cgroup 峰值」；「不能把 2.799 GiB / 135.30 s 外推为发布机峰值或时限」；「WPL 改动意图包含 Node 22 兼容，**本轮未在 Node 22 上实跑**」。

2. 补修 HEAD `e886023ee12d2ee53415a26a83ee60146ff262d3`（`pr344-followup-independent/REPORT.md` §5.1）：
   - 2026-11-24 06:56:36–06:58:31 CST；exit 0；墙钟 **1:55.59**（115.59 秒）；Max RSS **2947216 kB ≈ 2.811 GiB**；
   - 「开发者声称 111s / 树 RSS 3.037GiB **不是**本轮数字，也不可与 Max RSS 直接比较。」

3. 再导入核验（`pr344-reimport-independent/REPORT.md`）：
   - `corepack pnpm build` 于 2026-11-24 08:06:47–08:08:44 CST；exit 0；墙钟 **1:57.11**；Max RSS **2925444 kB ≈ 2.790 GiB**；
   - 「开发者树 RSS 3.034GiB 不可与此直接比较」；「本盒 ≠ GitHub Actions / 目标 linux/amd64 发布机构；未跑 Node 22」。

**有效范围：** 在上述审计盒、所述 HEAD、Node 24、官方 `pnpm build`、串行 53 配置 launcher 这一组合下，构建成功，并留下了可引用的墙钟与 `ru_maxrss`。PR 正文自己也把串行构建定义为候选发布流程，并要求在发布机构复测。

**无效或越界的用法：** 见 C-344-ISOLATION、C-344-METER-COMPARE。把 136.73 s / 3.040 GiB 写成「已在发布机验证」同样越界。

### 3.2 C-344-ISOLATION：串行构建数字当作隔离收益（无效）

拒绝理由是测量对象与主张对象不一致，不是数字好坏：

1. **代码意图是构建器内存，不是运行时隔离。** launcher 注释写的是 “bounds retained graphs / native worker memory” 和 “bundles do not retain one another's module graphs”。这是同一官方构建里各 tsdown 配置是否共用进程/图的问题，不是服务之间的隔离，也不是计价域之间的隔离。
2. **指标对不上。** 墙钟、`ru_maxrss`、`/proc` 进程树 RSS 都不测量跨服务故障域、租户/计价域配额隔离、跨域拒绝或干扰抑制。仓库当前 `main` 甚至没有 `pricing-domain` / `计价域` / `服务隔离` 这些标识可与该测量对齐。
3. **#344 里出现的 “isolate” 不是这项测量。** 同 PR 的 `26285170`（isolated regression fixtures）和 `4c356d72`（isolate tenant seat loader）是测试夹具隔离，与 WPL 串行构建、也与 service/pricing-domain isolation 收益无关。
4. **独立审计已经把构建数字的外推边界写死。** 审计把该项标为「仅本核查机」的官方构建 PASS，并要求发布机构用自身规格与计量方式复测。没有任何审计段落把这些数字表述为隔离收益。

因此：#344 串行构建测量 **可以** 支持「官方构建在该盒上成功且内存有记录」；**不可以** 支持「隔离已带来性能或安全收益」。若有口头或衍生材料把两套主张连在一起，以本裁决为准，后者无效。

### 3.3 C-WPD-GW01：WP-D / GW-01 性能或隔离实验（现有材料不足）

- 送审稿摘要只给出工作流归属，没有实验方案或结果；
- 主干、GitHub 对象和已合入文档中没有 WP-D 实验报告；
- 本地 `openbot-wp-d-gw01-baseline` @ `7eaf25345` 未上库，本切片不得读取 Mac 路径。

在补齐可引用的实验设计、对照、原始日志和与当前 `main` 的关系之前，不能宣布 WP-D 隔离性能「已验证」或「已证伪」。这是 **需要更多测试 / 需要可引用材料**，不是授权本切片去开新的测试战役。

### 3.4 相邻材料，不得并入 WP-D 性能范围

- **WP-B 远端分支与 PR：** `arch-remediation-wp-b-slice1` → 已合入 #323（拒绝成员身份歧义上的 first-match 租户选择）；`arch-remediation-wp-b-slice3` → 已合入 #328（chat 路径信用预留的测试隔离回归）；`arch-remediation-wp-b-slice2` → #326 已关闭。这些是接入面功能或测试工作，正文未给出 WP-D 性能数字，也不可改称为隔离性能收益。
- **#351**（`Architecture: unify single execution kernel...`）等后续架构合入，不在本次作为 WP-D 性能实验引用；本次也未在其中检索到 WP-D 性能结果。
- **历史隔离文档（举例，均在当前 `main`，但无 WP-D 标签）：** `docs/design/isolation-layers-hard-rules-2026-08-06.md`、`docs/design/hybrid-gateway-isolation-future-plan-2026-07-11.md`、`docs/design/agent-seat-binding-tenant-isolation-2026-08-04.md`，以及 `docs/design/evidence/` 下 2026-08 至 2026-10 的 workspace / daibai / collaboration 隔离证据。它们最多是更早的隔离工程记录，不能自动算作 2026-11 送审稿中的 WP-D 性能实验。
- **其他性能材料**（同样未标明 WP-D）：`scripts/bench-cli-startup.ts`、`scripts/test-perf-budget.mjs`、`docs/design/handoff-s01-revision-r4-performance-benchmark.md`、`docs/design/evidence/chat-inbound-depth-performance-gate-2026-08-20.json`、`.kiro/specs/execution-router-phase0/shadow/perf-report.md`。本切片不把它们改标为 WP-D 证据，也不对其历史数字重新采信。

---

## 4. #344 串行构建与隔离的区分（必须单独保留）

|            | #344 官方串行构建                                                                 | 服务隔离 / 计价域隔离（WP-D 可能关心的对象）                            |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 被测系统   | 官方 `pnpm build` / tsdown 多配置 launcher                                        | 运行时服务边界，或计价/配额域边界（现有材料中无已上库的 WP-D 实验定义） |
| 改动位置   | `scripts/tsdown-build.mjs`、`tsdown.config.ts`（#344 WPL；#346 仅加父选择器守卫） | 未在 #344 中作为测量对象出现                                            |
| 已记录指标 | 退出码、墙钟、`ru_maxrss`、（PR 正文另报）`/proc` 进程树 RSS、有无 OOM            | 无与 #344 绑定的隔离指标                                                |
| 有效结论   | 特定审计盒 + 所述 HEAD + Node 24 上构建成功，内存有记录                           | 不得从左侧推出                                                          |
| 已知非结论 | 非发布机构验证；非 Node 22；两套 RSS 不可直接比较                                 | 不得把左侧数字写成隔离收益                                              |

独立审计已经区分了「本核查机构建 PASS」和「目标发布构建机未复跑」。本裁决再补一条同等硬的区分：**构建器串行化 ≠ 服务隔离或计价域隔离。**

---

## 5. 文档落点（既有 `docs/governance/`，不新建验收树）

不得发明平行验收体系，也不把本备忘写入 `docs/acceptance/` 或新的验收目录。

检索结果：

- `docs/architecture/` 现有文件仅桌面/多平台/单链协议，无 WP-D 或性能实验裁决目录；
- `docs/acceptance/` 是既有阶段证据树，无架构整改 WP-D 性能裁决槽位，本备忘不进入该树；
- 2026-11-24 的《OpenBot 主链路主权唯一性：清理与验收工作计划（v1.0）》及其清理清单，位于本盒 `/workspace/openbot-vp-audit/architecture-consistency-20261124/`，**不是** `origin/main` 跟踪文件；该计划使用 `WP-CU-*` 编号，并与送审稿一样强调不另建平行验收体系；
- `CHANGELOG.md` 无将 #344 构建数字表述为隔离收益的条目（检索未找到对应 #344 性能叙事）；
- 当前 `main` 上已有 `docs/governance/`，其中是过程文档（`enforced-admission-checklist.md`、`shadow-staging-runbook.md`），不是验收框架。这是最接近的既有落点。本备忘作为范围裁决 / 证据备忘放在该目录，**不**加入 `docs/docs.json` 导航。

---

## 6. 未能找到、因而不能采信的材料

1. 2026-11-23 架构整改送审稿全文（仅有工作流记忆中的目标与五路划分摘要）。
2. 送审稿所继承的「R3.1 与网关整改附件」中、专门定义 WP-D 性能实验方案与验收指标的那一部分（本切片未在 `main` 或已合入 PR 中定位到带 WP-D 标识的附件）。
3. 任何已推送到 GitHub 的 `arch-remediation-wp-d*` 分支、PR、实验报告或原始日志。
4. `7eaf25345`（`openbot-wp-d-gw01-baseline`）的树、脚本、日志和数字——对象不在 GitHub，且禁止读取 `/Users/daniel`。
5. 把 #344 构建数字写成隔离收益的已合入文档。若只存在于未保存的对话或未上库草稿，不能作为「已有效」的依据；若出现此类主张，按第 3.2 节判无效。

---

## 7. 本切片明确未做

- 未扩大或重跑任何性能/隔离实验，包括发布构建机和 Node 22 复测；
- 未读取用户 Mac 或 `/Users/daniel` 路径；
- 未修改 keep-out 分支 `openbot/recovery-send-unification-20261127`，也未改动恢复发送相关文件或 `.loom/registry.yaml`；
- 未修改 `deploy/production/releases.jsonl`；
- 未做生产部署或发布切换。本备忘按授权落入既有 `docs/governance/`，不构成平行验收体系。

---

## 8. 主要引用

- https://github.com/flykingvip-cloud/openbot-vp/pull/344
- https://github.com/flykingvip-cloud/openbot-vp/commit/7dfe5c97d808f0c10836ed9ece9773ddd7d85978
- https://github.com/flykingvip-cloud/openbot-vp/blob/d20d7f7cd45199da0b68d9623336d4e69c999223/scripts/tsdown-build.mjs
- https://github.com/flykingvip-cloud/openbot-vp/blob/d20d7f7cd45199da0b68d9623336d4e69c999223/tsdown.config.ts
- `/workspace/openbot-vp-audit/pr344-independent-audit/REPORT.md` §5，以及同目录 `serial-build-time.txt`、`serial-build-run.json`、`machine-specs.txt`、`serial-build.log`
- `/workspace/openbot-vp-audit/pr344-followup-independent/REPORT.md` §5.1
- `/workspace/openbot-vp-audit/pr344-reimport-independent/REPORT.md`（typecheck / official build 表）
- `/workspace/openbot-vp-audit/architecture-consistency-20261124/OpenBot-主链路主权唯一性-清理与验收工作计划-v1.0.md`（仅作「计划不在 main 内、且禁止平行验收体系」的交叉引用，不是 WP-D 实验数据）
- 工作流记录 `/bot/workstream/openbot-architecture-remediation`（2026-11-23）
- GitHub API：`commits/7eaf25345` → 422
