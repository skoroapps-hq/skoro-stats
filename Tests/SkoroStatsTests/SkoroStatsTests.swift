import XCTest
@testable import SkoroStats

@MainActor
final class SkoroStatsTests: XCTestCase {
    private final class Recording: StatsTransport {
        var batches: [[StatsEvent]] = []
        func send(session: String, events: [StatsEvent]) { batches.append(events) }
    }

    private func collector(enabled: Bool = true) -> (StatsCollector, Recording) {
        let stats = StatsCollector(enabled: { enabled })
        let transport = Recording()
        stats.transport = transport
        return (stats, transport)
    }

    func testCommonEventsSendOnlyAllowedKeysAndValues() throws {
        let (stats, transport) = collector()
        stats.firstRun("onboarding")
        stats.onboardingStep("welcome")
        stats.paywallShown(context: "settings")
        stats.paywallClosed(context: "settings", after: 42)
        stats.purchase(product: "yearly", context: "settings", outcome: .pending)
        stats.restore(.nothing)
        stats.trialReminder(false)
        stats.lockedTap(feature: "merge")
        stats.reviewPrompt("write")
        stats.sessionStart(daysSinceInstall: 3)
        stats.flush()
        let events = transport.batches.flatMap { $0 }
        XCTAssertEqual(Set(events.map(\.name)), Set(StatsCollector.commonEvents.keys))
        for event in events {
            let allowed = try XCTUnwrap(StatsCollector.commonEvents[event.name])
            XCTAssertEqual(Set(event.props.keys), Set(allowed.keys), event.name)
            for (key, value) in event.props {
                let values = try XCTUnwrap(allowed[key])
                XCTAssertTrue(values == ["*"] || values.contains(value), "\(event.name).\(key)=\(value)")
            }
        }
        XCTAssertEqual(events.first { $0.name == "paywall_closed" }?.props["seconds"], "30+")
    }

    func testPaywallCloseAndPurchaseLeaveAtOnce() {
        let (stats, transport) = collector()
        stats.paywallClosed(context: "a", after: 1)
        XCTAssertEqual(transport.batches.count, 1)
        stats.purchase(product: "p", context: "a", outcome: .failed)
        XCTAssertEqual(transport.batches.count, 2)
        XCTAssertTrue(stats.buffer.isEmpty)
    }

    func testOffSendsNothing() {
        let (stats, transport) = collector(enabled: false)
        stats.send("x", [:])
        stats.flush()
        XCTAssertTrue(stats.buffer.isEmpty)
        XCTAssertTrue(transport.batches.isEmpty)
    }

    func testFullBatchFlushes() {
        let (stats, transport) = collector()
        for _ in 0..<StatsCollector.batchSize { stats.send("x", [:]) }
        XCTAssertEqual(transport.batches.first?.count, StatsCollector.batchSize)
        XCTAssertTrue(stats.buffer.isEmpty)
    }

    func testSubclassAddsItsOwnEvents() {
        final class AppStats: StatsCollector {
            func levelWon() { send("level_won", [:]) }
        }
        let stats = AppStats(enabled: { true })
        stats.levelWon()
        stats.firstRun("onboarding")
        XCTAssertEqual(stats.buffer.map(\.name), ["level_won", "first_run"])
    }

    func testPayloadMatchesWhatTheServerAccepts() throws {
        let events = [StatsEvent(name: "paywall_shown", props: ["context": "feature.merge"], at: 1200)]
        let data = try XCTUnwrap(HTTPStatsTransport.payload(app: "demo", session: UUID().uuidString, events: events, tier: .none,
                                                            version: "3.0", build: "3.0.0", os: "18", language: "UK", device: "ipad"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        // The same patterns as `server/src/ingest.js` (FIELDS).
        let patterns = ["v": "^[0-9][0-9.]{0,15}$", "build": "^[0-9][0-9.]{0,15}$", "os": "^[0-9]{1,3}$",
                        "lang": "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$", "pro": "^(free|trial|pro|legacy|none)$",
                        "session": "^[0-9A-Fa-f-]{36}$", "device": "^(iphone|ipad|other)$"]
        for (field, pattern) in patterns {
            let value = try XCTUnwrap(body[field] as? String, field)
            XCTAssertNotNil(value.range(of: pattern, options: .regularExpression), "\(field)=\(value)")
        }
        XCTAssertEqual(body["app"] as? String, "demo")
        let event = try XCTUnwrap((body["events"] as? [[String: Any]])?.first)
        XCTAssertEqual(event["n"] as? String, "paywall_shown")
        XCTAssertEqual(event["t"] as? Int, 1200)
    }

    func testEveryTierIsOneTheServerAccepts() {
        XCTAssertEqual(StatsTier.allCases.map(\.rawValue), ["free", "trial", "pro", "legacy", "none"])
    }

    func testCommonEventsMatchTheServer() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("server/schemas/common.json")
        let schema = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: [String: Any]])
        XCTAssertEqual(Set(schema.keys), Set(StatsCollector.commonEvents.keys))
        for (name, props) in StatsCollector.commonEvents {
            let server = try XCTUnwrap(schema[name], name)
            XCTAssertEqual(Set(server.keys), Set(props.keys), name)
            for (key, values) in props {
                if values == ["*"] { XCTAssertEqual(server[key] as? String, "*", "\(name).\(key)") }
                else { XCTAssertEqual(Set(server[key] as? [String] ?? []), values, "\(name).\(key)") }
            }
        }
    }

    func testDaysSinceInstallGoInBuckets() {
        XCTAssertEqual([-1, 0, 1, 2, 7, 8, 30, 31, 400].map(StatsCollector.daysBucket), ["0", "0", "1", "2-7", "2-7", "8-30", "8-30", "31+", "31+"])
    }

    func testSessionStartKeepsTheAppsOwnFactsAndTheBucket() throws {
        let (stats, transport) = collector()
        stats.sessionStart(daysSinceInstall: 12, ["worlds": "2+", "days": "bogus"])
        stats.flush()
        let event = try XCTUnwrap(transport.batches.first?.first)
        XCTAssertEqual(event.props, ["worlds": "2+", "days": "8-30"])
    }
}
