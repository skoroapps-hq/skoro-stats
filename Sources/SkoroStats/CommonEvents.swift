import Foundation

public enum StatsPurchaseOutcome: String, Sendable {
    case purchased, pending, cancelled, failed
}

public enum StatsRestoreOutcome: String, Sendable {
    case restored, nothing, failed
}

/// The events every app shares; the server's `schemas/common.json` must agree (tests check).
/// `*` is a token from a fixed list in the app's code, `^[A-Za-z0-9_.]{1,64}$`.
extension StatsCollector {
    public nonisolated static let commonEvents: [String: [String: Set<String>]] = [
        "first_run": ["kind": ["*"]],
        "onboarding_step": ["step": ["*"]],
        "paywall_shown": ["context": ["*"]],
        "paywall_closed": ["context": ["*"], "seconds": ["0-3", "3-10", "10-30", "30+"]],
        "purchase": ["product": ["*"], "context": ["*"], "outcome": ["purchased", "pending", "cancelled", "failed"]],
        "restore": ["outcome": ["restored", "nothing", "failed"]],
        "trial_reminder": ["on": ["0", "1"]],
        "locked_tap": ["feature": ["*"]],
        "review_prompt": ["trigger": ["*"]],
        "session_start": ["days": ["0", "1", "2-7", "8-30", "31+"]],
    ]

    /// At launch, with the days since install as a bucket: the dashboard's "returning" section.
    /// An app's own launch facts go in `more`; its schema then lists them, and `days`, under
    /// its own `session_start`.
    public func sessionStart(daysSinceInstall days: Int, _ more: [String: String] = [:]) {
        send("session_start", more.merging(["days": Self.daysBucket(days)]) { _, bucket in bucket })
    }

    /// 0, 1, 2-7, 8-30 or 31+: whole days since install, never the date itself.
    public nonisolated static func daysBucket(_ days: Int) -> String {
        switch days {
        case ..<1: "0"
        case 1: "1"
        case 2...7: "2-7"
        case 8...30: "8-30"
        default: "31+"
        }
    }

    public func firstRun(_ kind: String) { send("first_run", ["kind": kind]) }
    public func onboardingStep(_ step: String) { send("onboarding_step", ["step": step]) }
    public func paywallShown(context: String) { send("paywall_shown", ["context": context]) }

    /// How long it stayed open goes as a bucket; the batch leaves at once.
    public func paywallClosed(context: String, after seconds: TimeInterval) {
        let bucket = seconds < 3 ? "0-3" : seconds < 10 ? "3-10" : seconds < 30 ? "10-30" : "30+"
        send("paywall_closed", ["context": context, "seconds": bucket])
        flush()
    }

    public func purchase(product: String, context: String, outcome: StatsPurchaseOutcome) {
        send("purchase", ["product": product, "context": context, "outcome": outcome.rawValue])
        flush()
    }

    public func restore(_ outcome: StatsRestoreOutcome) { send("restore", ["outcome": outcome.rawValue]) }
    public func trialReminder(_ on: Bool) { send("trial_reminder", ["on": on ? "1" : "0"]) }
    public func lockedTap(feature: String) { send("locked_tap", ["feature": feature]) }
    public func reviewPrompt(_ trigger: String) { send("review_prompt", ["trigger": trigger]) }
}
