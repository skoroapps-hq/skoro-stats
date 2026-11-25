import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The app's paid state when a batch leaves; the dashboard filters and breaks down by it.
public enum StatsTier: String, Sendable, CaseIterable {
    case free, trial, pro
    /// Paid under an earlier model (a one-time purchase before a subscription, say).
    case legacy
    /// An app with nothing to buy.
    case none
}

/// Sends batches to your skoro-stats ingest Worker. A failed send is dropped.
@MainActor
public final class HTTPStatsTransport: StatsTransport {
    private let app: String
    private let key: String
    private let endpoint: URL
    private let tier: () -> StatsTier

    /// - Parameters:
    ///   - app: the app's name in the server's `src/apps.js`.
    ///   - key: its value in `APP_KEYS`. It ships in the app, so it isn't a secret; it keeps
    ///     strangers' requests out and can be changed.
    ///   - endpoint: your ingest Worker's `/v1/events`, e.g. `https://stats.example.com/v1/events`.
    ///     Prefer a custom domain: `*.workers.dev` is blocked in mainland China.
    ///   - tier: the paid state when a batch leaves; `.none` for an app with nothing to buy.
    public init(app: String, key: String, endpoint: URL, tier: @escaping () -> StatsTier = { .none }) {
        self.app = app
        self.key = key
        self.endpoint = endpoint
        self.tier = tier
    }

    public func send(session: String, events: [StatsEvent]) {
        guard let body = Self.payload(app: app, session: session, events: events, tier: tier()) else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "X-Stats-Key")
        request.timeoutInterval = 15
        // Most batches go when the app leaves the screen: let this one finish.
        let background = BackgroundWork(name: "stats")
        URLSession.shared.dataTask(with: request) { _, _, _ in
            Task { @MainActor in background.end() }
        }.resume()
    }

    /// What the server expects.
    public static func payload(app: String, session: String, events: [StatsEvent], tier: StatsTier,
                               version: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
                               build: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
                               os: String = String(ProcessInfo.processInfo.operatingSystemVersion.majorVersion),
                               language: String = Locale.current.language.languageCode?.identifier ?? "und",
                               device: String? = nil) -> Data? {
        let body: [String: Any] = [
            "app": app, "v": version, "build": build, "os": os, "lang": language.lowercased(), "pro": tier.rawValue, "device": device ?? deviceName(),
            "session": session, "events": events.map { ["n": $0.name, "p": $0.props, "t": $0.at] as [String: Any] },
        ]
        return try? JSONSerialization.data(withJSONObject: body)
    }

    /// iphone, ipad or other (Mac, Vision, …).
    public static func deviceName() -> String {
        #if canImport(UIKit) && !os(watchOS)
        switch UIDevice.current.userInterfaceIdiom {
        case .phone: "iphone"
        case .pad: "ipad"
        default: "other"
        }
        #else
        "other"
        #endif
    }
}

/// Asks iOS for a little time in the background until `end()`.
@MainActor
private final class BackgroundWork {
    #if canImport(UIKit) && !os(watchOS)
    private var identifier: UIBackgroundTaskIdentifier = .invalid

    init(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
    #else
    init(name: String) {}
    func end() {}
    #endif
}
