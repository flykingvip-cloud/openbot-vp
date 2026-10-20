import Foundation
import Testing
@testable import OpenBot

struct WechatPersonalInboundServerTests {
    @Test func `loopback inbound posts wechat.personal.inbound payload`() async throws {
        let port = UInt16(18_791)
        let got = ExpectationBox()
        let server = try WechatPersonalInboundServer(port: port, path: "/webhook/wechat") { payload in
            await got.set(payload)
        }
        server.start()
        defer { server.stop() }
        try await Task.sleep(nanoseconds: 150_000_000)

        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/webhook/wechat")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"msgType":"text","fromUser":"wxid_t","content":"hi"}"#.utf8)
        let (_, response) = try await URLSession.shared.data(for: request)
        let http = try #require(response as? HTTPURLResponse)
        #expect(http.statusCode == 200)

        let payload = await got.wait(timeoutNs: 2_000_000_000)
        #expect(payload?.contains("wxid_t") == true)
        #expect(payload?.contains("hi") == true)
    }

    @Test func `inbound event name is wechat.personal.inbound`() {
        #expect(WechatPersonalInbound.eventName == "wechat.personal.inbound")
    }
}

private actor ExpectationBox {
    private var value: String?
    private var continuation: CheckedContinuation<String?, Never>?

    func set(_ next: String) {
        self.value = next
        self.continuation?.resume(returning: next)
        self.continuation = nil
    }

    func wait(timeoutNs: UInt64) async -> String? {
        if let value {
            return value
        }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            Task {
                try? await Task.sleep(nanoseconds: timeoutNs)
                if let pending = self.continuation {
                    self.continuation = nil
                    pending.resume(returning: self.value)
                }
            }
        }
    }
}
