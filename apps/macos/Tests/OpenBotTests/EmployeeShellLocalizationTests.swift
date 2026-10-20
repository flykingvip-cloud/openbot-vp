import Foundation
import Testing
@testable import OpenBot

struct EmployeeShellStringsTests {
    @Test func `language resolves from preferred code`() {
        #expect(EmployeeShellLanguage.from(preferred: "zh-Hans-CN") == .zhHans)
        #expect(EmployeeShellLanguage.from(preferred: "zh") == .zhHans)
        #expect(EmployeeShellLanguage.from(preferred: "en-US") == .en)
        #expect(EmployeeShellLanguage.from(preferred: nil) == .en)
        #expect(EmployeeShellLanguage.from(preferred: "fr") == .en)
    }

    @Test func `every key has both zh and en without falling back to raw`() {
        for key in EmployeeShellStrings.Key.allCases {
            let en = EmployeeShellStrings.string(key, .en)
            let zh = EmployeeShellStrings.string(key, .zhHans)
            #expect(!en.isEmpty)
            #expect(!zh.isEmpty)
            // `brand` (OpenBot) and `optional` legitimately equal their rawValue;
            // other keys must resolve to a real translation (not the raw fallback).
            if key != .brand, key != .optional {
                #expect(en != key.rawValue, "en missing for \(key.rawValue)")
            }
            // zh must always differ from the raw English-ish key name.
            if key != .brand {
                #expect(zh != key.rawValue, "zh missing for \(key.rawValue)")
            }
        }
    }
}

@MainActor
struct EmployeeShellTelemetryTests {
    @Test func `login success rate is 1 with no attempts`() {
        let t = EmployeeShellTelemetry()
        #expect(t.loginSuccessRate == 1.0)
    }

    @Test func `login success rate tracks attempts and successes`() {
        let t = EmployeeShellTelemetry()
        t.recordLoginAttempt()
        t.recordLoginAttempt()
        t.recordLoginSuccess()
        #expect(t.loginAttempts == 2)
        #expect(t.loginSuccesses == 1)
        #expect(t.loginSuccessRate == 0.5)
    }
}

@MainActor
struct EmployeeLoginViewModelTests {
    @Test func `login mode requires email and password`() {
        let model = EmployeeLoginViewModel()
        model.mode = .login
        model.email = ""
        model.password = ""
        #expect(!model.canSubmit)
        model.email = "a@x.com"
        model.password = "pw"
        #expect(model.canSubmit)
    }

    @Test func `reset mode requires code and new password (not email)`() {
        let model = EmployeeLoginViewModel()
        model.mode = .reset
        model.email = ""
        model.resetCode = "123"
        model.newPassword = "newpw"
        #expect(model.canSubmit)
    }

    @Test func `invalid gateway blocks submit and sso`() {
        let model = EmployeeLoginViewModel()
        model.gatewayURLString = "not a url"
        model.email = "a@x.com"
        model.password = "pw"
        #expect(model.gatewayURL == nil)
        #expect(!model.canSubmit)
        #expect(!model.canSSO)
    }

    @Test func `default gateway is the cloud gateway`() {
        let model = EmployeeLoginViewModel()
        #expect(model.gatewayURLString == "https://www.openbot.love")
        #expect(model.gatewayURL != nil)
    }
}
