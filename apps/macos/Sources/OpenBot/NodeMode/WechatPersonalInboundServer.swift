import Foundation
import Network

enum WechatPersonalInbound {
    static let eventName = "wechat.personal.inbound"
    static let defaultPort: UInt16 = 18789
    static let defaultPath = "/webhook/wechat"
}

final class WechatPersonalInboundServer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ai.openbot.wechat.inbound")
    private var listener: NWListener?
    private let path: String
    private let onPayload: @Sendable (String) async -> Void

    init(
        port: UInt16 = WechatPersonalInbound.defaultPort,
        path: String = WechatPersonalInbound.defaultPath,
        onPayload: @escaping @Sendable (String) async -> Void) throws
    {
        self.path = WechatPersonalInboundServer.normalizePath(path)
        self.onPayload = onPayload
        let tcp = NWProtocolTCP.Options()
        let params = NWParameters(tls: nil, tcp: tcp)
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: port) ?? 18789)
        let listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        self.listener = listener
    }

    func start() {
        self.listener?.start(queue: self.queue)
    }

    func stop() {
        self.listener?.cancel()
        self.listener = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: self.queue)
        self.receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if error != nil {
                connection.cancel()
                return
            }
            var next = buffer
            if let data, !data.isEmpty {
                next.append(data)
            }
            if let request = Self.parseHTTP(next) {
                Task { [onPayload = self.onPayload, path = self.path] in
                    let allowed = request.method == "POST" && Self.normalizePath(request.path) == path
                    if allowed, let body = request.body, !body.isEmpty {
                        await onPayload(body)
                    }
                    let status = allowed ? "200 OK" : (request.method == "POST" ? "404 Not Found" : "405 Method Not Allowed")
                    Self.respond(connection, status: status)
                }
                return
            }
            if isComplete {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: next)
        }
    }

    private static func respond(_ connection: NWConnection, status: String) {
        let body = "{\"ok\":true}"
        let payload = Data(
            "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                .utf8)
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func normalizePath(_ raw: String) -> String {
        let trimmed = raw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? raw
        if trimmed.isEmpty {
            return "/"
        }
        return trimmed.hasPrefix("/") ? trimmed : "/\(trimmed)"
    }

    private static func parseHTTP(_ data: Data) -> (method: String, path: String, body: String?)? {
        guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }
        let headerData = data.subdata(in: data.startIndex ..< headerEnd.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }
        let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let requestLine = lines.first else {
            return nil
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            return nil
        }
        let method = String(parts[0]).uppercased()
        let path = String(parts[1])
        var contentLength = 0
        for line in lines.dropFirst() {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                let raw = line.split(separator: ":", maxSplits: 1).last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? "0"
                contentLength = Int(raw) ?? 0
            }
        }
        let bodyStart = headerEnd.upperBound
        let available = data.count - bodyStart
        if available < contentLength {
            return nil
        }
        let body: String?
        if contentLength > 0 {
            let slice = data.subdata(in: bodyStart ..< (bodyStart + contentLength))
            body = String(data: slice, encoding: .utf8)
        } else {
            body = nil
        }
        return (method, path, body)
    }
}
