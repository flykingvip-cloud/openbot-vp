/**
 * Excel live sessions and Google Workspace are separate connectors.
 * File generation must never be reported as a successful live-app edit.
 */

export type ConnectorState = {
  id: "excel-live" | "google-workspace";
  status: "未接入" | "已验证";
  reason: string;
};

export type ExcelLiveProbe = {
  probe: () => Promise<{ connected: boolean; reason?: string }>;
  readWorkbook?: () => Promise<{ title: string }>;
  editWorkbook?: () => Promise<{ title: string }>;
};

export type GoogleWorkspaceProbe = {
  probe: () => Promise<{ connected: boolean; reason?: string }>;
};

const EXCEL_UNAVAILABLE =
  "未接入：没有可用的 Excel 实时会话连接器。文件模式的工作簿创建和编辑不受影响，但不会操作已打开的桌面工作簿。";
const GOOGLE_UNAVAILABLE =
  "未接入：没有可用的 Google Workspace 连接器。不会把本地文件生成报告成 Google 文档、表格或幻灯片。";

export async function excelLiveStatus(connector?: ExcelLiveProbe): Promise<ConnectorState> {
  if (!connector) {
    return { id: "excel-live", status: "未接入", reason: EXCEL_UNAVAILABLE };
  }
  try {
    const result = await connector.probe();
    if (!result.connected || !connector.readWorkbook || !connector.editWorkbook) {
      return {
        id: "excel-live",
        status: "未接入",
        reason: result.reason?.trim() || EXCEL_UNAVAILABLE,
      };
    }
    return {
      id: "excel-live",
      status: "已验证",
      reason: result.reason?.trim() || "Excel 实时会话已连接。",
    };
  } catch {
    return { id: "excel-live", status: "未接入", reason: EXCEL_UNAVAILABLE };
  }
}

export async function googleWorkspaceStatus(
  connector?: GoogleWorkspaceProbe,
): Promise<ConnectorState> {
  if (!connector) {
    return { id: "google-workspace", status: "未接入", reason: GOOGLE_UNAVAILABLE };
  }
  try {
    const result = await connector.probe();
    if (!result.connected) {
      return {
        id: "google-workspace",
        status: "未接入",
        reason: result.reason?.trim() || GOOGLE_UNAVAILABLE,
      };
    }
    return {
      id: "google-workspace",
      status: "已验证",
      reason: result.reason?.trim() || "Google Workspace 连接器已连接。",
    };
  } catch {
    return { id: "google-workspace", status: "未接入", reason: GOOGLE_UNAVAILABLE };
  }
}

export async function refuseExcelLiveMutation(connector?: ExcelLiveProbe): Promise<ConnectorState> {
  const status = await excelLiveStatus(connector);
  if (status.status !== "已验证" || !connector?.editWorkbook) {
    return { ...status, status: "未接入" };
  }
  return status;
}
