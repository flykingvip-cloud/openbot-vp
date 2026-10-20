import {
  applySnapshot,
  connectGateway,
  handleGatewayEvent,
  setAppGatewayTestHooks,
  type GatewayHost,
} from "../../app-gateway.ts";
import {
  isCurrentControlUiGatewayTarget,
  loadControlUiBootstrapConfig,
  type ControlUiBootstrapState,
} from "../../controllers/control-ui-bootstrap.ts";
import {
  GatewayBrowserClient,
  GatewayRequestError,
  isNonRecoverableAuthError,
  resolveGatewayErrorDetailCode,
  setGatewayBrowserClientTestHooks,
  type GatewayBrowserClientOptions,
  type GatewayErrorInfo,
  type GatewayEventFrame,
  type GatewayHelloOk,
  type GatewayResponseFrame,
} from "../../gateway.ts";
import {
  createGatewayConnectionClient,
  resolveControlUiClientVersion,
  resolveGatewayCloseDetailCode,
  resolveGatewayCloseMessage,
  resolveRecoveredGatewayUrlForOriginError,
  setGatewayCapabilityRuntimeTestHooks,
} from "./runtime.ts";

export type GatewayCapabilityBootstrapState = ControlUiBootstrapState;
export type GatewayCapabilityHost = GatewayHost;
export type GatewayCapabilityBrowserClientOptions = GatewayBrowserClientOptions;
export type GatewayCapabilityEventFrame = GatewayEventFrame;
export type GatewayCapabilityErrorInfo = GatewayErrorInfo;
export type GatewayCapabilityHelloOk = GatewayHelloOk;
export type GatewayCapabilityResponseFrame = GatewayResponseFrame;

/**
 * Transitional gateway capability seam.
 *
 * This groups browser transport, bootstrap loading, and connect/apply event
 * flows behind a single import boundary before the gateway implementation is
 * split further.
 */
export const gatewayCapability = {
  GatewayBrowserClient,
  GatewayRequestError,
  applySnapshot,
  connect: connectGateway,
  createConnectionClient: createGatewayConnectionClient,
  handleEvent: handleGatewayEvent,
  isCurrentTarget: isCurrentControlUiGatewayTarget,
  isNonRecoverableAuthError,
  loadBootstrapConfig: loadControlUiBootstrapConfig,
  resolveCloseDetailCode: resolveGatewayCloseDetailCode,
  resolveCloseMessage: resolveGatewayCloseMessage,
  resolveClientVersion: resolveControlUiClientVersion,
  resolveErrorDetailCode: resolveGatewayErrorDetailCode,
  resolveRecoveredGatewayUrlForOriginError,
  setAppGatewayTestHooks,
  setRuntimeTestHooks: setGatewayCapabilityRuntimeTestHooks,
  setGatewayBrowserClientTestHooks,
} as const;
