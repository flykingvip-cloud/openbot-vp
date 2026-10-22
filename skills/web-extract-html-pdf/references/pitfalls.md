# 已踩过的坑与处置

## 1. LibreOffice 残壳

- **现象**：macOS `/Applications/LibreOffice.app` 可能缺失或损坏，`soffice --convert-to pdf` 失败。
- **处置**：本技能**不依赖 LibreOffice**，一律走 Chrome headless 出 PDF。渲染前按 `references/environment.md` 探测 Chromium，不要探测 LibreOffice。

## 2. Chrome headless 挂起大约 120 秒（不退、不出文件）

- **现象**：`--headless=new --print-to-pdf` 卡到约 120 秒被超时杀掉，没有 `out.pdf`。日志反复出现 `Failed to connect to socket /run/dbus/system_bus_socket`。
- **根因**：`--print-to-pdf` 会等文档 load。页面里只要有一个 TCP 被丢弃的 http(s) 子资源（外链 CSS、CDN 字体、远程图），连接会重传到大约 120 秒。`--virtual-time-budget` 在 `--headless=new` 下不打断这次等待。dbus 那一行是沙箱没有 system bus 时的噪声：没有外链的最小 HTML 也会打出它，并且大约 10 秒就能写出 PDF。
- **处置**：只跑 `scripts/print-pdf.mjs`。它带 `--timeout`（默认 10 秒）和一次性 `--user-data-dir`；第一轮仍不退出时，再用 `--host-resolver-rules` 让远程子资源立即失败并写出带正文的 PDF。不要为这条日志给沙箱加 dbus。判据是**退出码 + `print-pdf: ok` + 出文件**。

## 3. `reportlab` + TTC 排中文

- **现象**：`TTFont(..., subfontIndex=…)` 索引易错，中文最易踩坑。
- **处置**：非必要不用 `reportlab`；走 HTML + Chrome 这条线。

## 4. `pdftotext` 分栏

- **现象**：双栏论文 `-layout` 会串行，左右栏文字交错。
- **处置**：分段多次提取再拼，或对单栏区域分别取字；不要相信 `-layout` 自动分栏。

## 5. 字体缺失

- **现象**：中文渲染成方框 / 豆腐块。
- **处置**：渲染机须有 `Noto Sans CJK SC`；字体栈兜底 `Songti SC` / `serif`。缺字体时按 `environment.md` 判据降级并提示用户。

## 6. 图占位转义地狱

- **现象**：直接把 SVG 拼进 HTML 字符串，引号 / `<` 转义错乱。
- **处置**：`figure` 模块先留 `<div id="figNcharts">`，渲染末尾用 `replace` 注入 SVG 字符串。

## 7. 页数与页码

- **现象**：交付后页数不符预期、图表跨页断裂。
- **处置**：交付前跑 `pdfinfo | grep Pages` 与 `pdftotext | grep -nE "图 ?[0-9]|表 ?[0-9]"`，确认页数合理、图表编号连续；`figure`/`table` 加 `break-inside:avoid`。

## 8. macOS 路径写死

- **现象**：原稿把 Chrome 路径写死为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，在 Linux 容器 / 其他机器直接失败。
- **处置**：改为**路径解析**（`environment.md` 第 2 节），按候选顺序取第一个可用者，绝不硬编码单机路径。
