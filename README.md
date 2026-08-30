# HTML APK Studio v5

Render-ready HTML-to-APK builder using Android SDK command-line tools directly.

Build pipeline: javac -> JAR -> D8 -> AAPT2 -> zipalign -> apksigner.

No Gradle daemon is used for user builds.

Deploy as a Docker Web Service and test `/health` after deployment.
