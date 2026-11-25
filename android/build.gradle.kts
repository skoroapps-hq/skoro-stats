plugins {
    kotlin("jvm") version "2.3.21"
    id("com.vanniktech.maven.publish") version "0.37.0"
}

group = "com.skoroapps"
// The repo's release tag (shared with the Swift package): `-Pversion=2.0.1`, set by the release workflow.
version = providers.gradleProperty("version").getOrElse("0.0.0-SNAPSHOT")

// Bytecode for Java 17, the Android apps' target, whatever JDK builds it.
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
java { targetCompatibility = JavaVersion.VERSION_17 }

dependencies { testImplementation("junit:junit:4.13.2") }

tasks.test { useJUnit() }

// Maven Central (com.skoroapps:skoro-stats). Credentials and the signing key come from the
// environment in the release workflow: ORG_GRADLE_PROJECT_mavenCentralUsername / …Password,
// ORG_GRADLE_PROJECT_signingInMemoryKey / …KeyPassword.
mavenPublishing {
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()
    coordinates("com.skoroapps", "skoro-stats", version.toString())
    pom {
        name.set("skoro-stats")
        description.set("Privacy-first usage statistics for Android apps: allowlisted, anonymous events sent to your own Cloudflare Worker.")
        inceptionYear.set("2026")
        url.set("https://github.com/skoroapps-hq/skoro-stats")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://opensource.org/licenses/MIT")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("skoroapps")
                name.set("skoroapps")
                url.set("https://github.com/skoroapps-hq")
            }
        }
        scm {
            url.set("https://github.com/skoroapps-hq/skoro-stats")
            connection.set("scm:git:https://github.com/skoroapps-hq/skoro-stats.git")
            developerConnection.set("scm:git:ssh://git@github.com/skoroapps-hq/skoro-stats.git")
        }
    }
}

// Also GitHub Packages, which the skoroapps apps read from until they move to Maven Central.
publishing {
    repositories {
        maven("https://maven.pkg.github.com/skoroapps-hq/skoro-stats") {
            name = "GitHubPackages"
            credentials {
                username = System.getenv("GITHUB_ACTOR")
                password = System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
