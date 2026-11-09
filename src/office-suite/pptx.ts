import JSZip from "jszip";
import { isMacroPart, xmlEscape } from "./xml.js";

export type PptxChart = {
  type?: "bar" | "line" | "pie";
  categories: string[];
  series: { name: string; values: number[] }[];
};

export type PptxSlide = {
  title: string;
  bullets?: string[];
  imagePngBase64?: string;
  chart?: PptxChart;
};

export type PptxSpec = {
  slides: PptxSlide[];
};

export type PptxEdit = {
  slideIndex: number;
  title?: string;
  bullets?: string[];
};

export type PptxRead = {
  slides: { title: string; bullets: string[] }[];
  charts: number;
  images: number;
  macrosPresent: boolean;
};

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";

const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;

export async function buildPptx(spec: PptxSpec): Promise<Buffer> {
  const zip = new JSZip();
  const slideOverrides: string[] = [];
  const rels: string[] = [];
  spec.slides.forEach((slide, index) => {
    const n = index + 1;
    const image = slide.imagePngBase64 ? Buffer.from(slide.imagePngBase64, "base64") : null;
    const chart = slide.chart && slide.chart.series.length > 0 ? slide.chart : null;
    if (image && image.length > 0) {
      zip.file(`ppt/media/image${n}.png`, image);
    }
    if (chart) {
      zip.file(`ppt/charts/chart${n}.xml`, chartXml(chart));
    }
    zip.file(
      `ppt/slides/slide${n}.xml`,
      slideXml(slide, { image: Boolean(image?.length), chart: Boolean(chart) }),
    );
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      slideRels(n, { image: Boolean(image?.length), chart: Boolean(chart) }),
    );
    slideOverrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
    rels.push(
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`,
    );
  });
  spec.slides.forEach((slide, index) => {
    if (!slide.chart) {
      return;
    }
    slideOverrides.push(
      `<Override PartName="/ppt/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    );
  });
  zip.file("ppt/presentation.xml", presentationXml(spec.slides.length));
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${slideOverrides.join("")}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function readPptx(buffer: Buffer): Promise<PptxRead> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: PptxRead["slides"] = [];
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .toSorted((a, b) => slideNumber(a) - slideNumber(b));
  for (const name of names) {
    const xml = await zip.file(name)?.async("string");
    slides.push(readSlide(xml ?? ""));
  }
  const charts = Object.keys(zip.files).filter((name) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(name),
  ).length;
  const images = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/")).length;
  return {
    slides,
    charts,
    images,
    macrosPresent: Object.keys(zip.files).some((name) => isMacroPart(name)),
  };
}

export async function editPptx(buffer: Buffer, edit: PptxEdit): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    if (isMacroPart(name)) {
      zip.remove(name);
    }
  }
  const slideName = `ppt/slides/slide${edit.slideIndex + 1}.xml`;
  const xml = await zip.file(slideName)?.async("string");
  if (!xml) {
    throw new Error(`slide ${edit.slideIndex + 1} does not exist`);
  }
  zip.file(slideName, rewriteSlideText(xml, edit));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function slideHashes(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const { createHash } = await import("node:crypto");
  const hashes: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      continue;
    }
    const bytes = await zip.file(name)?.async("nodebuffer");
    if (bytes) {
      hashes[name] = createHash("sha256").update(bytes).digest("hex");
    }
  }
  return hashes;
}

function presentationXml(count: number): string {
  const ids = Array.from(
    { length: count },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="${P}" xmlns:r="${R}" xmlns:a="${A}">
<p:sldIdLst>${ids}</p:sldIdLst>
<p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}" type="screen16x9"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function slideXml(slide: PptxSlide, flags: { image: boolean; chart: boolean }): string {
  const shapes: string[] = [];
  shapes.push(textShape(2, "Title", slide.title, 457200, 240000, 11200000, 700000, 2800, true));
  const bullets = slide.bullets ?? [];
  const textWidth = flags.chart || flags.image ? 6200000 : 11200000;
  if (bullets.length > 0) {
    shapes.push(bulletShape(3, bullets, 457200, 1100000, textWidth, 5200000));
  }
  if (flags.image) {
    shapes.push(
      pictureShape(4, "rIdImage", flags.chart ? 7000000 : 7200000, 1200000, 4200000, 2400000),
    );
  }
  if (flags.chart) {
    const y = flags.image ? 3800000 : 1400000;
    shapes.push(chartFrame(5, "rIdChart", 7000000, y, 4600000, 2600000));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function textShape(
  id: number,
  name: string,
  text: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  size: number,
  bold: boolean,
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphRun(text, size, bold)}</p:txBody></p:sp>`;
}

function bulletShape(
  id: number,
  bullets: string[],
  x: number,
  y: number,
  cx: number,
  cy: number,
): string {
  const paragraphs = bullets.map((bullet) => paragraphRun(bullet, 1800, false)).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function paragraphRun(text: string, size: number, bold: boolean): string {
  const b = bold ? ` b="1"` : "";
  return `<a:p><a:r><a:rPr lang="zh-CN" sz="${size}"${b} dirty="0"><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r></a:p>`;
}

function pictureShape(
  id: number,
  rel: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function chartFrame(id: number, rel: string, x: number, y: number, cx: number, cy: number): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="${rel}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideRels(n: number, flags: { image: boolean; chart: boolean }): string {
  const rels: string[] = [];
  if (flags.image) {
    rels.push(
      `<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.png"/>`,
    );
  }
  if (flags.chart) {
    rels.push(
      `<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
}

function chartXml(chart: PptxChart): string {
  const series = chart.series
    .map((entry, index) => {
      const cats = chart.categories
        .map(
          (category, catIndex) =>
            `<c:pt idx="${catIndex}"><c:v>${xmlEscape(category)}</c:v></c:pt>`,
        )
        .join("");
      const vals = entry.values
        .map(
          (value, valueIndex) =>
            `<c:pt idx="${valueIndex}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`,
        )
        .join("");
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(entry.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="${chart.categories.length}"/>${cats}</c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${entry.values.length}"/>${vals}</c:numLit></c:val></c:ser>`;
    })
    .join("");
  const plot =
    chart.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/>${series}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`
      : chart.type === "pie"
        ? `<c:pieChart>${series}</c:pieChart>`
        : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}<c:axId val="1"/><c:axId val="2"/></c:barChart>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea>${plot}<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
}

function readSlide(xml: string): { title: string; bullets: string[] } {
  const title =
    /<p:cNvPr id="2" name="Title"\/>[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/.exec(xml)?.[1] ?? "";
  const body =
    /<p:cNvPr id="3" name="Body"\/>[\s\S]*?<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(xml)?.[1] ?? "";
  const bullets = [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) =>
    decode(match[1] ?? ""),
  );
  return { title: decode(title), bullets };
}

function rewriteSlideText(xml: string, edit: PptxEdit): string {
  let next = xml;
  if (edit.title !== undefined) {
    next = next.replace(
      /(<p:cNvPr id="2" name="Title"\/>[\s\S]*?<a:t>)([\s\S]*?)(<\/a:t>)/,
      `$1${xmlEscape(edit.title)}$3`,
    );
  }
  if (edit.bullets) {
    const body = edit.bullets.map((bullet) => paragraphRun(bullet, 1800, false)).join("");
    next = next.replace(
      /(<p:cNvPr id="3" name="Body"\/>[\s\S]*?<a:lstStyle\/>)([\s\S]*?)(<\/p:txBody>)/,
      `$1${body}$3`,
    );
  }
  return next;
}

function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}
