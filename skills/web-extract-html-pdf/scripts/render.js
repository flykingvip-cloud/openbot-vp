// scripts/render.js — 内容模块渲染器 + 内联 SVG + 全局 CSS
// 配合 references/pipeline.md 使用。零依赖，Node 直接 require/import 本文件即可。
//
// 用法：
//   const { GLOBAL_CSS, render, inline, lineChart } = require("./render.js");
//   const html = page(PART_A.jsonList, { title: "…" });

/** 全局 CSS —— A4 中文排版主题。 */
const GLOBAL_CSS = `
@page { size: A4; margin: 19mm 20mm 17mm 20mm; }
:root { --accent:#1a3d6d; --ink:#1c1c1e; --muted:#6b7280; --line:#d7dbe2; --box:#f4f6fa; }
* { box-sizing: border-box; }
body { font-family:"Noto Sans CJK SC","Songti SC",serif;
       font-size:10.4pt; line-height:1.75; text-align:justify; color:var(--ink); margin:0; }
h1 { font-size:17pt; margin:0 0 10pt; border-bottom:2px solid var(--accent); padding-bottom:4pt; }
h2 { font-size:13.5pt; margin:16pt 0 8pt; color:var(--accent); }
h3 { font-size:11.5pt; margin:12pt 0 6pt; }
h1,h2,h3 { page-break-after:avoid; break-after:avoid; }
p  { margin:0 0 8pt; }
ul { margin:0 0 8pt; padding-left:1.4em; }
li { margin:2pt 0; }
b  { font-weight:700; }
code { font-family:"Noto Sans Mono CJK SC",monospace; font-size:9.6pt;
       background:#eef1f6; padding:0 3px; border-radius:3px; }
.cover { text-align:center; padding-top:60mm; }
.cover h1 { border:none; font-size:26pt; }
.caption { font-size:9.4pt; color:var(--muted); text-align:center; margin:4pt 0 12pt; }
.box { background:var(--box); border-left:3px solid var(--accent);
       padding:8pt 10pt; margin:8pt 0; font-size:9.8pt; color:#333; }
table { border-collapse:collapse; width:100%; margin:4pt 0 12pt; font-size:9.8pt; }
th,td { border:1px solid var(--line); padding:4pt 6pt; }
thead th { background:var(--box); font-weight:700; }
figure, table { break-inside:avoid; page-break-inside:avoid; }
.figwrap { text-align:center; margin:6pt 0; }
.pagebreak { break-after:page; page-break-after:always; }
`;

/** 行内语法：**bold** 与 `code`，其余 HTML 转义。 */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

/** 内容模块 → HTML 片段。 */
function render(list) {
  return list
    .map((m) => {
      switch (m.type) {
        case "h1":
          return `<h1>${inline(m.text)}</h1>`;
        case "h2":
          return `<h2>${inline(m.text)}</h2>`;
        case "h3":
          return `<h3>${inline(m.text)}</h3>`;
        case "p":
          return `<p>${inline(m.text)}</p>`;
        case "bullets":
          return `<ul>${m.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
        case "caption":
          return `<div class="caption">${inline(m.text)}</div>`;
        case "box":
          return `<div class="box">${inline(m.text)}</div>`;
        case "table":
          return m.html; // 已含 <table>…</table>
        case "figure":
          return `<div class="figwrap">${m.html}</div>`; // 占位 div，渲染后注入 SVG
        case "pagebreak":
          return `<div class="pagebreak"></div>`;
        default:
          throw new Error(`unknown module type: ${m.type}`);
      }
    })
    .join("\n");
}

/** 折线图 → 内联 SVG 字符串。series: [{name,color,points:[y,...]}] */
function lineChart({
  xs,
  series,
  ymin,
  ymax,
  w = 460,
  h = 200,
  yticks = 4,
  yfmt = (v) => String(v),
}) {
  const padL = 44,
    padR = 12,
    padT = 12,
    padB = 26;
  const iw = w - padL - padR,
    ih = h - padT - padB;
  const y0 = ymax,
    y1 = ymin;
  const sx = (i) => padL + (xs.length <= 1 ? 0 : (iw * i) / (xs.length - 1));
  const sy = (v) => padT + ih - ((v - y1) / (y0 - y1 || 1)) * ih;
  const parts = [];
  for (let t = 0; t <= yticks; t++) {
    const v = y1 + ((y0 - y1) * t) / yticks;
    const yy = sy(v);
    parts.push(
      `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" stroke="#e5e8ee"/>`,
    );
    parts.push(
      `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#6b7280">${yfmt(v)}</text>`,
    );
  }
  xs.forEach((x, i) => {
    parts.push(
      `<text x="${sx(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#6b7280">${escapeHtml(x)}</text>`,
    );
  });
  series.forEach((s) => {
    const d = s.points
      .map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
      .join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${s.color || "#1a3d6d"}" stroke-width="1.8"/>`);
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">${parts.join("")}</svg>`;
}

/** 组装完整 HTML 页面。figures: {fig3charts: "<svg>…</svg>"} 按 id 注入。 */
function page(modules, { title = "", figures = {} } = {}) {
  let body = render(modules);
  for (const [id, svg] of Object.entries(figures)) {
    body = body.replace(new RegExp(`<div id="${id}"[^>]*></div>`), svg);
  }
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${GLOBAL_CSS}</style></head>
<body>${body}</body></html>`;
}

module.exports = { GLOBAL_CSS, inline, render, lineChart, page };
