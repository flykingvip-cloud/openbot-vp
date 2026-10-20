/**
 * Prints the harness result. Does not call the live device-control port.
 * Live probing stays in examples/joint.sh so a missing process is JOINT_PENDING.
 */

import {
  DEFAULT_DEVICE_CONTROL_BASE_URL,
  DEFAULT_OPENBOT_BASE_URL,
  DEVICE_CONTROL_OPENAPI_RAW_URL,
  OPENBOT_CONTRACT_SHA,
  OPENBOT_OPENAPI_RAW_URL,
  runJointHarness,
} from "./joint-harness.js";

const report = await runJointHarness();
if (report.listedBefore !== 0 || !report.deviceId || report.reboundDigitalHumanId !== "dh-shared") {
  throw new Error("joint harness did not complete list, add, and rebind");
}
if (!report.revoked || !report.restartedListed || report.callsDuringRestart !== 0) {
  throw new Error("joint harness did not complete revoke and restart");
}
if (report.grayRelease) {
  throw new Error("grayRelease must stay false");
}
process.stdout.write("harness ok\n");
process.stdout.write(`device-control default ${DEFAULT_DEVICE_CONTROL_BASE_URL}\n`);
process.stdout.write(`openbot default ${DEFAULT_OPENBOT_BASE_URL}\n`);
process.stdout.write(`OPENBOT_CONTRACT_SHA ${OPENBOT_CONTRACT_SHA}\n`);
process.stdout.write(`openapi ${OPENBOT_OPENAPI_RAW_URL}\n`);
process.stdout.write(`historical device-control openapi ${DEVICE_CONTROL_OPENAPI_RAW_URL}\n`);
process.stdout.write("grayRelease false\n");
process.stdout.write("JOINT_PENDING cross-host hardware\n");
