# G1 只读盘点 / G1 read-only inventory

- **采样时间：** 2026-11-02（Asia/Shanghai）
- **远程：** `flykingvip-cloud/openbot-vp`（private）
- **`origin/main`：** `fde7444fba79cb74569c59e40e36106eeed29dc8`
- **性质：** 只读事实。不批准迁移，不修改包、工作流或发布配置。

先前笔记里的 tip 约为 `d42fbc3c…`。复核 `git fetch origin main` 之后，`origin/main` 比该提交超前 1 个：

| 项 | 值 |
| --- | --- |
| 当前 tip | `fde7444fba79cb74569c59e40e36106eeed29dc8` |
| 提交说明 | `chore(ledger): Path B LIVE seq152 tip d42fbc3ca2b4 (#194)` |
| 提交时间 | 2026-11-02 08:16:05 +0800 |
| 父提交 | `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c` |

父提交 `d42fbc3ca2b4` 也是生产账本 seq 152 写下的 gateway / UI SHA。下面各节都对着这个 tip 复核，有漂移的地方直接写实测值。

## 1. 远程身份

GitHub API 与 `gh` 在 2026-11-02 读到：

| 项 | 实测 |
| --- | --- |
| 仓库 | `flykingvip-cloud/openbot-vp` |
| 可见性 | private |
| 默认分支 | `main` |
| 所有者 | `flykingvip-cloud` |
| 所有者类型 | `User`（个人账号，不是 Organization） |
| 协作者 | 仅 `flykingvip-cloud`，`role_name=admin`（admin / maintain / push / pull / triage 均为 true） |
| License | `MIT`（API `license.spdx_id`；仓库根目录 `LICENSE` 同为 MIT License） |
| 主语言 | TypeScript |
| GitHub `size` | 91838 KB（约 91.8 MB，按 1000 进制；约 89.7 MiB） |
| GitHub Releases | 空（`gh release list` 无条目） |
| Git tags | 空（`/tags` 与 `/git/matching-refs/tags` 长度均为 0） |
| 创建时间 | 2026-10-20T10:11:23Z |

个人仓库没有 Organization team ACL。拆仓若要收紧权限，需要新建 private 组件仓、把协作者压到最少，并给组件仓的默认分支加上保护。本仓库当前做不到这一点，见第 5 节。

## 2. 工作区表面

`pnpm-workspace.yaml` 的 workspace 成员是：

- `.`（根包）
- `ui`
- `packages/*`
- `extensions/*`

根目录 `.github/workflows/` 有 19 个 workflow YAML。另有 GitHub 托管的 `Dependabot Updates`。仓库里还有 `Swabble/.github/workflows/ci.yml`，它不在上述根工作流列表里。`extensions/*/package.json` 有 37 个（只数两级目录）。本盘点不逐个展开 extension。

### 2.1 `packages/*` 与根、UI

`private` 列是 `package.json` 里的原值。`null` 表示字段不存在，npm 会把它当成可发布元数据。

| 包名 | 路径 | 版本 | private | dependencies |
| --- | --- | --- | --- | --- |
| `@upbeyond/openbot` | `.` | `2026.7.12-rc.2` | null | 根应用依赖面（见根 `package.json`） |
| `openbot-control-ui` | `ui` | （空） | true | 含 `@openbot/evolution-core` 等 |
| `@openbot/aor-backend-graph` | `packages/aor-backend-graph` | 0.1.0 | true | `@openbot/aor-core` |
| `@openbot/aor-backend-openbot` | `packages/aor-backend-openbot` | 0.1.0 | true | `@openbot/aor-core` |
| `@openbot/aor-backend-stub` | `packages/aor-backend-stub` | 0.1.0 | true | `@openbot/aor-core` |
| `@openbot/aor-core` | `packages/aor-core` | 0.1.0 | true | 无 |
| `@openbot/aor-sdk-node` | `packages/aor-sdk-node` | 0.1.0 | true | `@openbot/aor-backend-openbot`、`@openbot/aor-core` |
| `clawdbot` | `packages/clawdbot` | 2026.2.12 | null | `@upbeyond/openbot` |
| `@cogniweave/sdk` | `packages/cogniweave-sdk` | 0.1.0 | null | 无 |
| `@openbot/collaboration-core` | `packages/collaboration-core` | 0.1.0 | true | 无 |
| `@openbot/collaboration-openbot-adapter` | `packages/collaboration-openbot-adapter` | 0.1.0 | true | `@openbot/collaboration-core`、`@openbot/collaboration-runtime` |
| `@openbot/collaboration-runtime` | `packages/collaboration-runtime` | 0.1.0 | true | `@openbot/collaboration-core` |
| `@openbot/constitutional-conformance` | `packages/constitutional-conformance` | 0.0.0 | true | `@openbot/constitutional-contracts` |
| `@openbot/constitutional-contracts` | `packages/constitutional-contracts` | 0.1.0 | true | `zod` |
| `@openbot/constitutional-registry` | `packages/constitutional-registry` | 0.0.0 | true | `@openbot/constitutional-contracts` |
| `@openbot/constitutional-runtime` | `packages/constitutional-runtime` | 0.0.0 | true | `@openbot/constitutional-contracts` |
| `@openbot/evolution-core` | `packages/evolution-core` | 0.1.0 | true | 无 |
| `moltbot` | `packages/moltbot` | 2026.2.12 | null | `@upbeyond/openbot` |
| `@openbot/toolkit` | `packages/toolkit` | 0.2.0 | true | 无 |

`packages/aor-sdk-python/` 没有 `package.json`，不在上表。

根包没有 `"private": true`。`publishConfig.access` 为 `"public"`。`files` 为：

- `CHANGELOG.md`
- `LICENSE`
- `openbot.mjs`
- `openclaw.mjs`
- `README-header.png`
- `README.md`
- `assets/`
- `dist/`
- `docs/`
- `extensions/`
- `skills/`

### 2.2 `npm pack` 抽样

命令：`npm pack --dry-run --ignore-scripts --json`。抽样发生在写入本目录之前，白名单与本 tip 的根 `package.json` 相同。当时工作区没有 `dist/` 文件（`find dist -type f` 为 0）。

| 项 | 实测 |
| --- | --- |
| tarball 名 | `upbeyond-openbot-2026.7.12-rc.2.tgz` |
| 文件数 | 4281 |
| `unpackedSize` | 73016652 字节（约 69.6 MiB） |
| tarball `size` | 38673980 字节（约 36.9 MiB） |
| 顶层分布 | `docs` 2556、`extensions` 1068、`skills` 622、`assets` 29，其余为根上的少数文件 |

这次 dry-run 没有打进 `dist/`。`files` 仍包含 `dist/`，所以一次真正的 `pnpm build` 之后，包体会在上述数字之上再加大。先前「约 1 万以上文件 / 约 80MB 以上」的说法在这个没有 `dist/` 的工作区里没有原样复现；结构事实仍在：根包白名单把 `dist/`、`docs/`、`extensions/`、`skills/` 一起打进去，未构建时已经是 4281 个文件、解包约 70 MiB。

`docs/` 在白名单内。本目录的 3 个 markdown 合并后会多进 pack，不改变这个结构。

没有执行 `npm publish`。

## 3. 生产发布账本

GitHub Releases 与 Git tags 为空。生产发布的机器记录在本仓库，不在 GitHub Releases。

| 角色 | 路径 | 本次读到的关系 |
| --- | --- | --- |
| 机器账本 | `deploy/production/releases.jsonl` | `deploy/production/LEDGER.md` 写明它是 Path B 的 source of truth |
| 账本说明 | `deploy/production/LEDGER.md` | 人读说明。其中「当前开放行」句子落后于 jsonl |
| 人读发布记录 | `deploy/production/RELEASE_RECORD.md` | `LEDGER.md` 写明它不是机器账本 |

`origin/main` 上的 `releases.jsonl`：跳过 `//` 注释后有 150 条 JSON。最新一行是 seq **152**。

| 字段 | seq 152 |
| --- | --- |
| `gatewaySha` | `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c` |
| `uiSha` | 同上 |
| `tag` | `provenance/sha-d42fbc3ca2b4` |
| `imageTag` | `rc-amd64-provenance-d42fbc3ca2b4` |
| `liveFrom` | `2026-11-01T23:04:06.294Z` |
| `liveTo` | 无（当前开放行） |
| `liveVerified` | true |
| `buildMode` | `full-dist` |

这次解析里，唯一缺少 `liveTo` 的是 seq 152。`LEDGER.md` 仍写 seq 148 为当前开放行，并提到 seq 127 缺少 `liveTo`。以 jsonl 为准。本 PR 不改账本。

账本里的 `tag` 字符串不表示 GitHub 上有这个 tag。第 1 节的 tag API 结果是 0。

## 4. 元数据漂移

下列 URL 仍指向 `gmood2008/openbot`。本 PR 只登记，不修改。

| 位置 | 实测 |
| --- | --- |
| 根 `package.json` `repository.url` | `git+https://github.com/gmood2008/openbot.git` |
| `SECURITY.md` 报告入口 | Core CLI、macOS、iOS、Android 均链到 `gmood2008/openbot` |
| `SECURITY.md` 镜像示例 | `ghcr.io/gmood2008/openbot:latest` |

当前 git remote 是 `https://github.com/flykingvip-cloud/openbot-vp`。

## 5. 权限与分支保护

| 检查 | 结果 |
| --- | --- |
| `GET /repos/flykingvip-cloud/openbot-vp/branches/main` | `protected: false`；SHA 为第 1 节的 tip |
| `GET .../branches/main/protection` | HTTP 403，`Resource not accessible by integration`。不把它当成「存在 ruleset」的证据 |
| `GET .../rulesets` | HTTP 403，`Upgrade to GitHub Pro or make this repository public to enable this feature.` |
| 分支对象上的 required checks | 未观察到。`protected` 为 false |

这是个人私有库：没有 Org team ACL 矩阵，当前默认分支也没有保护。拆仓带来的权限收益要落在新的 private 组件仓上（最少协作者 + 受保护的默认分支），而不是假设本仓库已经具备这层控制。rulesets API 在当前账号计划下不可用；组件仓若要使用 repository rulesets，需要另行满足 GitHub 对私有库 rulesets 的计划要求，或改用该计划允许的分支保护。本盘点不启用任何保护。

## 6. CI 基线（R-05）

GitHub 上该仓库有 20 个 active workflow：19 个根目录 YAML，外加 `Dependabot Updates`。名称如下。

| Workflow | 路径或来源 |
| --- | --- |
| Audit A3 runner probe | `.github/workflows/audit-a3-runner-probe.yml` |
| Auto response | `.github/workflows/auto-response.yml` |
| CI Canary | `.github/workflows/ci-canary.yml` |
| CI Gate | `.github/workflows/ci-gate.yml` |
| CI | `.github/workflows/ci.yml` |
| CodeQL | `.github/workflows/codeql.yml` |
| CogniWeave SDK Benchmark Baseline Refresh | `.github/workflows/cogniweave-sdk-benchmark-baseline-refresh.yml` |
| CogniWeave SDK Nightly | `.github/workflows/cogniweave-sdk-nightly.yml` |
| Delivery SoT alignment | `.github/workflows/delivery-sot-alignment.yml` |
| Docker Release | `.github/workflows/docker-release.yml` |
| HA CommitSafety SQL | `.github/workflows/ha-commitsafety-sql.yml` |
| Install Smoke | `.github/workflows/install-smoke.yml` |
| Labeler | `.github/workflows/labeler.yml` |
| Memory Workspace Freeze | `.github/workflows/memory-workspace-freeze.yml` |
| Memory Workspace Phase0 GH Evidence | `.github/workflows/memory-workspace-phase0-gh-evidence.yml` |
| OpenClaw NPM Release | `.github/workflows/openclaw-npm-release.yml` |
| Sandbox Common Smoke | `.github/workflows/sandbox-common-smoke.yml` |
| Stale | `.github/workflows/stale.yml` |
| Workflow Sanity | `.github/workflows/workflow-sanity.yml` |
| Dependabot Updates | GitHub 动态 workflow |

### 6.1 历史结论计数

`GET /actions/workflows/<id>/runs?status=...&per_page=1` 的 `total_count`，采样日同上。未在下表的 workflow 没有逐个计数。

| Workflow | success | failure | cancelled |
| --- | ---: | ---: | ---: |
| CI | 3 | 662 | 14 |
| CI Gate | 0 | 676 | 3 |
| Docker Release | 0 | 171 | 5 |
| Install Smoke | 0 | 681 | 7 |
| Workflow Sanity | 34 | 651 | 3 |
| OpenClaw NPM Release | 0 | 0 | 0 |
| CodeQL | 0 | 0 | 0 |

CI 的 3 次 success 都在 2026-10-20，且都是 Dependabot 的 Swift PR，不是 `main` 上的产品路径：

- `dependabot/swift/apps/macos/github.com/swiftlang/swift-subprocess-1.0.2`
- `dependabot/swift/apps/macos/swift-deps-eaca1a9877`
- `dependabot/swift/Swabble/swift-deps-2f3f3659a3`

CI Gate 的 success 计数是 0。OpenClaw NPM Release 的运行数是 0：触发条件是 `v*` tag，而本仓库没有 tag，因此还没有 `v*` 公开 npm 发布跑过这条工作流。CodeQL 同样是 0 次运行。

Workflow Sanity 有 34 次 success，其中包含 2026-11-01 的 `main` push。它变绿不代表 CI / CI Gate / Docker Release 变绿。

### 6.2 main tip 上的检查

tip `fde7444fba79cb74569c59e40e36106eeed29dc8` 的 push（2026-11-02T00:16:08Z）上，下列 workflow 在约 3–4 秒内结论为 failure（`updatedAt` 为 00:16:11Z 或 00:16:12Z）：

| Workflow | run | 结论 | 本次看到的 jobs |
| --- | --- | --- | --- |
| CI | [41366225800](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225800) | failure | `secrets`、`docs-scope` 为 failure；其余 skipped。steps 均为 0 |
| CI Gate | [41366225821](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225821) | failure | `check (types, lint, format)`、`delivery guard` 为 failure。steps 均为 0 |
| Docker Release | [41366225827](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225827) | failure | `build-amd64`、`build-arm64` 为 failure；`create-manifest` skipped。steps 均为 0 |
| Install Smoke | [41366225792](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225792) | failure | `docs-scope` 为 failure；`install-smoke` skipped。steps 均为 0 |
| Delivery SoT alignment | [41366225786](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225786) | failure | `forward-only` 为 failure。steps 为 0 |
| Workflow Sanity | [41366225822](https://github.com/flykingvip-cloud/openbot-vp/actions/runs/41366225822) | failure | `no-tabs`、`actionlint` 为 failure。steps 均为 0 |

同一 tip 的 check runs 共 25 个，抽样时均已 `completed`。CI 里 skipped、且 steps 为 0 的 job 是：`check`（与 CI Gate 的 `check (types, lint, format)` 不是同一个 job）、`changed-scope`、`check-docs`、`build-artifacts`、`release-check`、`checks`、`checks-windows`、`macos`、`android`、`ios`、`skills-python`、`cogniweave-sdk-core-gate`、`cogniweave-sdk-integration-rollback`。空 step 的 skipped 不能当成「测试已跳过并证明无关」。

`.github/workflows/ci-gate.yml` 已写明：hosted job 若在约 3 秒内结束、`runner_id=0`、steps 为空、没有日志，则这些 job 没有真正跑检查；分钟数耗尽或 spending limit 是既有假设，本盘点没有打开 Billing，也没有下载日志，因此不把原因写成已证实。可以写成事实的是：tip 上的失败结论墙钟只有数秒，job steps 为空，不能当作「main 集成测试已经跑完并失败」的证据，也不能当作门禁已通过。

含义：在钉住一条可复现的 main CI 基线之前，不能把某条轻量工作流变绿当成完整验证，也不能把上述 failure 当成 G2 所要求的「main 集成测试通过」。G2 试点应等这条基线存在之后再开始。

## 7. 试点建议

建议试点包（不实施，也尚未被批准为正式候选）：

| 项 | 值 |
| --- | --- |
| 包名 | `@openbot/collaboration-core` |
| 路径 | `packages/collaboration-core` |
| 版本 | `0.1.0` |
| `private` | true |
| 运行时 dependencies | 无 |
| 直接 workspace 消费方 | `@openbot/collaboration-runtime`、`@openbot/collaboration-openbot-adapter`（均为 `workspace:*`，且 `private: true`） |
| 包内文件 | 37 个 `.ts` / `.json` / `.md`（含测试与 tsconfig） |
| 包说明 | `packages/collaboration-core/README.md` 写明 workspace-internal，且尚未批准独立发布 |

源码导出的是类型、状态机、策略、模板校验和健康分。测试以外的 import 停留在包内相对路径。根脚本 `build:collaboration:packages` 的顺序已是 core，然后 runtime，然后 adapter。

选择它作为建议，是因为边界相对清楚，表面远小于根包（根包 dry-run 已是 4281 个文件），消费方只有上面两个私有包，适合作为「private 组件仓 + 不可变 pin 回单体」的 ACL 试点。零依赖并不是它独有：`@openbot/aor-core`、`@openbot/evolution-core`、`@openbot/toolkit` 的 `dependencies` 也是空的。AOR 的下游包更多；constitutional 包自身写明还不是可独立部署的 scaffold。因此建议停在 collaboration-core，而不是把所有零依赖包都当成同一优先级。

### 试点迁代码之前的阻塞

1. G0：公开 npm 面还没有书面决定。根包 `publishConfig.access` 是 `public`，本包是 `private: true`，包 README 写明尚未批准独立发布。见 [decisions.md](./decisions.md) 选项 A。
2. CI：第 6 节的 main 基线不能当作集成测试信号。
3. 保护：`main` 的 `protected` 为 false，个人仓库没有 team ACL。
4. 元数据：`package.json` 与 `SECURITY.md` 仍指向 `gmood2008/openbot`。本 PR 不修。

在上述阻塞被单独处理之前，不移动这个包。
