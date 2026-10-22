---
name: web-extract-html-pdf
description: >-
  把网页或给定文本重排成排版精良的 PDF 交付物。当用户要求「把这篇论文/网页翻译排版成 PDF」「网页正文提取后出一份版式好看的 PDF」
  「按章节层级重排并中文化图表」「导出一份可打印的 A4 PDF」时使用。核心流程：先用 web_fetch / pdftotext 拿到纯文字，
  再由模型重建章节层级、重绘 SVG 图、中文化表格，用 HTML+CSS 排版，最后用 Chrome headless 打印成 PDF。
  不要用于原始版式 1:1 还原或纯文字 .txt 导出。
version: 1.1.0
license: 仅供内部使用
metadata:
  openbot:
    category: document-delivery
    source: 用户提供的《web-extract-html-pdf》(2026-10-04)，按 OpenBot 运行时能力面校验后入库
---

# 网页/文本 → 精排 PDF

## 一句话

**字从原文来，版从 HTML 来。** 提取只负责拿到「文字」；版式、章节层级、图、表全部在 HTML 里重建。永不试图还原原文版式，也不要指望 `pdftotext` 保留排版。

## 适用场景

- 用户要抓一篇论文 / 长文 / 报告，翻译或整理后输出一份好看的 PDF。
- 素材来源：网页（`web_fetch` / 正文提取）、已有 PDF（`pdftotext`）、用户粘贴的文本。
- 目标：章节层级清楚、有封面、图表居中、表格中文化、A4 可直接打印或分发。

**不要用于**：需要 1:1 复刻原始版式的场景（应走还原类 PDF 技能）；只要纯文字 `.txt` 导出。

## 硬约束（先看这条）

- **数据不臆造**：表格数值必须逐格核对原文，不确定的留原文并标注；禁止用常识补数或改写结论。
- **本技能不跑 LibreOffice**：转换一律走 Chrome headless，不依赖 `/Applications/LibreOffice.app`（该残壳在渲染机上可能缺失）。
- **交付物只进 `output/pdf/`**：项目子目录 `tmp/` 只是工作副本，不进版本库；交付 PDF 进版本库。
- **图表重绘，不截图**：不嵌原图截图（糊、版权、字体不匹配），一律按数据重画 SVG 或 HTML 结构图。

## 六道工序（按序执行，不要跳步）

### 1. 取原文（只取字）

- 网页：用 `web_fetch` 取正文 → 得到 markdown / 纯文字。拿不到正文再考虑正文提取类工具或 `browser`。
- PDF：`pdftotext -layout in.pdf -` 拿骨架文字。**`-layout` 只是为了读顺序，不保留版式，不要指望缩进 / 分栏。**
- 关键：登记图表清单——正文里每出现「图 1 / 图 2 / 表 1 …」都要记下，后面逐个重建。

### 2. 搭内容骨架（模型干活）

把正文切成结构化内容模块，**不要写成一坨 HTML**。每一节是一个带 `type` 的对象：

```js
// content_a.js —— 封面到第 3 节
const PART_A = [
  { type: "h1", text: "1 引言" },
  { type: "p", text: "……**加粗**……`代码`……" },
  { type: "bullets", items: ["…", "…"] },
  { type: "caption", text: "图 1：……" },
  { type: "table", html: `<table>…</table>` },
  { type: "figure", html: `<div id="fig3charts" ...></div>` }, // 占位，渲染时注入 SVG
  { type: "box", text: "译者说明……" },
  { type: "pagebreak" },
];
```

模块按体量拆 `content_a/b/c.js`。渲染器 `render(list)` 按 `type` 分派 tag，见 `scripts/render.js`。行内语法只保留 `**bold**` 和 `` `code` ``，由 `inline()` 转 `<b>/<code>`。

### 3. 重绘图（SVG，不截图）

- 折线 / 柱状：`scripts/render.js` 里的 `lineChart({xs, series, ymin, ymax, w, h, yticks, yfmt})` 生成内联 `<svg>`。
- 流程 / 结构图：直接用 HTML+CSS（grid / flexbox + 边框）画，比 SVG 更好维护。
- 图题用 `caption` 模块，标注「（重绘）」。

### 4. 表格中文化

沿原文表格数值，表头 / 表意译为中文，用 `type:"table"` 注入 `<table>`（`thead`+`tbody`）。数值必须逐格核对（见硬约束）。

### 5. HTML 排版（一套 CSS 管全局）

- 字体栈：`"Noto Sans CJK SC","Songti SC",serif`；正文 10.4pt、行高 1.75、`text-align:justify`。
- A4：`@page{size:A4;margin:19mm 20mm 17mm 20mm;}`。
- 分页：显式 `pagebreak` 模块；标题用 `page-break-after:avoid` 防孤行。
- 用 CSS 变量定主题色（如 `--accent`），封面 / 表格 / 引用块各自成 class。
- 完整可复用 CSS 见 `scripts/render.js` 顶部。

### 6. 渲染 PDF（只走打印助手）

不要手写 `chromium --headless=new --print-to-pdf`。用本技能自带的助手（它会解析 `/usr/bin/chromium`，必要时才回退到 Playwright 的 `.pw-browsers` / `ms-playwright` 缓存）：

```bash
node skills/web-extract-html-pdf/scripts/print-pdf.mjs \
  --html "$WORK/page.html" \
  --out "$WORK/out.pdf"
```

助手固定带上沙箱里已经打通过的 `--headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage`，并加上 `--timeout`（默认 10 秒）和一次性 `--user-data-dir`。`--virtual-time-budget` **不能**拦住 `--headless=new` 里卡住的子资源，不要再加。

- 页面里只要有一个 TCP 被丢弃的 http(s) 子资源（外链 CSS、CDN 字体、远程图片），裸的 `--print-to-pdf` 会一直等到 TCP 重传结束，大约 **120 秒**，然后被 exec 杀掉，且没有 PDF。
- 这 120 秒里日志会反复刷 `Failed to connect to socket /run/dbus/system_bus_socket`。沙箱镜像本来就没有 system bus。同一条日志在**没有外链的最小 HTML** 上也会出现，而那次打印大约 10 秒就成功。dbus 不是失败原因，不要为此去改镜像或加 dbus。
- 若当前 Chromium 不认 `--timeout`、进程仍不退出，助手会再用 `--host-resolver-rules` 重试一次：远程子资源立即失败，正文仍打进 PDF（可选中文字还在；外链图片可能缺）。
- 判据是助手退出码 + `print-pdf: ok` + 出文件，不是 stderr 里的 dbus 行。
- 渲染完把交付物放**规范预览路径**：`output/pdf/<文件名>.pdf`（项目子目录只是工作副本）。

## 质检（交付前必做）

```bash
pdfinfo out.pdf | grep Pages                       # 页数符合预期
pdftotext out.pdf - | grep -nE "图 ?[0-9]|表 ?[0-9]"  # 图表编号连续无丢
```

再抽查 1–2 页渲染：`pdftoppm -png -r 110 -f N -l N out.pdf chk` 后看图确认无溢出 / 叠字 / 表断页。

## 目录约定

```
tmp/<task>/           # 工作副本：content_*.js、render.js、中间 html、抽查 png
output/pdf/<name>.pdf # 唯一交付物（预览路径）
```

`tmp/` 不进版本库；交付物进版本库。

## 环境前置（渲染机需自备，缺一即降级）

| 依赖                                            | 用途                    | 缺失时                                                                  |
| ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| 可执行 Chromium / Chrome                        | `--print-to-pdf` 出 PDF | **核心前置**，缺失则本技能不可用；先按 `references/environment.md` 探测 |
| `Noto Sans CJK SC` 字体                         | 中文渲染                | 降级字体栈 `Songti SC` / `serif`，并提示用户                            |
| `pdftotext` / `pdfinfo` / `pdftoppm`（poppler） | 取字 / 质检             | 缺取字则改用 `web_fetch`；缺质检工具则人工抽查页数                      |
| 本机 LibreOffice                                | —                       | **不依赖**，本技能不使用                                                |

> 渲染前先按 `references/environment.md` 的探测清单确认 Chromium 与中文字体可用，再进入第 6 道工序。

## 不要做的事

- 不要试图还原原文版式（本技能是重排，不是还原）。
- 不要用原图截图充当重绘图。
- 不要用 `reportlab` + TTC 走这条线（`TTFont(subfontIndex=…)` 易错，中文最易踩坑）。
- 不要手写 Chromium 参数，也不要因为 dbus 日志去改沙箱镜像。渲染只调用 `scripts/print-pdf.mjs`。
- 不要臆造或补全表格数值与图表数据。

## 输入（每次不同）

- `{source}`：素材来源（URL / PDF 路径 / 粘贴文本）
- `{target}`：目标 PDF 文件名与语言（原文 / 译中文）
- `{charts}`：需重绘的图表清单（可留空，由第 1 步生成）

## 参考文件

- `references/environment.md` —— 渲染机依赖探测与 Chromium 路径解析（本技能可否运行的前提）
- `references/pipeline.md` —— 六道工序的执行细则、HTML/CSS 模板与代码约定
- `references/pitfalls.md` —— 已踩过的坑与处置

## 脚本

- `scripts/render.js` —— 内容模块渲染器 + 内联 SVG `lineChart()` + 全局 CSS（供第 2–5 步引用）
- `scripts/print-pdf.mjs` —— 第 6 步唯一打印入口（`--timeout` + 一次性 profile；dbus 缺失时仍出 PDF）
