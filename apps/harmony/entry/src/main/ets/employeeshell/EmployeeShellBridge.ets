/**
 * Mirrors ui/src/ui/employee-shell/native-bridge.ts + Android EmployeeShellBridge.
 * Web calls: window.openbotEmployeeShell.postMessage(JSON.stringify({version,type,payload}))
 */

import { JsonMap, jsonObject, jsonString, parseJsonMap } from '../platformauth/JsonHelp';

export const EMPLOYEE_SHELL_HANDLER_NAME: string = 'openbotEmployeeShell';
export const EMPLOYEE_SHELL_BRIDGE_VERSION: number = 1;

export type EmployeeShellIntentType =
  | 'ready'
  | 'openChat'
  | 'openAssistant'
  | 'openSpace'
  | 'openKnowledgeObject'
  | 'openDeviceSettings'
  | 'unknown';

export class EmployeeShellIntent {
  type: EmployeeShellIntentType = 'unknown';
  surface: string = '';
  sessionKey: string = '';
  agentId: string = '';
  spaceId: string = '';
  objectId: string = '';
  kind: string = '';
  section: string = '';
}

export function parseEmployeeShellBridgeMessage(raw: string): EmployeeShellIntent | undefined {
  const text = raw.trim();
  if (text.length === 0) {
    return undefined;
  }
  const message: JsonMap = parseJsonMap(text);
  if (Number(jsonString(message, 'version')) !== EMPLOYEE_SHELL_BRIDGE_VERSION) {
    return undefined;
  }
  const type = jsonString(message, 'type');
  const payload: JsonMap = jsonObject(message, 'payload') ?? ({} as JsonMap);
  const intent = new EmployeeShellIntent();

  switch (type) {
    case 'ready':
      intent.type = 'ready';
      intent.surface = jsonString(payload, 'surface');
      return intent;
    case 'openChat':
      intent.type = 'openChat';
      intent.sessionKey = jsonString(payload, 'sessionKey');
      intent.agentId = jsonString(payload, 'agentId');
      return intent;
    case 'openAssistant':
      intent.type = 'openAssistant';
      intent.agentId = jsonString(payload, 'agentId');
      return intent;
    case 'openSpace': {
      const spaceId = jsonString(payload, 'spaceId');
      if (spaceId.length === 0) {
        return undefined;
      }
      intent.type = 'openSpace';
      intent.spaceId = spaceId;
      return intent;
    }
    case 'openKnowledgeObject': {
      const objectId = jsonString(payload, 'objectId');
      if (objectId.length === 0) {
        return undefined;
      }
      intent.type = 'openKnowledgeObject';
      intent.objectId = objectId;
      intent.kind = jsonString(payload, 'kind');
      return intent;
    }
    case 'openDeviceSettings':
      intent.type = 'openDeviceSettings';
      intent.section = jsonString(payload, 'section');
      return intent;
    default:
      return undefined;
  }
}

/**
 * Host object registered via Web.javaScriptProxy as `openbotEmployeeShell`
 * so native-host.ts Android transport path detects the bridge.
 */
export class EmployeeShellHostBridge {
  private onMessage: (raw: string) => void;

  constructor(onMessage: (raw: string) => void) {
    this.onMessage = onMessage;
  }

  postMessage(payload: string): void {
    this.onMessage(payload ?? '');
  }
}

/** Map bridge intents to employee embed targets (phone shell keeps chat in Web). */
export function embedTargetForIntent(intent: EmployeeShellIntent): string | undefined {
  switch (intent.type) {
    case 'openKnowledgeObject':
      return '/embed/employee/knowledge';
    case 'openSpace':
    case 'openChat':
    case 'openAssistant':
      return '/embed/employee/workspace';
    case 'openDeviceSettings':
      return '/embed/employee/me';
    default:
      return undefined;
  }
}
