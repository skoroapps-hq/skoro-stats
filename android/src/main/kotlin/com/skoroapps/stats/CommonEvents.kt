package com.skoroapps.stats

enum class PurchaseOutcome(val raw: String) { Purchased("purchased"), Pending("pending"), Cancelled("cancelled"), Failed("failed") }

enum class RestoreOutcome(val raw: String) { Restored("restored"), Nothing("nothing"), Failed("failed") }

/**
 * The events every app shares; the server's `schemas/common.json` must agree (a test checks).
 * `*` is a token from a fixed list in the app's code, `^[A-Za-z0-9_.]{1,64}$`.
 */
val COMMON_EVENTS: Map<String, Map<String, Set<String>>> = mapOf(
    "first_run" to mapOf("kind" to setOf("*")),
    "onboarding_step" to mapOf("step" to setOf("*")),
    "paywall_shown" to mapOf("context" to setOf("*")),
    "paywall_closed" to mapOf("context" to setOf("*"), "seconds" to setOf("0-3", "3-10", "10-30", "30+")),
    "purchase" to mapOf("product" to setOf("*"), "context" to setOf("*"), "outcome" to setOf("purchased", "pending", "cancelled", "failed")),
    "restore" to mapOf("outcome" to setOf("restored", "nothing", "failed")),
    "trial_reminder" to mapOf("on" to setOf("0", "1")),
    "locked_tap" to mapOf("feature" to setOf("*")),
    "review_prompt" to mapOf("trigger" to setOf("*")),
    "session_start" to mapOf("days" to setOf("0", "1", "2-7", "8-30", "31+")),
)

/**
 * At launch, with the days since install as a bucket: the dashboard's "returning" section. An app's own launch facts go
 * in [more]; its schema then lists them, and `days`, under its own `session_start`.
 */
fun StatsCollector.sessionStart(daysSinceInstall: Int, more: Map<String, String> = emptyMap()) =
    send("session_start", more + ("days" to StatsCollector.daysBucket(daysSinceInstall)))

fun StatsCollector.firstRun(kind: String) = send("first_run", mapOf("kind" to kind))
fun StatsCollector.onboardingStep(step: String) = send("onboarding_step", mapOf("step" to step))
fun StatsCollector.paywallShown(context: String) = send("paywall_shown", mapOf("context" to context))

/** How long it stayed open goes as a bucket; the batch leaves at once. */
fun StatsCollector.paywallClosed(context: String, afterSeconds: Double) {
    send("paywall_closed", mapOf("context" to context, "seconds" to StatsCollector.secondsBucket(afterSeconds)))
    flush()
}

fun StatsCollector.purchase(product: String, context: String, outcome: PurchaseOutcome) {
    send("purchase", mapOf("product" to product, "context" to context, "outcome" to outcome.raw))
    flush()
}

fun StatsCollector.restore(outcome: RestoreOutcome) = send("restore", mapOf("outcome" to outcome.raw))
fun StatsCollector.trialReminder(on: Boolean) = send("trial_reminder", mapOf("on" to if (on) "1" else "0"))
fun StatsCollector.lockedTap(feature: String) = send("locked_tap", mapOf("feature" to feature))
fun StatsCollector.reviewPrompt(trigger: String) = send("review_prompt", mapOf("trigger" to trigger))
