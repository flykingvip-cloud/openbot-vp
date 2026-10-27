# 员工技能生命周期：闸门 A 基线差异记录

> **文档状态：闸门 A 完全通过 / HK 为 2026-10-10 现场复验 / Mac 私服与 CLI 仍是非 HK 身份 / 未实施产品改动**
>
> 日期：2026-10-10
> 性质：垂直切片 `docs/design/employee-skill-lifecycle-vertical-slice-2026-10-10.md`（PR #549）§6.1 的只读核对产出。HK LIVE 已由当日主机读取确认，不再只是台账最后已知。
> 本文件记录调查基线与当时 `origin/main` 在技能安装、投影、binding 路径上的差异，以及 HK 运行中容器的 commit 与镜像 digest。它不修改产品代码。Mac 私服 gateway 与 PATH CLI 检出仍是另外两条身份。

## 1. 摘要

2026-10-10 对 `origin/main` 做了一次只读 fetch，并按路径核对员工技能安装、投影与 binding。

调查基线是 `93ce9df262b3666d83f64c559a5e7801e6bde089`（#543，Platform: key-account P1 audit and terms）。当时 `origin/main` HEAD 是 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`（#548，Platform: key-account P2 thin slice）。基线是该 HEAD 的祖先。

在本文件第 3 节列出的技能路径上，基线到该 HEAD 的 diff 为空。这些路径上最近一次提交都早于基线。就员工技能安装、投影、binding 路径而言，调查基线与当时的 `main` 内容等价。主干在这段区间里的演进落在 key-account 与模型池等无关面上。

生产标识的权威定义是：运行中容器 `/app/dist/build-info.json` 的 commit，加上该容器的镜像 digest。`package.json` 版本和镜像 tag `:latest` 不是这个标识。

第 5 节并列三条身份，它们不是同一个 SHA。HK 现场复验的 commit 是 `65564d30…`，与台账相同。Mac 私服正在跑的 gateway 是 `277f6c53…`。PATH CLI 检出是 `71b0c9c0…`。私服实跑不等于 CLI 检出，也不等于 HK LIVE。HK commit 在 `upbeyond/openbot` 历史中，并且是调查基线与当时 `main` 的祖先。2026-10-10 约 13:49（Asia/Shanghai）已读到 HK 容器 `openbot-gateway-rc` 的 `/app/dist/build-info.json` 与 RepoDigest。闸门 A 的两项 LIVE 字段因此勾选通过。Mac 这条仍来自性能评测 bot 对 Mac 私服/本机的只读观察，不是 HK 云生产。

相关文档仍在独立 PR，未合入本次核对的 `main`：

| 材料                       | PR   | 本文件如何使用它                            |
| -------------------------- | ---- | ------------------------------------------- |
| 现状分析                   | #545 | 调查基线的来源。本文件不改写其结论          |
| 优化方案（D0=A 已冻结）    | #546 | 闸门定义的上游。本文件不勾选其 §6 决定      |
| 垂直切片与 §6.1 实施前义务 | #549 | 本文件是其 §6.1 在 `8ce4b0fe…` 上的只读补记 |

#549 撰写时记录的 `origin/main` 是 `833fb81bbc6e0cf12b98249c988d2f89a3fe52ab`（#544）。其后 #548 已合入。本文件把 HEAD 更新到 `8ce4b0fe…`。技能路径结论仍是无 diff。#549 里的那次记录是当时的快照，不能代替本次 HEAD。

## 2. main HEAD 与调查基线

| 项                      | 值                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| 核对日期                | 2026-10-10                                                                                        |
| 调查基线                | `93ce9df262b3666d83f64c559a5e7801e6bde089`                                                        |
| 基线说明                | Platform: key-account P1 audit and terms (K-06/K-07)（#543），2026-10-10 09:54:38 +0800           |
| 当时 `origin/main` HEAD | `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`                                                        |
| HEAD 说明               | Platform: key-account P2 thin slice（#548），2026-10-10 13:05:09 +0800                            |
| 祖先关系                | 基线是该 HEAD 的祖先                                                                              |
| 区间内提交              | 恰好两笔：#544、#548。见第 4 节                                                                   |
| 技能路径 diff           | 空。见第 3 节                                                                                     |
| 生产部署标识            | HK 今日现场复验，见第 5 节。LIVE commit `65564d30…`，LIVE digest 为 RepoDigest `sha256:52cb4039…` |

核对方法（只读）：

1. `git fetch origin main`，`git rev-parse origin/main` 得到 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`。
2. 对每个路径执行 `git log -1 origin/main -- <path>`。这是 path 过滤、sha 指向当时 `main` 的最近一次提交，对应 `list_commits`（path 过滤，sha=main）。
3. 对每个路径执行 `git diff --stat 93ce9df262b3666d83f64c559a5e7801e6bde089 origin/main -- <path>`。输出为空。
4. `git log 93ce9df262b3666d83f64c559a5e7801e6bde089..origin/main -- <paths>` 无提交。

上表记录的是第一次 fetch 的窗口，HEAD 停在 `8ce4b0fe…`。同日稍后再次 `git fetch origin main`，`origin/main` 前进到 `156b03113c6cb45f2be56da57dccae65f4f8a5e3`（#547，Control UI: fill fullscreen computer preview，2026-10-10 13:14:52 +0800）。`8ce4b0fe…` 是这次新 HEAD 的祖先。对第 3 节路径执行 `git diff --stat 93ce9df262b3666d83f64c559a5e7801e6bde089 156b03113c6cb45f2be56da57dccae65f4f8a5e3 -- <paths>`，输出仍为空。#547 的改动在账号电脑预览与 changelog，不改安装、投影、binding。

若 `origin/main` 再前进，须重做路径 diff。本文件不能代替下一次核对。

## 3. 技能路径 diff 表

比较范围：`93ce9df262b3666d83f64c559a5e7801e6bde089` .. `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`。

前五行是员工技能安装、投影、binding 的关键路径，由 path 过滤的最近提交确认早于基线。后两行是 #549 §6.1「至少覆盖」名单里的其余路径，同一次只读核对，diff 同样为空。

| 路径                                                    | `main` 上最近提交                                                                                                | 最近提交时间              | 相对基线 | 基线到 main 的 diff |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- | -------- | ------------------- |
| `src/gateway/server-methods/employee-install.ts`        | `01b6d5a910ef74e2ca344b80f9418b5d6d21f9cb` Evolution: delegation service, pack, and working-dna proposal (#1119) | 2026-09-14 10:35:42 +0800 | 早于基线 | 无后续改动          |
| `src/gateway/skill-lifecycle-store.ts`                  | `3dbb5121a0119434093513308b9d735e76085ebd` Gateway: reuse shared number reader in skill lifecycle store          | 2026-09-23 16:26:01 +0000 | 早于基线 | 无后续改动          |
| `src/gateway/runtime-binding-sync.ts`                   | `109bd59507277fac0683a4480f4268bf44ceae8f` chore(rebrand): OpenClaw→OpenBot 主路径清理（Phase A）                | 2026-09-26 15:49:55 +0800 | 早于基线 | 无后续改动          |
| `src/gateway/capability-packs/install-pack-to-robot.ts` | `109bd59507277fac0683a4480f4268bf44ceae8f` 同上 rebrand                                                          | 2026-09-26 15:49:55 +0800 | 早于基线 | 无后续改动          |
| `src/gateway/skill-execution-binding/`                  | `0e70c76362d98b23ecf0c208910f11cb0c840f85` Gateway: reuse shared isRecord in skill tool wrappers                 | 2026-09-23 16:26:01 +0000 | 早于基线 | 无后续改动          |
| `src/gateway/server-methods/skill-lifecycle.ts`         | `017201792d8ec74180b23064966ef2342f0a314d` Gateway: share RPC param readers                                      | 2026-09-23 16:26:01 +0000 | 早于基线 | 无后续改动          |
| `src/agents/pi-embedded-runner/skills-runtime.ts`       | `109bd59507277fac0683a4480f4268bf44ceae8f` 同上 rebrand                                                          | 2026-09-26 15:49:55 +0800 | 早于基线 | 无后续改动          |

结论只覆盖上表路径：调查基线与当时 `main` 在这些文件上内容等价。这不表示整棵仓库与基线等价。HK 运行中的 commit 已在第 5.4 节现场读到，就是 `65564d30…`。该 commit 在 git 上是基线的祖先，且这些路径从该 commit 到基线的 diff 为空。整棵仓库在这段区间里仍有 337 个其他提交。

## 4. 无关合入列表

`93ce9df262b3666d83f64c559a5e7801e6bde089..8ce4b0fe7bfc227dbc19f42610be7e14530f837c` 在本次 fetch 时只有下面两笔。两笔都不修改第 3 节的路径。

| 提交                                       | PR   | 说明                                                                                            | 与技能通道                    |
| ------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| `833fb81bbc6e0cf12b98249c988d2f89a3fe52ab` | #544 | UI: 连接成功后才进入模型池，并接通企业自建提供方。改动在企业模型探测、企业自建提供方与模型池 UI | 无关。不改安装、投影、binding |
| `8ce4b0fe7bfc227dbc19f42610be7e14530f837c` | #548 | Platform: key-account P2 thin slice。改动在平台大客户页面、路由与 changelog                     | 无关。不改安装、投影、binding |

#544 是 #549 撰写时已经看见的那一笔。#548 是其后合入、把 `main` 推到第一次 fetch 的 HEAD 的那一笔。两笔都留在 key-account 与模型池等无关面。

同日稍后，从 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c` 到 `156b03113c6cb45f2be56da57dccae65f4f8a5e3` 还有一笔，同样不改第 3 节路径：

| 提交                                       | PR   | 说明                                                                                   | 与技能通道                    |
| ------------------------------------------ | ---- | -------------------------------------------------------------------------------------- | ----------------------------- |
| `156b03113c6cb45f2be56da57dccae65f4f8a5e3` | #547 | Control UI: fill fullscreen computer preview。改动在账号电脑预览、侧栏样式与 changelog | 无关。不改安装、投影、binding |

## 5. 生产部署标识

状态：**HK 今日现场复验 / Mac 私服与 CLI 仍是另外两条身份**。

权威定义：HK 的 LIVE 是运行中容器 `/app/dist/build-info.json` 里的 commit，加上该容器的 RepoDigest。`package.json` 里的版本字符串、镜像 tag `:latest`、本机分支名、`openbot --version` 打印的版本、Image Id，都不是这个 LIVE digest。Image Id 与 RepoDigest 是两个字段。闸门 A 采用 RepoDigest。

三条身份：

| 身份                     | commit                                     | 来源                                                                                                                                                                  | 能否当作 HK LIVE                               |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| HK 生产主通道            | `65564d30b25a41f49866f96e0efed9caacd80a9b` | 2026-10-10 约 13:49（Asia/Shanghai），AI 服务部署策略 bot 经 Mac SSH 只读 `root@8.217.93.71` 上的容器 `openbot-gateway-rc`。先前 HANDOFF 台账的 commit 与这次读数相同 | 是。commit 与 RepoDigest 见第 5.4 节           |
| Mac 私服正在跑的 gateway | `277f6c5304b00142a180effcf2c0062fa9b0d5e3` | openbot 性能评测 bot，只读 Mac 私服/本机。进程 cwd 与 `~/.openbot/control-ui-sync-pin`                                                                                | 否。这不是 HK 云生产                           |
| PATH CLI / 主仓检出      | `71b0c9c0dd1a8274d1da18254456b4c8194e16e6` | `openbot --version` 与该检出的 git HEAD                                                                                                                               | 否。也不是正在跑的 Mac gateway，也不是 HK LIVE |

私服实跑、CLI 检出、HK LIVE 是三条身份。版本叙事 `2026.7.12-rc.2` 同时出现在 HK `build-info.json`、Mac gateway 叙事和 CLI 版本输出里，不能用来判断正在跑的是哪一个 SHA。

### 5.1 HK 生产主通道

台账值与 2026-10-10 现场读数并列。现场读数是 LIVE。台账里的 commit 与现场 commit 相同。

| 项                           | 台账 / 先前 handoff                                                                       | 2026-10-10 现场                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| git commit                   | `65564d30b25a41f49866f96e0efed9caacd80a9b`                                                | 相同。`/app/dist/build-info.json` 的 `commit`                                                                        |
| 版本字符串                   | 叙事 `2026.7.12-rc.2`                                                                     | `build-info.json` 的 `version` 同为 `2026.7.12-rc.2`。本仓库 tag 列表仍没有这个名字。git 身份以 commit 为准          |
| Image Id                     | handoff ImageID `sha256:f5de285d6ad3c7a176061880097fbe95283f0a6834ee237b79bbfcbad586468f` | Image Id `f5de285d6ad3c7a176061880097fbe95283f0a6834ee237b79bbfcbad586468f`，与 handoff 的十六进制相同               |
| LIVE digest                  | 台账曾提醒本地 tag 可能对应另一个 digest，以主机现跑为准                                  | RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`。闸门 A 用这一条，不用 Image Id |
| 镜像名                       | 未作为 LIVE                                                                               | `localhost/openbot:rc-amd64-provenance-65564d30b`                                                                    |
| 容器                         | 未作为 LIVE                                                                               | `openbot-gateway-rc`，容器 Id `8ad6ef48d430…`                                                                        |
| `builtAt` / `probeModuleSha` | 台账未记                                                                                  | `2026-10-05T03:38:07.031Z` / `ea6e7337fbf3f1da`                                                                      |
| HK 私服公网探测              | 2026-10-10 起公网探测不可达                                                               | 本次是 SSH 到主机读容器，不依赖那次公网探测。这与第 5.6 节的 Mac 私服不是同一条观察                                  |
| 候选 tip                     | `71b0c9c0dd1a8274d1da18254456b4c8194e16e6` 台账写明未上线                                 | 现场 commit 不是这个 SHA。它仍是第 5.6 节的 CLI 检出                                                                 |

调查基线 `93ce9df…` 与当时 `main` `8ce4b0fe…` 都不是 HK LIVE。Image Id 与 RepoDigest 不一致是两个字段的差别，不是 commit 对不上。现场 commit 与台账 commit 一致。

### 5.2 该 commit 在 git 历史中的位置

现场 `build-info.json` 的 commit 等于台账 SHA，因此下面的祖先关系描述的是 HK 生产 commit，不再只是台账假设。2026-10-10 通过仓库历史与 GitHub API 读取。提交存在于 `upbeyond/openbot`：

https://github.com/upbeyond/openbot/commit/65564d30b25a41f49866f96e0efed9caacd80a9b

提交说明是 `fix(gateway): answer greetings and availability checks in collaboration rounds (#329)`，时间 2026-10-05 11:27:21 +0800。这与版本叙事 `2026.7.12-rc.2` 不是同一套标识。叙事不改变 SHA。

| 关系                                                                      | 结果                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否在 `upbeyond/openbot` 历史中                                          | 是                                                                                                                                                                                                                                           |
| 相对调查基线 `93ce9df262b3666d83f64c559a5e7801e6bde089`                   | 台账 commit 是基线的祖先。基线不是台账 commit 的祖先。`65564d30..93ce9df` 有 337 个提交，反向为 0                                                                                                                                            |
| 相对当时 `main` `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`                | 台账 commit 是当时 `main` 的祖先。当时 `main` 是台账 commit 的后代                                                                                                                                                                           |
| 相对本次补记时的 `origin/main` `156b03113c6cb45f2be56da57dccae65f4f8a5e3` | 台账 commit 仍是其祖先                                                                                                                                                                                                                       |
| 候选 tip `71b0c9c0dd1a8274d1da18254456b4c8194e16e6`                       | 提交说明为 `fix(account-computer): prefer roster agent.name over DEFAULT Assistant on strip (#464)`，2026-10-08 20:24:56 +0800。它是台账 commit 的后代，也是调查基线、当时 `main` 与 `156b03113…` 的祖先。它在主干历史上，台账仍写明它未上线 |

整棵树在台账 commit 与调查基线之间有 337 个提交。这不表示技能路径有差异。技能路径见第 5.3 节。

### 5.3 技能路径的 git diff

比较对象仍是第 3 节的七个路径。diff 本身是 git 对象比较。HK 那一端的 commit 已由第 5.4 节的现场读取确认。

| 区间                                                                                          | 第 3 节路径的 diff                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `65564d30b25a41f49866f96e0efed9caacd80a9b` .. `93ce9df262b3666d83f64c559a5e7801e6bde089`      | 空。区间内也没有修改这些路径的提交 |
| `93ce9df262b3666d83f64c559a5e7801e6bde089` .. `8ce4b0fe7bfc227dbc19f42610be7e14530f837c`      | 空。见第 3 节                      |
| `93ce9df262b3666d83f64c559a5e7801e6bde089` .. `156b03113c6cb45f2be56da57dccae65f4f8a5e3`      | 空。见第 2 节对 #547 的补记        |
| `65564d30b25a41f49866f96e0efed9caacd80a9b` .. `277f6c5304b00142a180effcf2c0062fa9b0d5e3`      | 空                                 |
| `71b0c9c0dd1a8274d1da18254456b4c8194e16e6` .. `277f6c5304b00142a180effcf2c0062fa9b0d5e3`      | 空                                 |
| `277f6c5304b00142a180effcf2c0062fa9b0d5e3` 与 `93ce9df262b3666d83f64c559a5e7801e6bde089` 两侧 | 空。两边都没有修改这些路径的提交   |
| `71b0c9c0dd1a8274d1da18254456b4c8194e16e6` .. `93ce9df262b3666d83f64c559a5e7801e6bde089`      | 空                                 |

HK 运行中容器的 commit 就是 `65564d30…`，与台账相同，第 5.4 节已读到。这些路径从该 commit 到调查基线、到当时 `main`、到本次补记时的 `main` 内容相同。Mac 私服 gateway 与 CLI 检出相对基线，这些路径的 git 内容也相同。Mac 行描述的是 Mac 私服，不描述 HK 生产。空 diff 只覆盖第 3 节路径，不表示整棵仓库相同。

### 5.4 今日 HK 现场复验

已做。时间 2026-10-10 约 13:49（Asia/Shanghai）。来源：AI 服务部署策略 bot，经 Mac SSH 只读 `root@8.217.93.71`，容器 `openbot-gateway-rc`。第 5.6 节的 Mac 私服观察不是这次读取。

`/app/dist/build-info.json`：

```json
{
  "version": "2026.7.12-rc.2",
  "commit": "65564d30b25a41f49866f96e0efed9caacd80a9b",
  "builtAt": "2026-10-05T03:38:07.031Z",
  "probeModuleSha": "ea6e7337fbf3f1da"
}
```

镜像：

| 项                        | 值                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| ImageName                 | `localhost/openbot:rc-amd64-provenance-65564d30b`                                           |
| Image Id                  | `f5de285d6ad3c7a176061880097fbe95283f0a6834ee237b79bbfcbad586468f`                          |
| RepoDigest                | `localhost/openbot@sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f` |
| 闸门 A 采用的 LIVE digest | `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`                   |
| Container Id              | `8ad6ef48d430…`                                                                             |

对照结果：

- `commit` 与台账 `65564d30b25a41f49866f96e0efed9caacd80a9b` 相同。第 5.2 节和第 5.3 节因此描述 HK 生产。
- Image Id 与先前 handoff ImageID 的十六进制相同。
- RepoDigest 与 Image Id 不是同一条字符串。闸门 A 的 LIVE digest 用 RepoDigest。这是字段之别，现场 commit 没有改口。
- Mac gateway `277f6c53…` 与 CLI `71b0c9c0…` 都不是这个容器的 commit。

### 5.5 验收 bot 可如何判断

闸门 A 的 HK LIVE 两项都已记录，且 commit 与台账一致，因此第 6.2 节两项勾选。技能路径的空 diff 现在挂在这个已核实的生产 commit 上。

仍然成立的分界：Mac 私服实跑、CLI 检出、HK LIVE 不是同一个 SHA。版本叙事 `2026.7.12-rc.2` 不能区分它们。本文件不通过闸门 B 或闸门 C，也不修改产品代码。

### 5.6 Mac 私服与本机 CLI（非 HK 云生产）

来源：openbot 性能评测 bot，只读 Mac 私服/本机。日期随本文件的 2026-10-10 补记。这条观察不是第 5.4 节的 HK 容器读取。HK 的 `/app/dist/build-info.json` 只出现在第 5.4 节。

| 项                                                                       | 观察                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 正在跑的 gateway SHA                                                     | `277f6c5304b00142a180effcf2c0062fa9b0d5e3`                  |
| worktree                                                                 | `openbot-pr537-preview-chrome-accept`                       |
| pin                                                                      | 与 `~/.openbot/control-ui-sync-pin` 一致                    |
| 证据位置                                                                 | 进程 cwd 与 pin                                             |
| 版本叙事                                                                 | `2026.7.12-rc.2`。叙事只是标签，git 身份是上面的 SHA        |
| `GET :18789/api/version`                                                 | 404                                                         |
| `:18789/health`                                                          | live                                                        |
| PATH CLI                                                                 | `openbot --version` 输出 `OpenBot 2026.7.12-rc.2 (71b0c9c)` |
| CLI 检出 git HEAD                                                        | `71b0c9c0dd1a8274d1da18254456b4c8194e16e6`                  |
| 正在跑的 gateway 与 CLI 检出                                             | 不是同一 SHA                                                |
| OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）环境 | 没有 `OPENBOT_COMMIT`、`OPENBOT_BIN`、`OPENBOT_IMAGE`       |
| openbot Docker 业务容器                                                  | 没有正在跑的业务容器                                        |

worktree 名字里的 pr537 不表示正在跑的提交就是已合入主干的 #537（`185c49583`）。正在跑的提交是 `277f6c53…`，见下表。

两条 SHA 都在 `upbeyond/openbot` 历史中。GitHub 提交页：

- https://github.com/upbeyond/openbot/commit/277f6c5304b00142a180effcf2c0062fa9b0d5e3
- https://github.com/upbeyond/openbot/commit/71b0c9c0dd1a8274d1da18254456b4c8194e16e6

`277f6c53…` 的提交说明是 `Control UI: send classic Control+Alt+D for 返回桌面`，时间 2026-10-10 00:44:03 +0000。在本次已抓取的 `origin` 分支里，没有分支包含它，它也不在 `origin/main` 上。

| 关系                                        | 结果                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `277f6c53…` 是否在 `upbeyond/openbot`       | 是                                                                                                                               |
| `71b0c9c0…` 是否在 `upbeyond/openbot`       | 是。提交说明 `fix(account-computer): prefer roster agent.name over DEFAULT Assistant on strip (#464)`，2026-10-08 20:24:56 +0800 |
| `71b0c9c0…` 相对调查基线 `93ce9df…`         | `71b0c9c0…` 是基线的祖先。`71b0c9c0..93ce9df` 有 74 个提交，反向为 0。它也是当时 `main` `8ce4b0fe…` 的祖先                       |
| `277f6c53…` 相对调查基线                    | 分叉。共同祖先是 `b7b72e9cecc6727d4946188123ad909b35f42de8`（#539）。基线不是它的祖先，它也不是基线的祖先                        |
| 只在 gateway 一侧、不在基线一侧             | 两笔：`82eb0b414`（Control UI: keep computer preview chrome outside the stream）、`277f6c53…`                                    |
| 只在基线一侧、不在 gateway 一侧             | 五笔：#540、#541、#542、#537、#543                                                                                               |
| `277f6c53…` 相对当时 `main` `8ce4b0fe…`     | 同样分叉。当时 `main` 比基线多 #544 与 #548，这两笔也不在 gateway 一侧                                                           |
| `65564d30…` 相对 `277f6c53…` 与 `71b0c9c0…` | 台账 commit 是这两条 SHA 的祖先                                                                                                  |
| `71b0c9c0…` 相对 `277f6c53…`                | CLI 检出是正在跑的 gateway 的祖先。`71b0c9c0..277f6c53` 有 71 个提交，反向为 0。二者仍不是同一 SHA                               |

第 3 节技能路径在这三条 SHA 与调查基线之间的 git diff 为空，见第 5.3 节。分叉的那些提交不改这些路径。空 diff 不把 Mac 私服写成 HK 生产，也不把 CLI 检出写成正在跑的 gateway。

## 6. 验收勾选

两组勾选分开。勾选第 6.1 节不会勾选第 6.2 节。

### 6.1 可以勾选

本文件已经记录 main 相对基线的技能路径差异。

- [x] main 相对基线的技能路径差异已记录
- [x] 记录结论：第 3 节路径在 `93ce9df262b3666d83f64c559a5e7801e6bde089` 到 `8ce4b0fe7bfc227dbc19f42610be7e14530f837c` 之间无 diff
- [x] 基线之后合入主干、与技能通道无关的已知提交已列出（#544、#548；稍后的 #547 见第 4 节）
- [x] 已记录生产 commit `65564d30b25a41f49866f96e0efed9caacd80a9b`，以及它相对调查基线与当时 `main` 的祖先关系。2026-10-10 现场 `build-info.json` 的 commit 与此相同
- [x] 已并列记录 Mac 私服实跑 gateway `277f6c5304b00142a180effcf2c0062fa9b0d5e3` 与 CLI 检出 `71b0c9c0dd1a8274d1da18254456b4c8194e16e6`，并写明私服实跑、CLI 检出、HK LIVE 不是同一 SHA

上一组记录 git 事实和身份分界。HK 现场的 commit 与 digest 在第 6.2 节。Mac 私服不能代替 HK LIVE。

### 6.2 今日 HK 现场核实与闸门 A

- [x] 今日 HK 现场核实（commit `65564d30b25a41f49866f96e0efed9caacd80a9b` + 该容器镜像 digest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`）
- [x] 闸门 A 完全通过

勾选依据：第 5.4 节同时记下 commit 与 RepoDigest；commit 与台账 SHA 相同；Image Id 与 handoff ImageID 的十六进制相同；闸门 A 采用的 digest 是 RepoDigest，不是 Image Id。Mac 私服与 CLI 检出没有被用来勾这两项。

## 7. 下一步

闸门 A 已按第 6.2 节勾选。本文件仍然只是这份记录：

- 禁止修改产品代码，包括 `src/`、`ui/`、`extensions/`、`skills/` 中的产品行为与提示词。
- 禁止修改测试、默认配置，以及 `docs/tools/`、`docs/cli/`、`docs/zh-CN/`。
- 禁止把本文件当成闸门 B 或闸门 C 的通过记录。
- 禁止把 Mac 私服实况或 CLI 版本输出写成 HK LIVE。第 6.2 节只依据第 5.4 节的 HK 容器读数。
- 禁止把私服实跑、CLI 检出、HK LIVE 写成同一个 SHA。

第 6.2 节已勾选今日 HK 现场核实和闸门 A 完全通过。LIVE digest 是 `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`。本文件仍然不包含产品代码。`origin/main` 若再前进，技能路径 diff 须重做；那一次重做不撤销已经记下的这次 HK 读数，除非主机上的 `build-info.json` 或 RepoDigest 变了。
