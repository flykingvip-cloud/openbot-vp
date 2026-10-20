# Prompting（OpenBot / API）

原则适用于 `scripts/gen.py` 与任何 Images API 调用。

## 结构

顺序：scene/backdrop → subject → key details → constraints → output intent。写明用途（广告、UI mock、信息图）以设定完成度。

## 具体度

- 用户已经很具体：只整理成清晰规格，不另加创意需求。
- 用户很笼统：可适度补构图/用途/布局，且必须实质性提升结果。

允许：构图取景、完成度、布局、合理场景具体化。  
禁止：未暗示的角色/道具、自造品牌色与口号、无依据的左右摆放。

## 约束与迭代

- 编辑写清不变量：`change only X; keep Y unchanged`；每轮重复。
- 图内文字：引号或逐字拼写；要求 verbatim。
- 多图输入：按索引标注角色（edit target / style reference / insert）。
- 一次只改一个因素再检查。

## 透明底

明确要求真正透明背景并保留 alpha。

## 用例提示（slug）

生成：photorealistic-natural, product-mockup, ui-mockup, infographic-diagram, logo-brand, ads-marketing, productivity-visual, scientific-educational, illustration-story, stylized-concept, historical-scene。

编辑：text-localization, identity-preserve, precise-object-edit, lighting-weather, background-extraction, style-transfer, compositing, sketch-to-render。
