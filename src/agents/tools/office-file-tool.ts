import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OfficePrincipal } from "../../office-suite/scope.js";
import { createOfficeSuite, type OfficeRequest } from "../../office-suite/service.js";
import { stringEnum } from "../schema/typebox.js";
import { asToolParams, jsonResult, readStringParam, type AnyAgentTool } from "./common.js";

const ACTIONS = [
  "capability",
  "connector_status",
  "import",
  "create",
  "edit",
  "read",
  "preview",
  "validate",
  "export",
  "template_save",
  "template_list",
  "template_use",
  "excel_live",
  "task_status",
] as const;

const KINDS = ["docx", "pptx", "xlsx", "pdf", "excel-live"] as const;
const SCOPES = ["personal", "tenant", "platform"] as const;

export type OfficeFileToolOptions = {
  workspaceDir: string;
  /** Null or omitted means an individual user. */
  tenantId?: string | null;
  userId?: string | null;
  tenantAdmin?: boolean;
  platformAdmin?: boolean;
};

/**
 * File-mode Office create, edit, preview, and export.
 * Excel live sessions and Google Workspace stay disconnected unless a real connector is injected.
 */
export function createOfficeFileTool(options: OfficeFileToolOptions): AnyAgentTool {
  const suite = createOfficeSuite({
    rootDir: path.join(options.workspaceDir, "output", "office-suite"),
  });
  const principal: OfficePrincipal = {
    tenantId: options.tenantId?.trim() || null,
    userId: options.userId?.trim() || "",
    tenantAdmin: options.tenantAdmin === true,
    platformAdmin: options.platformAdmin === true,
  };

  return {
    label: "Office File",
    name: "office_file",
    description:
      "Create, edit, preview, validate, and export DOCX, PPTX, XLSX, and PDF files for the signed-in user. Originals are kept and new versions are written. Excel live control and Google Workspace are 未接入 unless a real connector is configured; never treat file generation as an open desktop workbook.",
    parameters: Type.Object({
      action: stringEnum(ACTIONS, { description: "Office file action." }),
      kind: Type.Optional(
        stringEnum(KINDS, { description: "docx, pptx, xlsx, pdf, or excel-live." }),
      ),
      filename: Type.Optional(Type.String({ description: "Output or upload filename." })),
      dataBase64: Type.Optional(Type.String({ description: "Upload bytes for import." })),
      specJson: Type.Optional(
        Type.String({ description: "JSON object for create, edit, or template contents." }),
      ),
      artifactId: Type.Optional(
        Type.String({ description: "Existing file id owned by this user." }),
      ),
      templateId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      name: Type.Optional(Type.String({ description: "Template name." })),
      scope: Type.Optional(stringEnum(SCOPES)),
      render: Type.Optional(
        Type.Boolean({ description: "Ask for a pixel preview when LibreOffice is installed." }),
      ),
      liveOp: Type.Optional(stringEnum(["read", "edit"] as const)),
    }),
    execute: async (_toolCallId, rawParams) => {
      const params = asToolParams(rawParams);
      const action = readStringParam(params, "action", {
        required: true,
      }) as OfficeRequest["action"];
      const kind = readStringParam(params, "kind") as OfficeRequest["kind"] | undefined;
      let spec: unknown;
      const specJson = readStringParam(params, "specJson");
      if (specJson) {
        try {
          spec = JSON.parse(specJson) as unknown;
        } catch {
          return jsonResult({
            ok: false,
            status: "failed",
            errorCode: "input",
            message: "specJson 不是合法 JSON。请修正后重试。",
          });
        }
      }
      const dataBase64 = readStringParam(params, "dataBase64");
      const request: OfficeRequest = {
        action,
        ...(kind ? { kind } : {}),
        ...(readStringParam(params, "filename")
          ? { filename: readStringParam(params, "filename") }
          : {}),
        ...(dataBase64 ? { bytes: Buffer.from(dataBase64, "base64") } : {}),
        ...(spec !== undefined ? { spec } : {}),
        ...(readStringParam(params, "artifactId")
          ? { artifactId: readStringParam(params, "artifactId") }
          : {}),
        ...(readStringParam(params, "templateId")
          ? { templateId: readStringParam(params, "templateId") }
          : {}),
        ...(readStringParam(params, "taskId") ? { taskId: readStringParam(params, "taskId") } : {}),
        ...(readStringParam(params, "name") ? { name: readStringParam(params, "name") } : {}),
        ...(readStringParam(params, "scope")
          ? { scope: readStringParam(params, "scope") as OfficeRequest["scope"] }
          : {}),
        ...(typeof params.render === "boolean" ? { render: params.render } : {}),
        ...(readStringParam(params, "liveOp")
          ? { liveOp: readStringParam(params, "liveOp") as OfficeRequest["liveOp"] }
          : {}),
      };
      const result = await suite.execute(principal, request);
      return jsonResult(result);
    },
  };
}
