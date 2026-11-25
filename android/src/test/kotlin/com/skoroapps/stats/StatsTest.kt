package com.skoroapps.stats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class StatsTest {
    private class Sink : StatsTransport {
        val batches = mutableListOf<List<StatsEvent>>()
        override fun send(session: String, events: List<StatsEvent>) { batches += events }
    }

    private fun collector(on: Boolean = true, sink: Sink = Sink()) = StatsCollector({ on }, clock = { 1000L }).also { it.transport = sink }

    @Test fun disabledSendsNothing() {
        val sink = Sink()
        val c = collector(false, sink)
        c.paywallShown("settings"); c.flush()
        assertTrue(c.buffer.isEmpty() && sink.batches.isEmpty())
    }

    @Test fun buffersUntilFlushAndPurchaseFlushesAtOnce() {
        val sink = Sink()
        val c = collector(sink = sink)
        c.paywallShown("settings")
        assertEquals(1, c.buffer.size)
        assertTrue(sink.batches.isEmpty())
        c.purchase("lifetime", "settings", PurchaseOutcome.Purchased)
        assertEquals(listOf("paywall_shown", "purchase"), sink.batches.single().map { it.name })
        assertTrue(c.buffer.isEmpty())
    }

    @Test fun fullBatchGoesOut() {
        val sink = Sink()
        val c = collector(sink = sink)
        repeat(StatsCollector.BATCH_SIZE) { c.lockedTap("worlds") }
        assertEquals(StatsCollector.BATCH_SIZE, sink.batches.single().size)
    }

    @Test fun buckets() {
        assertEquals(listOf("0", "0", "1", "2-7", "2-7", "8-30", "8-30", "31+"), listOf(-1, 0, 1, 2, 7, 8, 30, 31).map(StatsCollector::daysBucket))
        assertEquals(listOf("0-3", "3-10", "10-30", "30+"), listOf(2.9, 3.0, 10.0, 30.0).map(StatsCollector::secondsBucket))
    }

    @Test fun sessionStartKeepsOwnFacts() {
        val c = collector()
        c.sessionStart(5, mapOf("worlds" to "2+"))
        assertEquals(mapOf("worlds" to "2+", "days" to "2-7"), c.buffer.single().props)
    }

    @Test fun payloadShapeAndEscaping() {
        val json = HttpStatsTransport.payload("notes", "S", listOf(StatsEvent("x", mapOf("a" to "q\"\\\n"), 7)), "free", "1.0", "3", "14", "EN", "android")
        assertEquals(
            """{"app":"notes","v":"1.0","build":"3","os":"14","lang":"en","pro":"free","device":"android","session":"S","events":[{"n":"x","p":{"a":"q\"\\\u000a"},"t":7}]}""",
            json,
        )
    }

    @Test fun everyTierIsOneTheServerAccepts() {
        assertEquals(listOf("free", "trial", "pro", "legacy", "none"), StatsTier.entries.map { it.raw })
    }

    /** The server's schemas/common.json lists the same events and values as [COMMON_EVENTS]. */
    @Test fun commonEventsMatchServerSchema() {
        val text = File("../server/schemas/common.json").readText()
        for ((event, props) in COMMON_EVENTS) {
            val entry = Regex("\"$event\"\\s*:\\s*\\{([^}]*)\\}").find(text)?.groupValues?.get(1)
            assertTrue("common.json lacks $event", entry != null)
            for ((prop, values) in props) {
                val raw = Regex("\"$prop\"\\s*:\\s*(\"\\*\"|\\[[^\\]]*\\])").find(entry!!)?.groupValues?.get(1)
                assertTrue("common.json lacks $event.$prop", raw != null)
                val listed = if (raw == "\"*\"") setOf("*") else Regex("\"([^\"]*)\"").findAll(raw!!).map { it.groupValues[1] }.toSet()
                assertEquals("$event.$prop", values, listed)
            }
        }
        assertEquals(COMMON_EVENTS.size, Regex("^\\s*\"[a-z_]+\":", RegexOption.MULTILINE).findAll(text).count())
    }
}
