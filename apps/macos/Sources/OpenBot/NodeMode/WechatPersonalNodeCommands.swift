import Foundation
import OpenBotIPC
import OpenBotKit

enum WechatPersonalNodeCommand: String {
    case probe = "wechat.personal.probe"
    case loginStart = "wechat.personal.login.start"
    case loginWait = "wechat.personal.login.wait"
    case logout = "wechat.personal.logout"
    case status = "wechat.personal.status"
    case sendText = "wechat.personal.sendText"

    static var allAdvertised: [String] {
        [
            probe.rawValue,
            loginStart.rawValue,
            loginWait.rawValue,
            logout.rawValue,
            status.rawValue,
            sendText.rawValue,
        ]
    }
}

enum WechatPersonalLoopback {
    static func isLoopbackHttpUrl(_ raw: String) -> Bool {
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased()
        else {
            return false
        }
        let normalized = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return normalized == "127.0.0.1" || normalized == "localhost" || normalized == "::1"
    }
}

private struct WechatPersonalSidecarResolvedConfig: Sendable {
    var proxyUrl: String
    var apiKey: String?
    var deviceType: String?
    var webhookPort: Int?
    var webhookPath: String?
    var command: String?
    var args: [String]
    var cwd: String?
}

enum WechatPersonalInboundListen {
    static func resolve() -> (port: UInt16, path: String) {
        let config = WechatPersonalSidecarClient.peekConfig()
        let portRaw = config.webhookPort ?? Int(WechatPersonalInbound.defaultPort)
        let port = UInt16(clamping: max(1, portRaw))
        let path = (config.webhookPath?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
            $0.isEmpty ? nil : $0
        } ?? WechatPersonalInbound.defaultPath
        return (port, path)
    }
}

private struct WechatInvokeParams: Decodable, Sendable {
    var accountId: String?
    var force: Bool?
    var timeoutMs: Int?
    var to: String?
    var text: String?
}

private struct WechatProbePayload: Encodable, Sendable {
    var ok: Bool
    var online: Bool
    var error: String?
}

private struct WechatLoginStartPayload: Encodable, Sendable {
    var qrDataUrl: String
    var loginId: String
}

private struct WechatLoginWaitPayload: Encodable, Sendable {
    var connected: Bool
    var status: String
    var wxid: String?
    var nickname: String?
    var message: String
}

private struct WechatStatusPayload: Encodable, Sendable {
    var online: Bool
    var loggedIn: Bool
    var wxid: String?
    var nickname: String?
}

private struct WechatLogoutPayload: Encodable, Sendable {
    var cleared: Bool
}

private struct WechatSendTextPayload: Encodable, Sendable {
    var messageId: String
}

enum WechatPersonalSidecarError: Error, LocalizedError {
    case notLoopback
    case invalidURL
    case unauthorized
    case httpStatus(Int)
    case missingQr
    case invalidJSON

    var errorDescription: String? {
        switch self {
        case .notLoopback:
            return "WeChat personal sidecar URL must be loopback (127.0.0.1, localhost, or ::1)."
        case .invalidURL:
            return "WeChat personal sidecar URL is invalid."
        case .unauthorized:
            return "unauthorized"
        case .httpStatus(let status):
            return "WeChat personal sidecar HTTP \(status)"
        case .missingQr:
            return "WeChat personal sidecar did not return qrCodeUrl."
        case .invalidJSON:
            return "WeChat personal sidecar returned invalid JSON."
        }
    }
}

actor WechatPersonalSidecarClient {
    private let session: URLSession
    private let proxyURL: URL
    private let apiKey: String?
    private let deviceType: String
    private let command: String?
    private let args: [String]
    private let cwd: String?

    init(session: URLSession = .shared) throws {
        let config = Self.loadConfig()
        guard WechatPersonalLoopback.isLoopbackHttpUrl(config.proxyUrl) else {
            throw WechatPersonalSidecarError.notLoopback
        }
        guard let url = URL(string: config.proxyUrl) else {
            throw WechatPersonalSidecarError.invalidURL
        }
        self.proxyURL = url
        self.apiKey = config.apiKey
        self.deviceType = config.deviceType ?? "ipad"
        self.command = config.command
        self.args = config.args
        self.cwd = config.cwd
        self.session = session
    }

    fileprivate func probe(spawnIfNeeded: Bool = true) async -> WechatProbePayload {
        let first = await self.probeOnce()
        if first.payload.online || !spawnIfNeeded {
            return first.payload
        }
        guard WechatPersonalSidecarSpawnDecision.shouldSpawn(
            command: self.command,
            probeOnline: first.payload.online,
            unreachable: first.unreachable)
        else {
            return first.payload
        }
        guard WechatPersonalLoopback.isLoopbackHttpUrl(self.proxyURL.absoluteString),
              let spec = WechatPersonalSidecarSpawnDecision.launchSpec(
                command: self.command,
                args: self.args,
                cwd: self.cwd)
        else {
            return first.payload
        }
        _ = await WechatPersonalSidecarProcess.shared.spawnIfNeeded(spec: spec)
        var last = first
        for _ in 0 ..< 8 {
            try? await Task.sleep(nanoseconds: 350_000_000)
            last = await self.probeOnce()
            if last.payload.online || !last.unreachable {
                return last.payload
            }
        }
        return last.payload
    }

    private struct ProbeOnceResult: Sendable {
        var payload: WechatProbePayload
        var unreachable: Bool
    }

    private func probeOnce() async -> ProbeOnceResult {
        do {
            let (status, _) = try await self.request(path: "/api/loginStatus", method: "GET")
            if (200 ..< 300).contains(status) {
                return ProbeOnceResult(
                    payload: WechatProbePayload(ok: true, online: true, error: nil),
                    unreachable: false)
            }
            if status == 401 || status == 403 {
                return ProbeOnceResult(
                    payload: WechatProbePayload(ok: false, online: true, error: "unauthorized"),
                    unreachable: false)
            }
            return ProbeOnceResult(
                payload: WechatProbePayload(ok: false, online: true, error: "HTTP \(status)"),
                unreachable: false)
        } catch {
            return ProbeOnceResult(
                payload: WechatProbePayload(
                    ok: false,
                    online: false,
                    error: error.localizedDescription),
                unreachable: WechatPersonalSidecarSpawnDecision.isUnreachableError(error))
        }
    }

    fileprivate func loginStart() async throws -> WechatLoginStartPayload {
        let (status, body) = try await self.request(
            path: "/api/login",
            method: "POST",
            jsonBody: ["deviceType": self.deviceType])
        if status == 401 || status == 403 {
            throw WechatPersonalSidecarError.unauthorized
        }
        guard (200 ..< 300).contains(status) else {
            throw WechatPersonalSidecarError.httpStatus(status)
        }
        guard let qrCodeUrl = body["qrCodeUrl"] as? String, !qrCodeUrl.isEmpty else {
            throw WechatPersonalSidecarError.missingQr
        }
        let qrDataUrl = try await self.toQrDataUrl(qrCodeUrl)
        let loginId = (body["loginId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? "qr-\(Int(Date().timeIntervalSince1970 * 1000))"
        return WechatLoginStartPayload(qrDataUrl: qrDataUrl, loginId: loginId)
    }

    fileprivate func loginWait(timeoutMs: Int) async -> WechatLoginWaitPayload {
        let intervalNs: UInt64 = 1_000_000_000
        let iterations = max(1, (timeoutMs + 999) / 1000)
        for i in 0 ..< iterations {
            do {
                let (status, body) = try await self.request(path: "/api/loginStatus", method: "GET")
                if status == 401 || status == 403 {
                    return WechatLoginWaitPayload(
                        connected: false,
                        status: "error",
                        wxid: nil,
                        nickname: nil,
                        message: "unauthorized")
                }
                if status >= 500 {
                    return WechatLoginWaitPayload(
                        connected: false,
                        status: "error",
                        wxid: nil,
                        nickname: nil,
                        message: "HTTP \(status)")
                }
                if (body["status"] as? String) == "logged_in" {
                    let wxid = body["wxid"] as? String
                    return WechatLoginWaitPayload(
                        connected: true,
                        status: "logged_in",
                        wxid: wxid,
                        nickname: body["nickname"] as? String,
                        message: "Logged in as \(wxid ?? "unknown")")
                }
            } catch {
                return WechatLoginWaitPayload(
                    connected: false,
                    status: "error",
                    wxid: nil,
                    nickname: nil,
                    message: error.localizedDescription)
            }
            if i < iterations - 1 {
                try? await Task.sleep(nanoseconds: intervalNs)
            }
        }
        return WechatLoginWaitPayload(
            connected: false,
            status: "timeout",
            wxid: nil,
            nickname: nil,
            message: "WeChat personal QR login timed out.")
    }

    fileprivate func logout() async -> WechatLogoutPayload {
        do {
            let (status, _) = try await self.request(path: "/api/logout", method: "POST", jsonBody: [:])
            if status == 404 {
                return WechatLogoutPayload(cleared: false)
            }
            return WechatLogoutPayload(cleared: (200 ..< 300).contains(status))
        } catch {
            return WechatLogoutPayload(cleared: false)
        }
    }

    fileprivate func status() async -> WechatStatusPayload {
        do {
            let (httpStatus, body) = try await self.request(path: "/api/loginStatus", method: "GET")
            if !(200 ..< 300).contains(httpStatus) {
                return WechatStatusPayload(online: httpStatus > 0, loggedIn: false, wxid: nil, nickname: nil)
            }
            let loggedIn = (body["status"] as? String) == "logged_in"
            return WechatStatusPayload(
                online: true,
                loggedIn: loggedIn,
                wxid: loggedIn ? body["wxid"] as? String : nil,
                nickname: loggedIn ? body["nickname"] as? String : nil)
        } catch {
            return WechatStatusPayload(online: false, loggedIn: false, wxid: nil, nickname: nil)
        }
    }

    fileprivate func sendText(to: String, text: String) async throws -> WechatSendTextPayload {
        let (status, body) = try await self.request(
            path: "/api/sendTextMsg",
            method: "POST",
            jsonBody: ["to": to, "content": text])
        if status == 401 || status == 403 {
            throw WechatPersonalSidecarError.unauthorized
        }
        guard (200 ..< 300).contains(status) else {
            throw WechatPersonalSidecarError.httpStatus(status)
        }
        let msgId = (body["msgId"] as? String) ?? "wechat-\(Int(Date().timeIntervalSince1970 * 1000))"
        return WechatSendTextPayload(messageId: msgId)
    }

    private func request(
        path: String,
        method: String,
        jsonBody: [String: String]? = nil) async throws -> (Int, [String: Any])
    {
        let url = self.endpoint(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let apiKey = self.apiKey, !apiKey.isEmpty {
            req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
        if let jsonBody {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        }
        let (data, response) = try await self.session.data(for: req)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        var body: [String: Any] = [:]
        if !data.isEmpty {
            let parsed = try? JSONSerialization.jsonObject(with: data)
            if let dict = parsed as? [String: Any] {
                body = dict
            } else if parsed != nil {
                throw WechatPersonalSidecarError.invalidJSON
            }
        }
        return (status, body)
    }

    private func endpoint(_ path: String) -> URL {
        var base = self.proxyURL.absoluteString
        if !base.hasSuffix("/") {
            base += "/"
        }
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return URL(string: trimmed, relativeTo: URL(string: base)) ?? self.proxyURL.appendingPathComponent(trimmed)
    }

    private func toQrDataUrl(_ qrCodeUrl: String) async throws -> String {
        if qrCodeUrl.hasPrefix("data:") {
            return qrCodeUrl
        }
        guard let url = URL(string: qrCodeUrl) else {
            throw WechatPersonalSidecarError.missingQr
        }
        let (data, response) = try await self.session.data(from: url)
        let headerMime = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?
            .split(separator: ";").first.map(String.init)
        let mime = (response as? HTTPURLResponse)?.mimeType ?? headerMime ?? "image/png"
        let normalized: String
        if mime == "image/jpg" || mime == "image/jpeg" {
            normalized = "image/jpeg"
        } else if mime.hasPrefix("image/") {
            normalized = mime
        } else {
            normalized = "image/png"
        }
        return "data:\(normalized);base64,\(data.base64EncodedString())"
    }

    fileprivate nonisolated static func peekConfig() -> WechatPersonalSidecarResolvedConfig {
        loadConfig()
    }

    static func ensureSupervisedIfNeeded() async {
        let config = loadConfig()
        let command = config.command?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !command.isEmpty else { return }
        guard WechatPersonalLoopback.isLoopbackHttpUrl(config.proxyUrl) else { return }
        guard let client = try? WechatPersonalSidecarClient() else { return }
        _ = await client.probe(spawnIfNeeded: true)
    }

    nonisolated private static func loadFileConfig() -> WechatPersonalSidecarFileConfig? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let files = [
            home.appendingPathComponent(".openbot/wechat-personal-worker.json"),
            home.appendingPathComponent(".openclaw/wechat-personal-worker.json"),
        ]
        let decoder = JSONDecoder()
        for file in files {
            if let data = try? Data(contentsOf: file),
               let parsed = try? decoder.decode(WechatPersonalSidecarFileConfig.self, from: data)
            {
                return parsed
            }
        }
        return nil
    }

    nonisolated private static func loadConfig() -> WechatPersonalSidecarResolvedConfig {
        let env = ProcessInfo.processInfo.environment
        let file = loadFileConfig()
        if let envUrl = env["OPENBOT_WECHAT_PERSONAL_PROXY_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !envUrl.isEmpty
        {
            return WechatPersonalSidecarResolvedConfig(
                proxyUrl: envUrl,
                apiKey: env["OPENBOT_WECHAT_PERSONAL_API_KEY"],
                deviceType: env["OPENBOT_WECHAT_PERSONAL_DEVICE_TYPE"],
                webhookPort: Int(env["OPENBOT_WECHAT_PERSONAL_WEBHOOK_PORT"] ?? ""),
                webhookPath: env["OPENBOT_WECHAT_PERSONAL_WEBHOOK_PATH"],
                command: file?.command,
                args: file?.args ?? [],
                cwd: file?.cwd)
        }
        if let parsed = file {
            return WechatPersonalSidecarResolvedConfig(
                proxyUrl: parsed.proxyUrl,
                apiKey: parsed.apiKey,
                deviceType: parsed.deviceType,
                webhookPort: parsed.webhookPort,
                webhookPath: parsed.webhookPath,
                command: parsed.command,
                args: parsed.args ?? [],
                cwd: parsed.cwd)
        }
        return WechatPersonalSidecarResolvedConfig(
            proxyUrl: "http://127.0.0.1:3000",
            apiKey: nil,
            deviceType: "ipad",
            webhookPort: Int(WechatPersonalInbound.defaultPort),
            webhookPath: WechatPersonalInbound.defaultPath,
            command: nil,
            args: [],
            cwd: nil)
    }
}

extension MacNodeRuntime {
    func handleWechatPersonalInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        guard let command = WechatPersonalNodeCommand(rawValue: req.command) else {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenBotNodeError(code: .invalidRequest, message: "INVALID_REQUEST: unknown command"))
        }
        let params = Self.decodeWechatParams(req.paramsJSON)
        let client: WechatPersonalSidecarClient
        do {
            client = try WechatPersonalSidecarClient()
        } catch {
            if command == .probe {
                return BridgeInvokeResponse(
                    id: req.id,
                    ok: true,
                    payloadJSON: try Self.encodeWechatJSON(
                        WechatProbePayload(ok: false, online: false, error: error.localizedDescription)))
            }
            if command == .status {
                return BridgeInvokeResponse(
                    id: req.id,
                    ok: true,
                    payloadJSON: try Self.encodeWechatJSON(
                        WechatStatusPayload(online: false, loggedIn: false, wxid: nil, nickname: nil)))
            }
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenBotNodeError(code: .unavailable, message: error.localizedDescription))
        }

        switch command {
        case .probe:
            return BridgeInvokeResponse(
                id: req.id,
                ok: true,
                payloadJSON: try Self.encodeWechatJSON(await client.probe()))
        case .loginStart:
            do {
                let payload = try await client.loginStart()
                return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: try Self.encodeWechatJSON(payload))
            } catch {
                return BridgeInvokeResponse(
                    id: req.id,
                    ok: false,
                    error: OpenBotNodeError(code: .unavailable, message: error.localizedDescription))
            }
        case .loginWait:
            let timeoutMs = params.timeoutMs ?? 120_000
            return BridgeInvokeResponse(
                id: req.id,
                ok: true,
                payloadJSON: try Self.encodeWechatJSON(await client.loginWait(timeoutMs: timeoutMs)))
        case .logout:
            return BridgeInvokeResponse(
                id: req.id,
                ok: true,
                payloadJSON: try Self.encodeWechatJSON(await client.logout()))
        case .status:
            return BridgeInvokeResponse(
                id: req.id,
                ok: true,
                payloadJSON: try Self.encodeWechatJSON(await client.status()))
        case .sendText:
            guard let to = params.to, let text = params.text else {
                return BridgeInvokeResponse(
                    id: req.id,
                    ok: false,
                    error: OpenBotNodeError(
                        code: .invalidRequest,
                        message: "INVALID_REQUEST: to and text required"))
            }
            do {
                let payload = try await client.sendText(to: to, text: text)
                return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: try Self.encodeWechatJSON(payload))
            } catch {
                return BridgeInvokeResponse(
                    id: req.id,
                    ok: false,
                    error: OpenBotNodeError(code: .unavailable, message: error.localizedDescription))
            }
        }
    }

    private nonisolated static func decodeWechatParams(_ json: String?) -> WechatInvokeParams {
        guard let json, let data = json.data(using: .utf8) else {
            return WechatInvokeParams(accountId: nil, force: nil, timeoutMs: nil, to: nil, text: nil)
        }
        return (try? JSONDecoder().decode(WechatInvokeParams.self, from: data))
            ?? WechatInvokeParams(accountId: nil, force: nil, timeoutMs: nil, to: nil, text: nil)
    }

    private nonisolated static func encodeWechatJSON(_ obj: some Encodable) throws -> String {
        let data = try JSONEncoder().encode(obj)
        guard let json = String(data: data, encoding: .utf8) else {
            throw WechatPersonalSidecarError.invalidJSON
        }
        return json
    }
}
