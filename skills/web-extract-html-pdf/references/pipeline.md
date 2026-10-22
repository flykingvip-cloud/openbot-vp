# 六道工序执行细则

配合 SKILL.md 使用。所有代码与 `scripts/render.js` 保持同一套约定。

## 1. 取原文

- 网页：`web_fetch` 取正文得到 markdown / 纯文字。`readability` 提取不全时，用 `browser` 打开页面抓结构快照，再按正文容器取文本。
- PDF：`pdftotext -layout in.pdf -`。**`-layout` 只保证阅读顺序，不保留版式**——不要解析缩进 / 分栏来推断结构。
- 双栏论文会串行：宁可分段多次提取再拼，也不要相信 `-layout` 自动分栏。
- 登记图表清单：扫描全文 `图 ?[0-9]`、`表 ?[0-9]`、`Figure`、`Table`，生成待重建列表，编号必须连续。

## 2. 内容骨架

模块类型与渲染分派（`scripts/render.js` 的 `render()`）：

| type           | 产出                         | 备注                                              |
| -------------- | ---------------------------- | ------------------------------------------------- |
| `h1`/`h2`/`h3` | 标题                         | 用 `page-break-after:avoid` 防孤行                |
| `p`            | 段落                         | 行内 `**bold**` / `` `code` `` 经 `inline()` 转义 |
| `bullets`      | `<ul>`                       | `items` 为字符串数组                              |
| `caption`      | 图 / 表题                    | 重绘图加「（重绘）」                              |
| `table`        | `<table>`                    | 直接注入 HTML，`thead`+`tbody`                    |
| `figure`       | 占位 `<div id="figNcharts">` | 渲染末尾注入 SVG                                  |
| `box`          | 译者说明 / 引用块            |                                                   |
| `pagebreak`    | 显式分页                     |                                                   |

按体量拆 `content_a/b/c.js`，避免单文件过大。

## 3. 重绘 SVG

```js
// scripts/render.js 导出
lineChart({ xs, series, ymin, ymax, w, h, yticks, yfmt }); // → 内联 <svg> 字符串
```

- 折线 / 柱状走 `lineChart`；流程 / 结构图用 HTML+CSS（grid/flex + 边框）画。
- `figure` 模块先留 `<div id="figNcharts">`，渲染末尾用**字符串 replace** 注入 SVG，避免模板转义地狱。
- 图题用 `caption` 标注「（重绘）」，不嵌原图截图。

## 4. 表格中文化

- 沿原文数值，表头 / 表意译中文，`type:"table"` 注入 `<table>`。
- **数值逐格核对**：对照原文 source 复核每个单元格；不确定的保留原文并在表下标注「原文如此 / 待核」。
- 禁止用常识补数、改结论、编造缺失行。

## 5. HTML / CSS 排版

全局 CSS（详见 `scripts/render.js` 顶部）：

```css
@page {
  size: A4;
  margin: 19mm 20mm 17mm 20mm;
}
:root {
  --accent: #1a3d6d;
  --ink: #1c1c1e;
  --muted: #6b7280;
}
body {
  font-family: "Noto Sans CJK SC", "Songti SC", serif;
  font-size: 10.4pt;
  line-height: 1.75;
  text-align: justify;
  color: var(--ink);
}
h1,
h2,
h3 {
  page-break-after: avoid;
  color: var(--accent);
}
table {
  border-collapse: collapse;
  width: 100%;
}
figure,
table {
  break-inside: avoid;
}
```

- 封面、表格、引用块各自成 class；主题色用 CSS 变量。
- 分页靠显式 `pagebreak` 模块，不靠浏览器自动分页。

## 6. 渲染 PDF

见 `references/environment.md` 第 4 节。只运行 `scripts/print-pdf.mjs`，不要手写 `--print-to-pdf`。渲染后：

```bash
cp tmp/<task>/out.pdf output/pdf/<name>.pdf
```

`output/pdf/` 是唯一交付物路径（预览路径）；`tmp/` 只是工作副本。
