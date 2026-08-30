# HTML APK Studio — Advanced 5 Page Builder

## Pages
1. Get Code — paste HTML/CSS/JS and configure app identity.
2. Icon — import PNG/JPG/WEBP app icon.
3. Permissions — choose Android permissions.
4. Colours — system/WebView colours and settings.
5. Build — background Gradle build with live logs and APK download.

## Render
Deploy as a **Docker Web Service**. The included Dockerfile installs OpenJDK 17, Android SDK 35/build-tools and Gradle 8.7. The app listens on Render's `PORT`.

Test `/health` after deployment.
