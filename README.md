# HTML APK Studio Pro V4

## Render
Deploy as a Docker Web Service.

- Dockerfile: included
- Port: 10000
- Health endpoint: /health
- Start command: not required

The home page has two choices: Paste Code and Import HTML File.
App creation opens on `/create` as a separate page and supports an app icon upload.

The Docker image pre-warms the Android Gradle Plugin cache during image build. Runtime builds use a background job, so the browser does not wait on one long HTTP request.

Open `/health` after deployment before testing APK builds.
