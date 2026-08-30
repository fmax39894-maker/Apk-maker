FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV GRADLE_BIN=/opt/gradle/bin/gradle
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/gradle/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk wget unzip zip curl ca-certificates nodejs npm git \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmd.zip \
    && unzip -q /tmp/cmd.zip -d "$ANDROID_HOME/cmdline-tools" \
    && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
    && rm /tmp/cmd.zip \
    && yes | sdkmanager --licenses >/dev/null 2>&1 || true \
    && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

RUN wget -q https://services.gradle.org/distributions/gradle-8.7-bin.zip -O /tmp/gradle.zip \
    && unzip -q /tmp/gradle.zip -d /opt \
    && mv /opt/gradle-8.7 /opt/gradle \
    && rm /tmp/gradle.zip

# Warm the Android Gradle Plugin cache during image build.
RUN mkdir -p /opt/gradle-cache/app/src/main/java/com/warmup \
    && printf '%s\n' \
'import org.gradle.api.initialization.resolve.RepositoriesMode' \
'' \
'pluginManagement {' \
'    repositories { google(); mavenCentral(); gradlePluginPortal() }' \
'}' \
'' \
'dependencyResolutionManagement {' \
'    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)' \
'    repositories { google(); mavenCentral() }' \
'}' \
'' \
'rootProject.name = "Warmup"' \
'include(":app")' > /opt/gradle-cache/settings.gradle.kts \
    && printf '%s\n' 'plugins { id("com.android.application") version "8.6.1" apply false }' > /opt/gradle-cache/build.gradle.kts \
    && printf '%s\n' 'plugins { id("com.android.application") }' 'android { namespace = "com.warmup"; compileSdk = 35; defaultConfig { applicationId = "com.warmup"; minSdk = 23; targetSdk = 35; versionCode = 1; versionName = "1.0" } }' > /opt/gradle-cache/app/build.gradle.kts \
    && /opt/gradle/bin/gradle --no-daemon --console=plain -p /opt/gradle-cache help \
    && rm -rf /opt/gradle-cache

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 10000
CMD ["node","server.js"]
