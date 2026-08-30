# HTML APK Studio v7

A multi-page HTML-to-Android APK builder.

## Pages
1. Code — paste HTML or import an HTML file; app name, package, version and version code are auto-normalized.
2. Icon — default heart icon on white; import PNG/JPG/WEBP.
3. Permissions — choose Android permissions.
4. Colours — white defaults plus orientation and WebView options.
5. Build — direct javac → D8 → AAPT2 → zipalign → apksigner pipeline with an isolated scrollable live log.

## Deploy
Run `npm install` and `npm start`, or deploy with the included Dockerfile. The container installs Android SDK Platform 35 and Build Tools 35.0.0.
