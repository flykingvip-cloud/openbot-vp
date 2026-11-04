// Fixed local renderer worker. Stdin is document data, never executable instructions.
import {
  renderPptxStaticSlidesHtml,
  PPTX_RENDER_LIMITS,
} from "../../src/gateway/office-pptx-render.ts";
let size = 0;
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  const bytes = Buffer.from(chunk);
  size += bytes.length;
  if (size > PPTX_RENDER_LIMITS.inputBytes) {
    process.exit(1);
  }
  chunks.push(bytes);
}
const expectedPages = Number(process.argv[2]);
if (
  !Number.isSafeInteger(expectedPages) ||
  expectedPages < 1 ||
  expectedPages > PPTX_RENDER_LIMITS.pages
) {
  process.exit(1);
}
const html = await renderPptxStaticSlidesHtml(Buffer.concat(chunks), "PPTX", { expectedPages });
if (!html) {
  process.exit(1);
}
process.stdout.write(html);
