package com.skoroapps.stats

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** The app's paid state when a batch leaves; the dashboard filters and breaks down by it. */
enum class StatsTier(val raw: String) {
    Free("free"), Trial("trial"), Pro("pro"),
    /** Paid under an earlier model (a one-time purchase before a subscription, say). */
    Legacy("legacy"),
    /** An app with nothing to buy. */
    None("none"),
}

/**
 * Sends batches to your skoro-stats ingest Worker on a background thread. A failed send is dropped.
 *
 * [app] is the app's name in the server's `src/apps.js`, [key] its value in `APP_KEYS` (it ships in the app, so it isn't a
 * secret). [endpoint] is your ingest Worker's `/v1/events`, e.g. `https://stats.example.com/v1/events`; prefer a custom
 * domain, `*.workers.dev` is blocked in mainland China.
 */
class HttpStatsTransport(
    private val app: String,
    private val key: String,
    private val endpoint: String,
    private val version: String,
    private val build: String,
    private val os: String,
    private val language: () -> String,
    private val device: () -> String,
    private val tier: () -> StatsTier = { StatsTier.None },
) : StatsTransport {
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "skoro-stats").apply { isDaemon = true } }

    override fun send(session: String, events: List<StatsEvent>) {
        val body = payload(app, session, events, tier().raw, version, build, os, language(), device())
        worker.execute {
            try {
                val c = URL(endpoint).openConnection() as HttpURLConnection
                try {
                    c.requestMethod = "POST"
                    c.connectTimeout = 15_000
                    c.readTimeout = 15_000
                    c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/json")
                    c.setRequestProperty("X-Stats-Key", key)
                    c.outputStream.use { it.write(body.toByteArray()) }
                    c.responseCode // the answer is not used; a failure drops the batch
                } finally {
                    c.disconnect()
                }
            } catch (_: Exception) {
            }
        }
    }

    companion object {
        /** `android` or `android_tablet`; the server accepts these next to iphone/ipad/other. */
        const val PHONE = "android"
        const val TABLET = "android_tablet"

        /** What the server expects (`POST /v1/events`). */
        fun payload(app: String, session: String, events: List<StatsEvent>, tier: String, version: String, build: String,
                    os: String, language: String, device: String): String = buildString {
            append('{')
            field("app", app); append(',')
            field("v", version); append(',')
            field("build", build); append(',')
            field("os", os); append(',')
            field("lang", language.lowercase()); append(',')
            field("pro", tier); append(',')
            field("device", device); append(',')
            field("session", session); append(',')
            append("\"events\":[")
            events.forEachIndexed { i, e ->
                if (i > 0) append(',')
                append("{\"n\":"); quote(e.name); append(",\"p\":{")
                e.props.entries.forEachIndexed { j, (k, v) ->
                    if (j > 0) append(',')
                    quote(k); append(':'); quote(v)
                }
                append("},\"t\":").append(e.at).append('}')
            }
            append("]}")
        }

        private fun StringBuilder.field(name: String, value: String) { quote(name); append(':'); quote(value) }

        private fun StringBuilder.quote(s: String) {
            append('"')
            for (ch in s) when {
                ch == '"' -> append("\\\"")
                ch == '\\' -> append("\\\\")
                ch < ' ' -> append("\\u%04x".format(ch.code))
                else -> append(ch)
            }
            append('"')
        }
    }
}
