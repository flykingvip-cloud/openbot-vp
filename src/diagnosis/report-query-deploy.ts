/**
 * Live gateway registration gate for diagnosis report query/get.
 * When false, diagnosisReportsPack must not enter GATEWAY_METHOD_PACKS
 * or coreGatewayHandlers. Flipping this is a separate production approval.
 */
/** O1.1 step 3: read-only report API after P24.8 identity re-bind at LIVE 6bd4569606. */
export const DIAGNOSIS_REPORT_API_DEPLOYED = true;
