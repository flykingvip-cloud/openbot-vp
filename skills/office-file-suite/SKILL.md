---
name: office-file-suite
description: >-
  当用户要创建、编辑、预览或导出 Word/DOCX、PPT/PPTX、Excel/XLSX/CSV 或 PDF 时使用本技能。
  通过 office_file 工具完成文件模式处理，不依赖桌面 Excel、Google Workspace 或屏幕共享。
  遇到「做 Word」「改 PPT」「表格公式」「导出 PDF」「套用模板」时使用。
  Excel 实时会话和 Google 文档未接入时必须明确说明，不能把生成的文件说成已经改了打开的桌面工作簿。
---

# office-file-suite（文件模式 Office）

这是 OpenBot 自己的文件引擎入口。不要调用 Codex artifact 工具，不要引用 `@oai/artifact-tool`，也不要把专有技能包里的脚本路径当成可执行文件。

## 工具

使用 `office_file`。身份由会话注入，不要在参数里填写租户或用户 id。

| action                                             | 用途                                                          |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `create`                                           | 按 `specJson` 生成 docx / pptx / xlsx / pdf                   |
| `import`                                           | 保存上传原件                                                  |
| `edit`                                             | 对已有 `artifactId` 写新版本                                  |
| `read`                                             | 读取结构、公式结果、批注                                      |
| `preview` / `validate`                             | 文本预览；`render:true` 时在装有 LibreOffice 的环境做像素预览 |
| `export`                                           | 复制出可下载版本                                              |
| `template_save` / `template_list` / `template_use` | 个人、租户、平台模板                                          |
| `capability` / `connector_status` / `excel_live`   | 能力与连接器状态                                              |

原始文件保留。失败不覆盖原件。宏只标记并在新版本中剥离，从不执行。

## 规格

- Word：`{"blocks":[{"type":"paragraph","text":"...","style":"title"},{"type":"table","headers":[],"rows":[[]]}]}`
- Word 局部编辑：`{"paragraphIndex":1,"text":"...","tracked":true,"comment":"..."}`
- PPT：`{"slides":[{"title":"...","bullets":[],"imagePngBase64":"...","chart":{"categories":[],"series":[{"name":"","values":[]}]}}]}`
- PPT 局部编辑：`{"slideIndex":1,"title":"...","bullets":[]}`
- 表格：`sheets`、`formulas`、`chart`，或 `csv`
- 表格修改：`{"sheet":"预算","cells":[{"cell":"B2","value":4}]}`
- PDF：`{"title":"...","pages":[{"paragraphs":[]}],"formFields":[{"name":"","value":""}]}`

公式引擎支持算术、比较，以及 SUM、AVERAGE、MIN、MAX、COUNT、IF、ROUND、ABS、AND、OR、NOT、PRODUCT、INT。不要把这说成完整 Excel 兼容。

## 连接器

`excel_live` 和 Google Workspace 在没有真实连接器时返回 `未接入`。文件生成成功不等于桌面应用已被修改。

## 参考

- `references/capability-matrix.md`
- `references/openbot-delivery.md`
