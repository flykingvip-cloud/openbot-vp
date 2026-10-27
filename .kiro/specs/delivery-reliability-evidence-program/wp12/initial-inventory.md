# WP-12 许可与权属审计 — 初始盘点（只读）

状态：AUDITING  
HEAD：`c0c0ba52b0b2460a1e3e2fa9bbf7b889355dd07d`  
范围冻结参照：当前 SHA + 锁文件 + 既有 SBOM  
**不修改 LICENSE，不删除版权声明，不认定可独占许可。**

## A. 已核实事实（VERIFIED / 技术事实）

| 项                           | 事实                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根 LICENSE                   | 文件 `LICENSE` 为 MIT；Copyright (c) 2025 Peter Steinberger                                                                                                                               |
| 根 package.json license 字段 | `MIT`                                                                                                                                                                                     |
| SBOM                         | `sbom/openbot.cdx.json` CycloneDX 1.6；timestamp `2026-10-08T09:29:35Z`；工具 cdxgen 12.8.5；components=1600                                                                              |
| SBOM 许可分布（扫描器字段）  | MIT 901；Apache-2.0 242；ISC 75；BSD-3-Clause 38；BSD-2-Clause 19；另有 MPL/LGPL 等少量；**284** 个 component 无 licenses 字段                                                            |
| 本地 LICENSE 类文件          | `LICENSE`；`Swabble/LICENSE`；`extensions/open-prose/skills/prose/LICENSE`；`extensions/media-monitor/LICENSE-NOTES.md`；若干 skills LICENSE；macOS DeviceModels Apple identifiers NOTICE |
| packages/\*                  | 17 个 package.json **均未**声明 license 字段（继承关系未在 package 元数据核实）                                                                                                           |
| extensions/\* package.json   | 37 个 **均未**声明 license 字段                                                                                                                                                           |
| 贡献文档                     | `CONTRIBUTING.md` 存在（内容未在本轮作法务解读）                                                                                                                                          |
| 生成链                       | `scripts/generate-cyclonedx-sbom.ts` 存在，可复用                                                                                                                                         |

## B. 来源或权属未知（UNKNOWN）

| 项                                        | 未知点                                       |
| ----------------------------------------- | -------------------------------------------- |
| packages/_ / extensions/_ 无 license 字段 | 是否意图继承根 MIT，或另有协议 — **未知**    |
| SBOM 284 无 license 字段组件              | 真实 SPDX / 是否进 runtime 包 — **未知**     |
| 非 JS 生态（Python/原生/字体/模型/镜像）  | 当前 SBOM 不能证明已覆盖 — **未覆盖**        |
| git author / trailers                     | 不能当版权转让或重许可授权                   |
| 员工/承包商/贡献者协议                    | 本轮未取得合同原件或受控引用                 |
| Apple device identifiers NOTICE 义务      | 分发形态是否触发 — 待对照实际 mac 应用发布物 |
| vendored / patches                        | 未完成本轮逐文件 provenance                  |
| 上游 OpenClaw/Clawdbot 历史命名遗留包     | 权利链条 — **未知**                          |

## C. 待法律顾问判断（NEEDS_REVIEW）

1. 在根 MIT + 大量无 license 字段工作区包的情况下，对外 npm/源码/镜像分发的实际义务与声明是否充分。
2. SBOM 中 MPL/LGPL 等组件是否进入各发布形态；若进入，义务清单。
3. 未来“部分模块双许可/商业许可/取消 MIT”的可行性前提（本审计**不预置**可行）。
4. 贡献者授权缺口对重许可的阻断条件。
5. 第三方 NOTICE（含 Apple identifiers）在桌面发布中的合规动作。

## D. 下一步产出（仍只读）

- `license-inventory.csv` / `source-provenance.csv` / `license-findings.csv` 骨架填充
- `audit-method.md`（命令、退出码、排除规则、覆盖率分母）
- 重新生成或核验 SBOM 与当前锁文件一致性（只读比对；若再生成本地工件则不改 LICENSE）

## E. 明确不做

替换 LICENSE；删除上游声明；将 MIT 或 git author 标为“可独占”。
