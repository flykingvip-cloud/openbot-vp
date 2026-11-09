# Office file suite

File-mode create, edit, preview, and export for DOCX, PPTX, XLSX, and PDF. It is available to signed-in tenant members and individual users through the `office_file` tool. It does not drive desktop Excel, PowerPoint, Word, or Google Workspace.

## License and delta

The OpenAI Office skill snapshot (version 26.1104.12130) was a capability checklist only. Its `skills/documents/LICENSE.txt` is proprietary. Nothing from that package is copied into this repository: no SKILL.md, scripts, container tools, artifact tool docs, assets, or examples.

| Referenced capability                                           | What shipped                                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| documents DOCX create, edit, comments, tracked changes, preview | Clean-room OOXML in `src/office-suite/docx.ts`, using `jszip` and the existing mammoth preview                                                                   |
| presentations PPTX                                              | Clean-room OOXML in `src/office-suite/pptx.ts`. `@oai/artifact-tool` is not used                                                                                 |
| spreadsheets formulas, charts, CSV                              | Clean-room XLSX plus a bounded formula engine. ExcelJS is not added                                                                                              |
| pdf Chinese text, forms, pages                                  | Clean-room PDF writer with an optional system CJK font. pdf.js extraction is not required for the engine's own reader                                            |
| template creator                                                | Scoped template store with personal, tenant, and platform checks                                                                                                 |
| excel-live-control                                              | Not implemented. Status stays 未接入                                                                                                                             |
| Google Docs / Sheets / Slides                                   | Not implemented. Status stays 未接入                                                                                                                             |
| LibreOffice render                                              | Optional. The existing `Dockerfile.pptx-renderer` already installs LibreOffice for PPTX. This suite uses `soffice` only when it is on PATH, with macros disabled |

Existing instruction skills (`documents`, `pptx`, `cyber-ppt`, `spreadsheets`, `nano-pdf`, `office-automation-core`) stay in place and point at `office_file`.

## Capability matrix

| Item                                                   | Status                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Word create / partial edit                             | 已验证                                                                                                        |
| Word tracked changes and comments                      | 已验证                                                                                                        |
| Word layout preview                                    | 有限支持 without LibreOffice; 已验证 when `soffice` and `pdftoppm` render more than one page                  |
| PPT create / edit while preserving other slides        | 已验证                                                                                                        |
| PPT images and charts                                  | 已验证                                                                                                        |
| Spreadsheet create, CSV import, number formats, charts | 已验证                                                                                                        |
| Formula recalculation                                  | 有限支持 (arithmetic, comparisons, SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS, AND, OR, NOT, PRODUCT, INT) |
| PDF Chinese text, extract, form, pagination            | 已验证 when a CJK `.ttf`/`.otf` is installed; otherwise 有限支持                                              |
| Templates and tenant / user isolation                  | 已验证 by automated fixtures                                                                                  |
| Excel live control                                     | 未接入                                                                                                        |
| Google Workspace                                       | 未接入                                                                                                        |

Two live tenant accounts plus a production individual user were not available in this environment. Isolation is covered by an automated fixture with tenant A, tenant B, and one individual user.

## Install and operations

No new npm dependency. The engine uses `jszip` and `mammoth`, which are already dependencies.

Optional packages on the gateway host:

```bash
sudo apt-get install -y poppler-utils libreoffice-writer libreoffice-impress libreoffice-calc fonts-noto-cjk
```

`fonts-droid-fallback` also supplies a usable CJK TrueType font. Set `OPENBOT_OFFICE_CJK_FONT` to a `.ttf` or `.otf` path when the default locations are not present. TrueType collections (`.ttc`) are not embedded.

Files land under the agent workspace at `output/office-suite/`:

- `tenant/<tenant>/user/<user>/` for enterprise members
- `individual/<user>/` for users without a tenant

Limits: 20 MB input and output, 30 seconds, caps on rows, slides, and PDF pages. Paths cannot escape that user's directory. Macros are stored on the original upload and stripped from derived versions. They are never executed.

Logs record action, status, byte size, and error code only.

Tenant template writes require the trusted `tenantAdmin` flag. Platform template writes require `platformAdmin`. The agent tool does not accept those flags from model arguments. Personal templates work for every signed-in user.

## Upgrade and rollback

There is no database migration. Removing the `office_file` registration stops new calls. Files already written under `output/office-suite/` remain on disk until an operator deletes that directory. Rolling back the commit restores the previous tool list and leaves those files unread by the product.

## Verification

Automated coverage lives in `src/office-suite/office-suite.acceptance.test.ts`. It builds a Chinese multi-page Word table, checks mammoth HTML, edits one paragraph with tracked changes and a comment, proves the original hash is unchanged after a failed edit, edits one PPTX slide without changing another, recalculates `B2*C2+SUM(B2:C2)` from 11.00 to 19.00, checks percent formatting and the chart cache, extracts a two-page Chinese PDF form, and denies cross-tenant and cross-user reads.

On a host with LibreOffice, Poppler, and Droid Sans Fallback, headless rendering showed:

- The Word table paginates to 2 pages. Chinese glyphs are present. The long description wraps inside the cell instead of running off the page. The header row is marked to repeat; page 2 in this render starts at row 27 without a repeated header, which is limited support for header repetition.
- The PPT title, bullets, axis labels, and bar chart render on the slide. 华北 is taller than 华南, matching values 12 and 9. Text is not clipped.
- The PDF shows two pages of Chinese, including the form value 姓名：张三. The AcroForm field is also present for extraction. Widget chrome is plain text plus the field dictionary.

No second live tenant account or production individual login was available. The isolation test uses two tenant principals and one individual principal in a temporary directory.
