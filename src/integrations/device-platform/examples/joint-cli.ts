/**
 * Prints the harness result. Does not call the live device-control port.
 * Live probing stays in examples/joint.sh so a missing process is JOINT_PENDING.
 */

import {
  CONTROL_FREEZE_SHA,
  DEFAULT_DEVICE_CONTROL_BASE_URL,
  DEFAULT_OPENBOT_BASE_URL,
  DEFAULT_STUB_BASE_URL,
  DEVICE_CONTROL_OPENAPI_PATH,
  DEVICE_CONTROL_OPENAPI_RAW_URL,
  DEVICE_SDK_MAIN_TIP,
  OPENBOT_CONTRACT_SHA,
  OPENBOT_OPENAPI_RAW_URL,
  runJointHarness,
} from "./joint-harness.js";

const report = await runJointHarness();
if (
  report.listedBefore !== 0 ||
  !report.deviceId ||
  !report.adminHealthOk ||
  !report.sameBindingOnHumanA ||
  report.reboundDigitalHumanId !== "dh-b" ||
  !report.sameBindingOnHumanB ||
  !report.humanAClearedAfterRebind
) {
  throw new Error("joint harness did not complete admin health, bind A, and rebind B");
}
if (
  !report.revoked ||
  !report.personalClearedAfterRevoke ||
  !report.humanBClearedAfterRevoke ||
  report.grantStatusAfterRevoke !== "revoked" ||
  !report.oldAuthCannotExecute ||
  !report.capabilityRejectedAfterRevoke ||
  !report.restartedListed ||
  report.callsDuringRestart !== 0
) {
  throw new Error("joint harness did not prove revoke blocks the old authorization");
}
if (report.grayRelease || report.realDeviceDelivery) {
  throw new Error("grayRelease and realDeviceDelivery must stay false");
}
if (
  report.voicePhoto.deviceEffect ||
  report.voicePhoto.hardware ||
  report.voicePhoto.tier !== "模拟"
) {
  throw new Error("voice and photo must stay a 模拟 stub");
}
if (report.documentedControlBaseUrl !== DEFAULT_DEVICE_CONTROL_BASE_URL) {
  throw new Error("documented device-control origin drifted");
}
if (report.documentedStubBaseUrl !== DEFAULT_STUB_BASE_URL) {
  throw new Error("documented integrations stub origin drifted");
}
if (CONTROL_FREEZE_SHA !== "55ead3ef7fe7f20137123447c39e3f26f9bffbbe") {
  throw new Error("CONTROL_FREEZE_SHA drifted from the device-sdk v1 freeze");
}
process.stdout.write("harness ok\n");
process.stdout.write(`device-control default ${DEFAULT_DEVICE_CONTROL_BASE_URL}\n`);
process.stdout.write(`stub default ${DEFAULT_STUB_BASE_URL}\n`);
process.stdout.write(`openbot default ${DEFAULT_OPENBOT_BASE_URL}\n`);
process.stdout.write(`OPENBOT_CONTRACT_SHA ${OPENBOT_CONTRACT_SHA}\n`);
process.stdout.write(`DEVICE_SDK_MAIN_TIP ${DEVICE_SDK_MAIN_TIP}\n`);
process.stdout.write(`CONTROL_FREEZE_SHA ${CONTROL_FREEZE_SHA}\n`);
process.stdout.write(`device-control openapi path ${DEVICE_CONTROL_OPENAPI_PATH}\n`);
process.stdout.write(`openapi ${OPENBOT_OPENAPI_RAW_URL}\n`);
process.stdout.write(`historical device-control openapi ${DEVICE_CONTROL_OPENAPI_RAW_URL}\n`);
process.stdout.write(
  "mock order admin-health pair redeem exchange bind-a rebind-b revoke grant-revoked\n",
);
process.stdout.write("voice-photo stub deviceEffect false\n");
process.stdout.write("grayRelease false\n");
process.stdout.write("JOINT_PENDING cross-host hardware\n");
