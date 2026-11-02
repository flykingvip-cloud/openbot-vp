# Batch2 credential-free coverage results

pin=1ce8f5ee4e8c852d45a9c6a30a623e0bed082587
when=2026-11-01 23:39:06 CST

| Check                                               | Result                                                                        | Log                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Stage4 evidence (5 files)                           | CONDITIONAL (25/26 pass; 1 FAIL backup credentials exclusion)                 | 10-stage4-evidence.log                                         |
| Stage5 HA wiring evidence                           | PASS (6/6; docker compose HA profile skipped → still CONDITIONAL for prod HA) | 10-stage5-evidence.log                                         |
| Stage6 SBOM committed CycloneDX                     | PASS static (1600 components, cdxgen 12.8.5)                                  | 10-stage6-sbom-static-summary.log                              |
| Stage6 audit moderate live pnpm audit               | BLOCKED (corepack registry timeout)                                           | aborted stage6 run                                             |
| CLI --version + 11 command --help                   | PASS                                                                          | 10-cli-extra-help-version.log                                  |
| package.json install/release/sbom scripts           | PASS presence                                                                 | 10-cli-extra-help-version.log / 10-install-channels-static.log |
| Channel plugins vs docs (24/24)                     | PASS COMPLETE                                                                 | 10-install-channels-static.log                                 |
| plugins list (offline discovery)                    | PASS                                                                          | 10-install-channels-static.log                                 |
| openbot.love sibling installers                     | 跨仓依赖 NOT RUN (ABSENT)                                                     | 10-install-channels-static.log                                 |
| Apps roots android/ios/macos/harmony/windows/shared | PASS PRESENT                                                                  | 10-multiend-apps-inventory.log                                 |
| macos swift package dump-package                    | PASS (metadata; compile stays BLOCKED)                                        | 10-multiend-tools-probe.log                                    |
| android gradlew tasks (JAVA_HOME fixed)             | PASS (assemble/installDebug/lint/test listed; no assemble executed)           | 10-android-gradle-tasks.log                                    |
| ios xcodeproj                                       | BLOCKED (project.yml only; xcodeproj_count=0; needs xcodegen)                 | 10-multiend-tools-probe.log                                    |
| windows dotnet                                      | BLOCKED (dotnet not found; sln PRESENT)                                       | 10-multiend-tools-probe.log                                    |
| harmony hvigor                                      | BLOCKED (hvigorw not found; oh-package PRESENT)                               | 10-multiend-tools-probe.log                                    |
| SwiftPM swift build                                 | BLOCKED (policy)                                                              | —                                                              |
