plugins {
    kotlin("jvm") version "2.3.21"
    `maven-publish`
}

group = "com.skoroapps"
// The repo's release tag (shared with the Swift package): `-Pversion=1.2.0`, set by the release workflow.
version = providers.gradleProperty("version").getOrElse("0.0.0-SNAPSHOT")

// Bytecode for Java 17, the Android apps' target, whatever JDK builds it.
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
java {
    targetCompatibility = JavaVersion.VERSION_17
    withSourcesJar()
}

dependencies { testImplementation("junit:junit:4.13.2") }

tasks.test { useJUnit() }

publishing {
    publications {
        create<MavenPublication>("maven") {
            artifactId = "skoro-stats"
            from(components["java"])
        }
    }
    repositories {
        // GitHub Packages while the repo is private; Maven Central once it is open source.
        maven("https://maven.pkg.github.com/Skoruy/skoro-stats") {
            name = "GitHubPackages"
            credentials {
                username = System.getenv("GITHUB_ACTOR")
                password = System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
