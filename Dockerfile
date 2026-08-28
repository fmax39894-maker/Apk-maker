FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV GRADLE_BIN=/opt/gradle/bin/gradle
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/gradle/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk wget unzip curl ca-certificates nodejs npm git \
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

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public

EXPOSE 10000
CMD ["node","server.js"]
