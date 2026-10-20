---
name: documents
description: >-
  当用户需要创建、编辑、修订批注或核验 Word/DOCX，或需要报告写作/执行摘要等管理写作并落到正式文档时务必使用本技能。
  覆盖备忘录、报告、方案、SOP、手册、执行摘要、修订与渲染质检。
  遇到「写报告」「做 Word」「DOCX」「执行摘要」「改稿」「标题层级」「页眉页脚」「渲染验收」务必使用。
  已吸收 office-core document-writing-core 的写作工作流；不另建平行 document-writing-core。
  不要用于 PPT（cyber-ppt）或 PDF（nano-pdf）主交付。
---

# documents（DOCX / 商务写作与文件工艺）

OpenBot 化文档技能：**写作路由 + python-docx 文件工艺**。先定受众与决策，再写结构，最后 **渲染→看图→迭代**。不捆绑 Codex artifact_tool / openai.yaml / 专有脚本整树。

## 概述

- **文档生产**：创建/编辑结构化可编辑 DOCX，保留模板与既有样式。
- **报告写作**：证据 → 发现 → 含义 → 建议 → 下一步。
- **执行摘要**：结果、关键证据、风险、请求的决策——最短有用形式。
- 版式与核验见 references；写作原则见 `references/writing-workflows.md`。

## 前置

1. 确认受众、决策/行动、格式（DOCX 默认）、证据来源、语气与篇幅。
2. 若有模板/品牌样式，先读取样式再写内容。
3. 约定：工作区交付路径；是否需要批注版 vs 净稿。
4. 依赖：`python-docx`；渲染用 LibreOffice/Word + PNG（poppler）验收。

## 流程

### 写作路由

1. **定位**：读者要做什么决定或动作；一句话主结论。
2. **选形态**：执行摘要 / 正文报告 / SOP / 方案备忘；长文先大纲。
3. **证据纪律**：不支持的主张不写硬；区分事实、解读、建议、不确定。
4. **执行摘要**（若需要）：结果 → 证据要点 → 风险 → 请求决策；可置于文首。
5. **修订**：区分实质修改与润色；保留用户原意。

### 文件工艺

1. Title 样式黑字；开篇写清范围、为何重要、主结论/请求。
2. 用 python-docx 写段落/样式/表/页眉页脚；默认 Letter/A4 按用户约定。
3. **每次有意义改动后渲染并检查 PNG**（见 `references/verify-render.md`）。
4. 修裁切、重叠、坏表、页空白、字号过小；再渲。
5. 只交最终 DOCX（外加可选 PDF 预览，非 nano-pdf 主路径时仅预览）。

## 输出

```text
output/documents/<doc-id>/
  draft.docx
  final.docx
  exec-summary.md         # 可选，源稿
  render-preview/         # PNG 抽检
```

## 边界

- **做**：商务写作结构、DOCX 创建编辑、执行摘要、渲染质检。
- **不做**：PPT/PDF 主交付；公众号正文 HTML / 成稿（走 `wechat-article`）；未渲图宣称版式无问题；平行再建 document-writing-core。
- **相邻**：调研证据 → research-core；战略备忘可先 strategy-core 再本文落 Word；演示 → cyber-ppt；公众号排版 → wechat-article；草稿箱 → 身份工具。
- **警告：** 勿平行拷贝 Codex documents 专有脚本包或 `openai.yaml`；交付工作区文件。

## 触发样例

- 「写一份给管理层的报告 DOCX，文首要执行摘要」
- 「把这份大纲做成正式 Word，按模板样式」
- 「修订方案：只改实质，保留原语气，然后渲图验收」
- 「一页执行摘要：结论、证据、风险、要拍的板」

## 参考

- `references/writing-workflows.md` — 报告/摘要写作路由（自 writing-core）
- `references/writing-and-layout.md` — 文风与版式摘要
- `references/create-edit.md`
- `references/verify-render.md`
- `references/openbot-delivery.md`
- `ATTRIBUTION.md`
