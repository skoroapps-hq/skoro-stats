package com.skoroapps.stats

import java.util.UUID

/** One event as it leaves the app. [at] is milliseconds since the session began. */
data class StatsEvent(val name: String, val props: Map<String, String>, val at: Long)

/** Delivers a batch of events; [HttpStatsTransport] is the real one. */
fun interface StatsTransport {
    fun send(session: String, events: List<StatsEvent>)
}

/**
 * Anonymous usage counts: what screens and taps happen, never what's in them. Port of the Swift `StatsCollector`.
 *
 * No identifier is stored: [session] is random per launch and lives in memory only. Events wait in memory and a failed
 * send loses them; nothing is written to disk.
 *
 * Subclass it to add an app's own events, each a small function calling [send], so that all names and values come from
 * one reviewable place. Never send file or repository names, logins, free text, keys or URLs.
 */
open class StatsCollector(
    private val enabled: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val session: String = UUID.randomUUID().toString()
    @Volatile var transport: StatsTransport? = null
    private val started = clock()
    private val pending = mutableListOf<StatsEvent>()

    /** The events waiting for [flush]. */
    val buffer: List<StatsEvent> get() = synchronized(pending) { pending.toList() }

    /** Kept in memory until [flush] or until [BATCH_SIZE] events wait. */
    fun send(name: String, props: Map<String, String> = emptyMap()) {
        if (!enabled()) return
        val full = synchronized(pending) {
            pending += StatsEvent(name, props, clock() - started)
            pending.size >= BATCH_SIZE
        }
        if (full) flush()
    }

    /** Hands the batch over. Call it when the app goes to the background. */
    fun flush() {
        val batch = synchronized(pending) { pending.toList().also { pending.clear() } }
        if (batch.isNotEmpty()) transport?.send(session, batch)
    }

    companion object {
        const val BATCH_SIZE = 50

        /** 0, 1, 2-7, 8-30 or 31+: whole days since install, never the date itself. */
        fun daysBucket(days: Int): String = when {
            days < 1 -> "0"
            days == 1 -> "1"
            days <= 7 -> "2-7"
            days <= 30 -> "8-30"
            else -> "31+"
        }

        fun secondsBucket(seconds: Double): String = when {
            seconds < 3 -> "0-3"
            seconds < 10 -> "3-10"
            seconds < 30 -> "10-30"
            else -> "30+"
        }
    }
}
