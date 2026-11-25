import Foundation

/// One event as it leaves the app.
public struct StatsEvent: Equatable, Sendable {
    public let name: String
    public let props: [String: String]
    /// Milliseconds since the session began.
    public let at: Int

    public init(name: String, props: [String: String], at: Int) {
        self.name = name
        self.props = props
        self.at = at
    }
}

/// Delivers a batch of events; `HTTPStatsTransport` is the real one.
@MainActor
public protocol StatsTransport: AnyObject {
    func send(session: String, events: [StatsEvent])
}

/// Anonymous usage counts: what screens and taps happen, never what's in them.
///
/// No identifier is stored: `session` is random per launch and lives in memory only. Events
/// wait in memory and a failed send loses them; nothing is written to disk.
///
/// Subclass it to add an app's own events, each a small function calling `send`, so that all
/// names and values come from one reviewable place. Never send file or repository names,
/// logins, free text, keys or URLs.
@MainActor
open class StatsCollector {
    public typealias Event = StatsEvent

    public static let batchSize = 50

    public let session = UUID().uuidString
    public var transport: StatsTransport?
    public private(set) var buffer: [Event] = []
    private let enabled: () -> Bool
    private let started = Date()

    public init(enabled: @escaping () -> Bool) {
        self.enabled = enabled
    }

    /// Kept in memory until `flush()` or until `batchSize` events wait.
    public func send(_ name: String, _ props: [String: String]) {
        guard enabled() else { return }
        buffer.append(Event(name: name, props: props, at: Int(Date().timeIntervalSince(started) * 1000)))
        if buffer.count >= Self.batchSize { flush() }
    }

    /// Hands the batch over. Call it when the app goes to the background.
    public func flush() {
        guard !buffer.isEmpty else { return }
        let batch = buffer
        buffer.removeAll()
        transport?.send(session: session, events: batch)
    }
}
