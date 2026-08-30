FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV GRADLE_BIN=/opt/gradle/bin/gradle
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/gradle/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk wget unzip ca-certificates nodejs npm git && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/android-sdk/cmdline-tools && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/sdk.zip && unzip -q /tmp/sdk.zip -d /opt/android-sdk/cmdline-tools && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest && rm /tmp/sdk.zip && yes | sdkmanager --licenses >/dev/null 2>&1 || true && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
RUN wget -q https://services.gradle.org/distributions/gradle-8.7-bin.zip -O /tmp/g.zip && unzip -q /tmp/g.zip -d /opt && mv /opt/gradle-8.7 /opt/gradle && rm /tmp/g.zip
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 10000
CMD ["node","server.js"]