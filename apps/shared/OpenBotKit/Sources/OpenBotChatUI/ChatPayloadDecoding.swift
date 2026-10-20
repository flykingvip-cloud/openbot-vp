import OpenBotKit

enum ChatPayloadDecoding {
    /// Must stay the GatewayPayloadDecoding JSON round-trip: encode `payload`, then decode `T`.
    static func decode<T: Decodable>(_ payload: AnyCodable, as type: T.Type = T.self) throws -> T {
        return try GatewayPayloadDecoding.decode(payload, as: type)
    }
}
