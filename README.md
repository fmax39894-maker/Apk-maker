# HTML APK Studio v6

Multi-page HTML-to-APK builder for Render or another Linux server with Docker.

Pages:
1. Code
2. Icon
3. Permissions
4. Colours & settings
5. Build

The server uses Android SDK command-line tools directly (javac + D8 + AAPT2 + zipalign + apksigner) instead of invoking Gradle for the APK build.

Important: the generated AndroidManifest.xml includes the required `package` attribute, and the build pipeline passes a JAR to D8.
