# HTML APK Studio — 5 Page Edition

1. Get Code — HTML + app identity
2. Icon — upload custom app icon
3. Permissions — Android permissions
4. Colours — system colours and WebView settings
5. Build — background Gradle job, live logs, APK download

Deploy as a Render Docker Web Service. Test `/health` after deployment.


## Fix in v5.0.1
Default icon is read from public/default-icon.png; no undefined png() dependency.
