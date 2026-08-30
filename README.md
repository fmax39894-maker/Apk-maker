# HTML APK Studio Pro

Deploy the whole folder as a Render **Docker Web Service**. Use port 10000 and `/health` as health check. Do not add a custom start command.

The app has two source modes: Paste code and Import HTML. Builds run as background jobs, so the browser no longer waits on one long request. The UI polls the job and displays Gradle logs/errors. A successful build returns a real debug APK.

Open `/health` after deployment. It must return JSON with `"ok":true`.
