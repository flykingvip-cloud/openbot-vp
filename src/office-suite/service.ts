import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  excelLiveStatus,
  googleWorkspaceStatus,
  type ExcelLiveProbe,
  type GoogleWorkspaceProbe,
} from "./connectors.js";
import {
  buildDocx,
  editDocx,
  estimateDocxPages,
  readDocx,
  type DocxEdit,
  type DocxSpec,
} from "./docx.js";
import { buildPdf, extractPdf, type PdfSpec } from "./pdf.js";
import { buildPptx, editPptx, readPptx, type PptxEdit, type PptxSpec } from "./pptx.js";
import { commandExists, previewHtml, renderOfficeToPngs } from "./preview.js";
import {
  assertBytes,
  assertPrincipal,
  OFFICE_LIMITS,
  OfficeSuiteError,
  resolveInside,
  safeLog,
  sanitizeId,
  scopeKey,
  sha256,
  writeAtomic,
  type OfficeLogEvent,
  type OfficePrincipal,
} from "./scope.js";
import { loadTtf, resolveCjkFontPath, type ParsedTtf } from "./ttf.js";
import { buildXlsx, editXlsx, readXlsx, type XlsxEdit, type XlsxSpec } from "./xlsx.js";

export type OfficeKind = "docx" | "pptx" | "xlsx" | "pdf";
export type TemplateScope = "personal" | "tenant" | "platform";

export type OfficeRequest = {
  action:
    | "capability"
    | "connector_status"
    | "import"
    | "create"
    | "edit"
    | "read"
    | "preview"
    | "validate"
    | "export"
    | "template_save"
    | "template_list"
    | "template_use"
    | "excel_live"
    | "task_status";
  kind?: OfficeKind | "excel-live";
  filename?: string;
  bytes?: Buffer;
  spec?: unknown;
  artifactId?: string;
  templateId?: string;
  taskId?: string;
  name?: string;
  scope?: TemplateScope;
  render?: boolean;
  liveOp?: "read" | "edit";
};

export type OfficeResult = {
  ok: boolean;
  action: string;
  status: "succeeded" | "failed" | "未接入";
  message: string;
  errorCode?: string;
  taskId?: string;
  artifactId?: string;
  filename?: string;
  relativePath?: string;
  previewPath?: string;
  recoverable?: string;
  details?: Record<string, unknown>;
};

type ArtifactMeta = {
  id: string;
  kind: OfficeKind;
  role: "original" | "version";
  filename: string;
  ownerTenantId: string | null;
  ownerUserId: string;
  bytes: number;
  sha256: string;
  parentId?: string;
  macrosPresent?: boolean;
  createdAt: string;
};

type TemplateMeta = {
  id: string;
  name: string;
  scope: TemplateScope;
  kind: OfficeKind;
  ownerTenantId: string | null;
  ownerUserId: string;
  spec: unknown;
  version: number;
  supersedes?: string;
  createdAt: string;
};

type TaskMeta = {
  id: string;
  action: string;
  kind?: string;
  status: "succeeded" | "failed" | "未接入";
  artifactId?: string;
  errorCode?: string;
  bytes?: number;
  createdAt: string;
};

export type OfficeSuite = {
  execute(principal: OfficePrincipal, request: OfficeRequest): Promise<OfficeResult>;
};

export function createOfficeSuite(options: {
  rootDir: string;
  logger?: (event: OfficeLogEvent) => void;
  fontPath?: string;
  excelLive?: ExcelLiveProbe;
  googleWorkspace?: GoogleWorkspaceProbe;
  now?: () => Date;
}): OfficeSuite {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  const log = (event: OfficeLogEvent) => options.logger?.(safeLog(event));
  let font: ParsedTtf | null | undefined;

  const loadFont = () => {
    if (font !== undefined) {
      return font;
    }
    const fontPath = resolveCjkFontPath(options.fontPath);
    font = fontPath ? loadTtf(fontPath) : null;
    return font;
  };

  return {
    async execute(principal, request) {
      const started = Date.now();
      const scope = safeScope(principal);
      try {
        assertPrincipal(principal);
        const result = await dispatch(principal, request);
        log({
          scope,
          action: request.action,
          kind: request.kind,
          status: result.ok ? "ok" : "error",
          bytes: typeof result.details?.bytes === "number" ? result.details.bytes : undefined,
          errorCode: result.errorCode,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (error) {
        const coded =
          error instanceof OfficeSuiteError
            ? error
            : new OfficeSuiteError(
                "failed",
                error instanceof Error ? error.message : "office task failed",
              );
        const result = failure(request.action, coded);
        log({
          scope,
          action: request.action,
          kind: request.kind,
          status: "error",
          errorCode: coded.code,
          durationMs: Date.now() - started,
        });
        await recordTask(principal, {
          id: newId("task"),
          action: request.action,
          kind: request.kind,
          status: "failed",
          errorCode: coded.code,
          createdAt: now().toISOString(),
        }).catch(() => undefined);
        return result;
      }
    },
  };

  async function dispatch(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    switch (request.action) {
      case "capability":
        return ok(request.action, "能力矩阵", { matrix: await capabilityMatrix() });
      case "connector_status":
        return ok(request.action, "连接器状态", {
          connectors: [
            await excelLiveStatus(options.excelLive),
            await googleWorkspaceStatus(options.googleWorkspace),
          ],
        });
      case "excel_live":
        return excelLive(request);
      case "import":
        return saveImport(principal, request);
      case "create":
        return createFile(principal, request);
      case "edit":
        return editFile(principal, request);
      case "read":
        return readFile(principal, request);
      case "preview":
      case "validate":
        return previewFile(principal, request);
      case "export":
        return exportFile(principal, request);
      case "template_save":
        return saveTemplate(principal, request);
      case "template_list":
        return listTemplates(principal, request.scope);
      case "template_use":
        return useTemplate(principal, request);
      case "task_status":
        return taskStatus(principal, request.taskId);
      default:
        throw new OfficeSuiteError("action", "不支持的 Office 动作。");
    }
  }

  async function excelLive(request: OfficeRequest): Promise<OfficeResult> {
    const status = await excelLiveStatus(options.excelLive);
    if (
      status.status !== "已验证" ||
      !options.excelLive?.readWorkbook ||
      !options.excelLive.editWorkbook
    ) {
      return {
        ok: false,
        action: request.action,
        status: "未接入",
        message: status.reason,
        errorCode: "not-connected",
        recoverable:
          "使用文件模式的 create 或 edit 继续处理 xlsx。不要把文件生成当作已打开的 Excel。",
      };
    }
    if (request.liveOp === "edit") {
      const edited = await options.excelLive.editWorkbook();
      return ok(request.action, `已修改打开的工作簿：${edited.title}`, { connector: status });
    }
    const read = await options.excelLive.readWorkbook();
    return ok(request.action, `已读取打开的工作簿：${read.title}`, { connector: status });
  }

  async function saveImport(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const bytes = request.bytes;
    const filename = request.filename?.trim() || "upload.bin";
    if (!bytes) {
      throw new OfficeSuiteError("input", "缺少上传内容。请重新选择文件。");
    }
    assertBytes(bytes, OFFICE_LIMITS.maxInputBytes, "上传文件");
    const kind = kindFromName(filename);
    const read = await summarize(kind, bytes);
    const saved = await persist(principal, {
      kind,
      filename,
      bytes,
      role: "original",
      macrosPresent: Boolean(read.macrosPresent),
    });
    return done(principal, request.action, saved, "已保存原始文件，未覆盖任何旧版本。", {
      macrosPresent: Boolean(read.macrosPresent),
      macrosExecuted: false,
      summary: boundSummary(read.summary),
    });
  }

  async function createFile(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const kind = expectKind(request.kind);
    guardSpec(kind, request.spec);
    const built = await buildKind(kind, request.spec);
    const filename = `${fileStem(request.filename, kind)}.${kind}`;
    const saved = await persist(principal, { kind, filename, bytes: built.bytes, role: "version" });
    return done(principal, request.action, saved, "已生成新文件。", {
      bytes: built.bytes.length,
      missingGlyphs: built.missingGlyphs,
      summary: boundSummary((await summarize(kind, built.bytes)).summary),
    });
  }

  async function editFile(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const current = await loadOwned(principal, request.artifactId);
    const before = sha256(current.bytes);
    let nextBytes: Buffer;
    try {
      nextBytes = await editKind(current.meta.kind, current.bytes, request.spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : "edit failed";
      throw new OfficeSuiteError("edit", `局部编辑失败，原始文件未改动。${message}`);
    }
    if (sha256(current.bytes) !== before) {
      throw new OfficeSuiteError("edit", "编辑过程试图改写原始文件，已中止。");
    }
    assertBytes(nextBytes, OFFICE_LIMITS.maxOutputBytes, "编辑结果");
    const saved = await persist(principal, {
      kind: current.meta.kind,
      filename: versionName(current.meta.filename),
      bytes: nextBytes,
      role: "version",
      parentId: current.meta.id,
    });
    return done(principal, request.action, saved, "已写出新版本，原始文件保持不变。", {
      parentId: current.meta.id,
      originalSha256: before,
      bytes: nextBytes.length,
      summary: boundSummary((await summarize(current.meta.kind, nextBytes)).summary),
    });
  }

  async function readFile(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const current = await loadOwned(principal, request.artifactId);
    const read = await summarize(current.meta.kind, current.bytes);
    return ok(request.action, "已读取文件。", {
      artifactId: current.meta.id,
      kind: current.meta.kind,
      filename: current.meta.filename,
      macrosPresent: Boolean(read.macrosPresent),
      macrosExecuted: false,
      summary: boundSummary(read.summary),
    });
  }

  async function previewFile(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const current = await loadOwned(principal, request.artifactId);
    const read = await summarize(current.meta.kind, current.bytes);
    const html = previewHtml(current.meta.filename, [
      { heading: "文本", body: JSON.stringify(boundSummary(read.summary), null, 2) },
    ]);
    const previewFilePath = resolveInside(
      rootDir,
      scopeKey(principal),
      "previews",
      `${current.meta.id}.html`,
    );
    await writeAtomic(previewFilePath, Buffer.from(html, "utf8"));
    let render: Record<string, unknown> = { pixelPreview: "有限支持" };
    if (request.render) {
      const native = await renderOfficeToPngs(current.bytes, current.meta.kind);
      render = {
        pixelPreview: native.available ? "已验证" : "有限支持",
        pageCount: native.pageCount ?? null,
        nonWhiteRatio: native.nonWhiteRatio ?? null,
        reason: native.reason ?? null,
      };
    }
    return ok(request.action, "预览已生成。", {
      artifactId: current.meta.id,
      previewPath: path.relative(rootDir, previewFilePath),
      summary: boundSummary(read.summary),
      render,
    });
  }

  async function exportFile(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const current = await loadOwned(principal, request.artifactId);
    const exportPath = resolveInside(
      rootDir,
      scopeKey(principal),
      "exports",
      current.meta.filename,
    );
    await writeAtomic(exportPath, current.bytes);
    return ok(request.action, "可以下载该版本。原始文件未被替换。", {
      artifactId: current.meta.id,
      filename: current.meta.filename,
      relativePath: path.relative(rootDir, exportPath),
      bytes: current.bytes.length,
    });
  }

  async function saveTemplate(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const scope = request.scope ?? "personal";
    assertTemplateWrite(principal, scope);
    const name = request.name?.trim();
    if (!name) {
      throw new OfficeSuiteError("template", "模板需要名称。");
    }
    let kind = request.kind;
    let spec = request.spec;
    let source: Buffer | undefined;
    if (request.artifactId) {
      const current = await loadOwned(principal, request.artifactId);
      kind = current.meta.kind;
      source = current.bytes;
      spec = spec ?? (await summarize(current.meta.kind, current.bytes)).summary;
    }
    if (kind !== "docx" && kind !== "pptx" && kind !== "xlsx" && kind !== "pdf") {
      throw new OfficeSuiteError("template", "模板需要 docx、pptx、xlsx 或 pdf。");
    }
    const meta: TemplateMeta = {
      id: newId("tpl"),
      name,
      scope,
      kind,
      ownerTenantId: principal.tenantId,
      ownerUserId: principal.userId,
      spec,
      version: 1,
      createdAt: now().toISOString(),
    };
    await writeJson(templatePath(meta), meta);
    if (source) {
      await writeAtomic(templateBlob(meta), source);
    }
    return ok(request.action, "模板已保存为新版本。", {
      templateId: meta.id,
      scope,
      kind,
      name,
    });
  }

  async function listTemplates(
    principal: OfficePrincipal,
    scope: TemplateScope | undefined,
  ): Promise<OfficeResult> {
    const found = (await readTemplates()).filter((template) =>
      canReadTemplate(principal, template),
    );
    const filtered = scope ? found.filter((template) => template.scope === scope) : found;
    return ok("template_list", "模板列表", {
      templates: filtered.map((template) => ({
        id: template.id,
        name: template.name,
        scope: template.scope,
        kind: template.kind,
        version: template.version,
      })),
    });
  }

  async function useTemplate(
    principal: OfficePrincipal,
    request: OfficeRequest,
  ): Promise<OfficeResult> {
    const template = (await readTemplates()).find((entry) => entry.id === request.templateId);
    if (!template || !canReadTemplate(principal, template)) {
      throw new OfficeSuiteError("auth", "无权使用该模板。");
    }
    if (request.spec) {
      const created = await createFile(principal, {
        action: "create",
        kind: template.kind,
        spec: request.spec,
        filename: template.name,
      });
      return { ...created, message: `已按模板「${template.name}」的修改生成新文件。` };
    }
    try {
      const bytes = await fs.readFile(templateBlob(template));
      const saved = await persist(principal, {
        kind: template.kind,
        filename: `${template.name}.${template.kind}`,
        bytes,
        role: "version",
      });
      return done(principal, request.action, saved, `已按模板「${template.name}」复制出新文件。`, {
        templateId: template.id,
      });
    } catch {
      const created = await createFile(principal, {
        action: "create",
        kind: template.kind,
        spec: template.spec,
        filename: template.name,
      });
      return { ...created, message: `已按模板「${template.name}」生成新文件。` };
    }
  }

  async function taskStatus(
    principal: OfficePrincipal,
    taskId: string | undefined,
  ): Promise<OfficeResult> {
    const id = sanitizeId(taskId ?? "");
    if (!id) {
      throw new OfficeSuiteError("path", "任务编号无效。");
    }
    const file = resolveInside(rootDir, scopeKey(principal), "tasks", `${id}.json`);
    try {
      const task = JSON.parse(await fs.readFile(file, "utf8")) as TaskMeta;
      return ok("task_status", "任务状态", { task });
    } catch {
      throw new OfficeSuiteError("not-found", "没有找到该任务，或它属于其他用户。");
    }
  }

  async function capabilityMatrix(): Promise<Record<string, unknown>[]> {
    const soffice = await commandExists("soffice");
    const cjk = Boolean(loadFont());
    return [
      { item: "Word 创建与局部编辑", status: "已验证" },
      { item: "Word 修订与批注", status: "已验证" },
      {
        item: "Word 版式预览",
        status: soffice ? "已验证" : "有限支持",
        note: soffice ? "LibreOffice 渲染" : "HTML 与分页估计；像素渲染需要 LibreOffice",
      },
      { item: "PPT 创建与保留非目标页的编辑", status: "已验证" },
      { item: "PPT 图表与图片", status: "已验证" },
      {
        item: "PPT 分页像素预览",
        status: soffice ? "已验证" : "有限支持",
        note: soffice ? "LibreOffice 渲染" : "结构化分页预览",
      },
      { item: "表格创建、CSV 导入、数字格式、图表", status: "已验证" },
      {
        item: "表格公式重算",
        status: "有限支持",
        note: "支持算术、比较、SUM/AVERAGE/MIN/MAX/COUNT/IF/ROUND/ABS",
      },
      {
        item: "PDF 中文生成、抽取与表单",
        status: cjk ? "已验证" : "有限支持",
        note: cjk ? "嵌入系统 CJK 字体" : "缺少 CJK 字体时文字可抽取但字形可能缺失",
      },
      { item: "个人 / 租户 / 平台模板边界", status: "已验证" },
      { item: "租户与个人文件隔离", status: "已验证" },
      { item: "Excel 实时会话", status: "未接入" },
      { item: "Google Workspace", status: "未接入" },
    ];
  }

  async function buildKind(
    kind: OfficeKind,
    spec: unknown,
  ): Promise<{ bytes: Buffer; missingGlyphs: string[] }> {
    if (kind === "docx") {
      return { bytes: await buildDocx(asDocx(spec)), missingGlyphs: [] };
    }
    if (kind === "pptx") {
      return { bytes: await buildPptx(asPptx(spec)), missingGlyphs: [] };
    }
    if (kind === "xlsx") {
      return { bytes: await buildXlsx(asXlsx(spec)), missingGlyphs: [] };
    }
    const built = buildPdf(asPdf(spec), loadFont());
    return { bytes: built.bytes, missingGlyphs: built.missingGlyphs };
  }

  async function editKind(kind: OfficeKind, bytes: Buffer, spec: unknown): Promise<Buffer> {
    if (kind === "docx") {
      return editDocx(bytes, spec as DocxEdit);
    }
    if (kind === "pptx") {
      return editPptx(bytes, spec as PptxEdit);
    }
    if (kind === "xlsx") {
      return editXlsx(bytes, spec as XlsxEdit);
    }
    throw new OfficeSuiteError(
      "edit",
      "PDF 局部改页未接入像素编辑器。请基于原文重新 create，或只读取现有 PDF。",
    );
  }

  async function summarize(
    kind: OfficeKind,
    bytes: Buffer,
  ): Promise<{ summary: Record<string, unknown>; macrosPresent: boolean }> {
    if (kind === "docx") {
      const read = await readDocx(bytes);
      return {
        macrosPresent: read.macrosPresent,
        summary: {
          paragraphs: read.paragraphs,
          tables: read.tables,
          comments: read.comments,
          insertions: read.insertions,
          deletions: read.deletions,
          pageEstimate: estimateDocxPages({
            blocks: [
              ...read.paragraphs.map((text) => ({ type: "paragraph" as const, text })),
              ...read.tables.map((table) => ({
                type: "table" as const,
                headers: table[0] ?? [],
                rows: table.slice(1),
              })),
            ],
          }),
        },
      };
    }
    if (kind === "pptx") {
      const read = await readPptx(bytes);
      return { macrosPresent: read.macrosPresent, summary: { ...read } };
    }
    if (kind === "xlsx") {
      const read = await readXlsx(bytes);
      return { macrosPresent: read.macrosPresent, summary: { ...read } };
    }
    const extracted = extractPdf(bytes);
    return { macrosPresent: false, summary: { ...extracted, pageCount: extracted.pages.length } };
  }

  async function persist(
    principal: OfficePrincipal,
    input: {
      kind: OfficeKind;
      filename: string;
      bytes: Buffer;
      role: "original" | "version";
      parentId?: string;
      macrosPresent?: boolean;
    },
  ): Promise<ArtifactMeta> {
    assertBytes(input.bytes, OFFICE_LIMITS.maxOutputBytes, "输出文件");
    const meta: ArtifactMeta = {
      id: newId("file"),
      kind: input.kind,
      role: input.role,
      filename: safeFilename(input.filename, input.kind),
      ownerTenantId: principal.tenantId,
      ownerUserId: principal.userId,
      bytes: input.bytes.length,
      sha256: sha256(input.bytes),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.macrosPresent ? { macrosPresent: true } : {}),
      createdAt: now().toISOString(),
    };
    const blob = resolveInside(rootDir, scopeKey(principal), "blobs", meta.id);
    await writeAtomic(blob, input.bytes);
    await writeJson(resolveInside(rootDir, scopeKey(principal), "meta", `${meta.id}.json`), meta);
    return meta;
  }

  async function loadOwned(
    principal: OfficePrincipal,
    artifactId: string | undefined,
  ): Promise<{ meta: ArtifactMeta; bytes: Buffer }> {
    const id = sanitizeId(artifactId ?? "");
    if (!id) {
      throw new OfficeSuiteError("path", "文件编号无效。");
    }
    const metaPath = resolveInside(rootDir, scopeKey(principal), "meta", `${id}.json`);
    let meta: ArtifactMeta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as ArtifactMeta;
    } catch {
      throw new OfficeSuiteError("auth", "无权读取该文件，或文件不存在。");
    }
    if (meta.ownerUserId !== principal.userId || meta.ownerTenantId !== principal.tenantId) {
      throw new OfficeSuiteError("auth", "无权读取该文件，或文件不存在。");
    }
    const bytes = await fs.readFile(resolveInside(rootDir, scopeKey(principal), "blobs", meta.id));
    return { meta, bytes };
  }

  async function done(
    principal: OfficePrincipal,
    action: string,
    meta: ArtifactMeta,
    message: string,
    details: Record<string, unknown>,
  ): Promise<OfficeResult> {
    const task: TaskMeta = {
      id: newId("task"),
      action,
      kind: meta.kind,
      status: "succeeded",
      artifactId: meta.id,
      bytes: meta.bytes,
      createdAt: now().toISOString(),
    };
    await recordTask(principal, task);
    return {
      ok: true,
      action,
      status: "succeeded",
      message,
      taskId: task.id,
      artifactId: meta.id,
      filename: meta.filename,
      relativePath: path.join(scopeKey(principal), "blobs", meta.id),
      details: { ...details, sha256: meta.sha256, bytes: meta.bytes },
    };
  }

  async function recordTask(principal: OfficePrincipal, task: TaskMeta): Promise<void> {
    try {
      assertPrincipal(principal);
    } catch {
      return;
    }
    await writeJson(resolveInside(rootDir, scopeKey(principal), "tasks", `${task.id}.json`), task);
  }

  function templateBlob(meta: TemplateMeta): string {
    return templatePath(meta).replace(/\.json$/, ".bin");
  }

  function templatePath(meta: TemplateMeta): string {
    if (meta.scope === "platform") {
      return resolveInside(rootDir, "templates", "platform", `${meta.id}.json`);
    }
    if (meta.scope === "tenant") {
      return resolveInside(
        rootDir,
        "templates",
        "tenant",
        sanitizeId(meta.ownerTenantId) || "none",
        `${meta.id}.json`,
      );
    }
    return resolveInside(
      rootDir,
      "templates",
      "personal",
      scopeKey({ tenantId: meta.ownerTenantId, userId: meta.ownerUserId }),
      `${meta.id}.json`,
    );
  }

  async function readTemplates(): Promise<TemplateMeta[]> {
    const dir = resolveInside(rootDir, "templates");
    const found: TemplateMeta[] = [];
    async function walk(current: string): Promise<void> {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(current);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = resolveInside(rootDir, path.relative(rootDir, path.join(current, entry)));
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walk(full);
          continue;
        }
        if (entry.endsWith(".json")) {
          found.push(JSON.parse(await fs.readFile(full, "utf8")) as TemplateMeta);
        }
      }
    }
    await walk(dir);
    return found;
  }

  async function writeJson(file: string, value: unknown): Promise<void> {
    await writeAtomic(file, Buffer.from(JSON.stringify(value), "utf8"));
  }
}

function ok(action: string, message: string, details: Record<string, unknown>): OfficeResult {
  return { ok: true, action, status: "succeeded", message, details };
}

function failure(action: string, error: OfficeSuiteError): OfficeResult {
  return {
    ok: false,
    action,
    status: "failed",
    message: error.message,
    errorCode: error.code,
    recoverable: recovery(error.code),
  };
}

function recovery(code: string): string {
  if (code === "limit") {
    return "缩小表格行数、幻灯片页数或文件体积后重试。";
  }
  if (code === "auth") {
    return "使用当前用户自己的文件编号或模板。不要访问其他租户的产物。";
  }
  if (code === "not-connected") {
    return "改用文件模式，或在接入真实连接器后再试实时会话。";
  }
  return "修正输入后重新执行。失败不会覆盖已有文件。";
}

function safeScope(principal: OfficePrincipal): string {
  try {
    return scopeKey(principal);
  } catch {
    return "anonymous";
  }
}

function expectKind(kind: OfficeRequest["kind"]): OfficeKind {
  if (kind === "docx" || kind === "pptx" || kind === "xlsx" || kind === "pdf") {
    return kind;
  }
  if (kind === "excel-live") {
    throw new OfficeSuiteError("not-connected", "Excel 实时会话未接入，不能当作文件创建。");
  }
  throw new OfficeSuiteError("kind", "kind 需要是 docx、pptx、xlsx 或 pdf。");
}

function kindFromName(filename: string): OfficeKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    return "docx";
  }
  if (lower.endsWith(".pptx")) {
    return "pptx";
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return "xlsx";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  throw new OfficeSuiteError("kind", "只接受 docx、pptx、xlsx、csv、tsv 或 pdf。");
}

function safeFilename(filename: string, kind: OfficeKind): string {
  const base = path.basename(filename).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  const trimmed = base.slice(0, 80) || `office.${kind}`;
  return trimmed.endsWith(`.${kind}`) ? trimmed : `${trimmed}.${kind}`;
}

function fileStem(filename: string | undefined, kind: OfficeKind): string {
  const base = filename?.trim()
    ? path.basename(filename, path.extname(filename))
    : `office-${kind}`;
  return base.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_").slice(0, 60) || "office";
}

function versionName(filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  return `${stem}-v${Date.now().toString(36)}${ext}`;
}

function newId(prefix: string): string {
  return sanitizeId(`${prefix}-${randomBytes(8).toString("hex")}`) || `${prefix}-file`;
}

function boundSummary(summary: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(summary);
  if (text.length <= OFFICE_LIMITS.maxPreviewChars) {
    return summary;
  }
  return { truncated: true, preview: text.slice(0, OFFICE_LIMITS.maxPreviewChars) };
}

function assertTemplateWrite(principal: OfficePrincipal, scope: TemplateScope): void {
  if (scope === "personal") {
    return;
  }
  if (scope === "tenant") {
    if (!principal.tenantId || !principal.tenantAdmin) {
      throw new OfficeSuiteError(
        "auth",
        "只有本企业管理员可以保存租户模板。个人模板仍然可以保存。",
      );
    }
    return;
  }
  if (!principal.platformAdmin) {
    throw new OfficeSuiteError("auth", "只有平台管理员可以保存平台模板。");
  }
}

function canReadTemplate(principal: OfficePrincipal, template: TemplateMeta): boolean {
  if (template.scope === "platform") {
    return true;
  }
  if (template.scope === "tenant") {
    return template.ownerTenantId !== null && template.ownerTenantId === principal.tenantId;
  }
  return template.ownerUserId === principal.userId && template.ownerTenantId === principal.tenantId;
}

function guardSpec(kind: OfficeKind, spec: unknown): void {
  const record = asRecord(spec);
  if (record.macro || record.vba) {
    throw new OfficeSuiteError("macro", "不会执行宏。请去掉宏脚本后只提交文档内容。");
  }
  if (kind === "docx") {
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    if (blocks.length > OFFICE_LIMITS.maxBlocks) {
      throw new OfficeSuiteError("limit", "段落过多。请拆分文档后重试。");
    }
    for (const block of blocks) {
      const rows = asRecord(block).rows;
      if (Array.isArray(rows) && rows.length > OFFICE_LIMITS.maxTableRows) {
        throw new OfficeSuiteError("limit", "表格行数超过上限。请分页或拆表后重试。");
      }
    }
  }
  if (kind === "pptx") {
    const slides = Array.isArray(record.slides) ? record.slides : [];
    if (slides.length > OFFICE_LIMITS.maxSlides) {
      throw new OfficeSuiteError("limit", "幻灯片页数超过上限。");
    }
  }
  if (kind === "pdf") {
    const pages = Array.isArray(record.pages) ? record.pages : [];
    if (pages.length > OFFICE_LIMITS.maxPdfPages) {
      throw new OfficeSuiteError("limit", "PDF 页数超过上限。");
    }
  }
}

function asDocx(spec: unknown): DocxSpec {
  const record = asRecord(spec);
  if (!Array.isArray(record.blocks)) {
    throw new OfficeSuiteError("input", "Word 规格需要 blocks 数组。");
  }
  return { blocks: record.blocks as DocxSpec["blocks"] };
}

function asPptx(spec: unknown): PptxSpec {
  const record = asRecord(spec);
  if (!Array.isArray(record.slides)) {
    throw new OfficeSuiteError("input", "PPT 规格需要 slides 数组。");
  }
  return { slides: record.slides as PptxSpec["slides"] };
}

function asXlsx(spec: unknown): XlsxSpec {
  return asRecord(spec) as XlsxSpec;
}

function asPdf(spec: unknown): PdfSpec {
  const record = asRecord(spec);
  return {
    title: typeof record.title === "string" ? record.title : "未命名",
    ...(Array.isArray(record.pages) ? { pages: record.pages as PdfSpec["pages"] } : {}),
    ...(Array.isArray(record.paragraphs) ? { paragraphs: record.paragraphs as string[] } : {}),
    ...(Array.isArray(record.formFields)
      ? { formFields: record.formFields as PdfSpec["formFields"] }
      : {}),
  };
}

function asRecord(spec: unknown): Record<string, unknown> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new OfficeSuiteError("input", "规格需要是 JSON 对象。");
  }
  return spec as Record<string, unknown>;
}
