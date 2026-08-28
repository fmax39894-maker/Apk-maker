const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 10000);
const ROOT = path.join(os.tmpdir(), "html-apk-maker-v2");
fs.mkdirSync(ROOT, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Advanced HTML APK Maker",
    time: new Date().toISOString(),
    androidHome: process.env.ANDROID_HOME || null,
    gradle: process.env.GRADLE_BIN || "/opt/gradle/bin/gradle"
  });
});

function clean(s, max=120) {
  return String(s ?? "").trim().slice(0, max);
}
function pkgName(value) {
  let p = clean(value, 120).toLowerCase()
    .replace(/[^a-z0-9._]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  let parts = p.split(".").filter(Boolean)
    .map(x => x.replace(/^[^a-z]+/, ""))
    .filter(Boolean);

  if (!parts.length) parts = ["app"];
  if (parts.length === 1) parts = ["com", "htmlapk", parts[0]];
  if (parts[0] === "com" && parts.length < 3) parts.splice(1, 0, "htmlapk");

  p = parts.join(".");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(p)) p = "com.htmlapk.app";
  return p.slice(0, 120);
}
function xml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function run(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {
      cwd, maxBuffer: 30 * 1024 * 1024, timeout: 10 * 60 * 1000
    });
    if (child.stdout) child.stdout.on("data", d => onLine?.(String(d)));
    if (child.stderr) child.stderr.on("data", d => onLine?.(String(d)));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}`)));
  });
}
function manifest(m) {
  const map = {
    INTERNET:"android.permission.INTERNET",
    CAMERA:"android.permission.CAMERA",
    RECORD_AUDIO:"android.permission.RECORD_AUDIO",
    ACCESS_FINE_LOCATION:"android.permission.ACCESS_FINE_LOCATION",
    ACCESS_COARSE_LOCATION:"android.permission.ACCESS_COARSE_LOCATION",
    READ_MEDIA_IMAGES:"android.permission.READ_MEDIA_IMAGES",
    POST_NOTIFICATIONS:"android.permission.POST_NOTIFICATIONS",
    VIBRATE:"android.permission.VIBRATE"
  };
  const perms = (m.permissions || []).filter(x => map[x])
    .map(x => `    <uses-permission android:name="${map[x]}"/>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${perms}
    <application
        android:allowBackup="true"
        android:label="${xml(m.appName)}"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="${m.cleartext}">
        <activity
            android:name=".MainActivity"
            android:screenOrientation="${xml(m.orientation)}"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>`;
}
function mainJava(m) {
  const runtime = {
    CAMERA:"Manifest.permission.CAMERA",
    RECORD_AUDIO:"Manifest.permission.RECORD_AUDIO",
    ACCESS_FINE_LOCATION:"Manifest.permission.ACCESS_FINE_LOCATION",
    ACCESS_COARSE_LOCATION:"Manifest.permission.ACCESS_COARSE_LOCATION",
    READ_MEDIA_IMAGES:"Manifest.permission.READ_MEDIA_IMAGES",
    POST_NOTIFICATIONS:"Manifest.permission.POST_NOTIFICATIONS"
  };
  const selected = (m.permissions || []).filter(x => runtime[x]);
  const arr = selected.map(x => runtime[x]).join(",");

  return `package ${m.pkg};

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.*;
import android.graphics.Color;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> uploadCallback;
    private static final int FILE_REQUEST = 900;
    private static final int PERMISSION_REQUEST = 901;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setBuiltInZoomControls(${m.zoom});
        s.setDisplayZoomControls(false);

        web.setBackgroundColor(Color.parseColor("${m.bg}"));
        web.setWebViewClient(new WebViewClient());

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                uploadCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                } catch (Exception e) {
                    uploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        requestSelectedPermissions();
    }

    private void requestSelectedPermissions() {
        if (Build.VERSION.SDK_INT >= 23) {
            String[] selected = new String[]{${arr}};
            java.util.ArrayList<String> ask = new java.util.ArrayList<>();
            for (String p : selected) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) ask.add(p);
            }
            if (!ask.isEmpty())
                requestPermissions(ask.toArray(new String[0]), PERMISSION_REQUEST);
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && uploadCallback != null) {
            Uri[] resultUris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getData() != null) {
                    resultUris = new Uri[]{data.getData()};
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    resultUris = new Uri[n];
                    for (int i = 0; i < n; i++)
                        resultUris[i] = data.getClipData().getItemAt(i).getUri();
                }
            }
            uploadCallback.onReceiveValue(resultUris);
            uploadCallback = null;
        }
    }

    @Override public void onBackPressed() {
        if (${m.back} && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}`;
}
function filesFor(m, html) {
  const pp = m.pkg.replace(/\./g, "/");
  return {
    "settings.gradle.kts": `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name="${m.projectName}"
include(":app")`,
    "build.gradle.kts": `plugins { id("com.android.application") version "8.6.1" apply false }`,
    "gradle.properties": `org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8
android.useAndroidX=true
`,
    "app/build.gradle.kts": `plugins { id("com.android.application") }
android {
    namespace="${m.pkg}"
    compileSdk=35
    defaultConfig {
        applicationId="${m.pkg}"
        minSdk=${m.minSdk}
        targetSdk=35
        versionCode=${m.versionCode}
        versionName="${xml(m.version)}"
    }
}`,
    "app/src/main/AndroidManifest.xml": manifest(m),
    [`app/src/main/java/${pp}/MainActivity.java`]: mainJava(m),
    "app/src/main/res/values/styles.xml":
`<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">
<item name="android:statusBarColor">${m.statusBar}</item>
<item name="android:navigationBarColor">${m.navBar}</item>
<item name="android:windowLightStatusBar">${!m.dark}</item>
</style></resources>`,
    "app/src/main/assets/index.html": html
  };
}
async function writeAll(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(base, rel);
    await fsp.mkdir(path.dirname(p), {recursive:true});
    await fsp.writeFile(p, content);
  }
}

app.post("/build", upload.single("html"), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let job;
  const started = Date.now();

  try {
    if (!req.file) return res.status(400).json({ok:false,error:"Choose an index.html file first."});

    let permissions = [];
    try { permissions = JSON.parse(req.body.permissions || "[]"); }
    catch { permissions = []; }

    const appName = clean(req.body.appName, 80) || "My HTML App";
    const m = {
      appName,
      pkg: pkgName(req.body.packageName || appName),
      version: /^[0-9]+(?:\\.[0-9]+){0,3}$/.test(req.body.version || "") ? req.body.version : "1.0.0",
      versionCode: Math.max(1, parseInt(req.body.versionCode || "1", 10) || 1),
      orientation: ["portrait","landscape","unspecified"].includes(req.body.orientation) ? req.body.orientation : "portrait",
      minSdk: [23,26,28].includes(Number(req.body.minSdk)) ? Number(req.body.minSdk) : 23,
      bg: /^#[0-9a-f]{6}$/i.test(req.body.bg || "") ? req.body.bg : "#0b1020",
      statusBar: /^#[0-9a-f]{6}$/i.test(req.body.statusBar || "") ? req.body.statusBar : "#0b1020",
      navBar: /^#[0-9a-f]{6}$/i.test(req.body.navBar || "") ? req.body.navBar : "#000000",
      dark: req.body.dark === "true",
      zoom: req.body.zoom === "true",
      back: req.body.back !== "false",
      cleartext: req.body.cleartext === "true",
      permissions,
      projectName: "HTMLAPK_" + crypto.randomBytes(5).toString("hex")
    };

    job = path.join(ROOT, m.projectName);
    await fsp.mkdir(job, {recursive:true});
    await writeAll(job, filesFor(m, req.file.buffer.toString("utf8")));

    const gradle = process.env.GRADLE_BIN || "/opt/gradle/bin/gradle";
    console.log(`[BUILD] ${m.projectName} starting: ${m.pkg}`);

    await run(gradle, ["--no-daemon", "--stacktrace", "--console=plain", "assembleDebug"], job,
      line => console.log(`[GRADLE ${m.projectName}] ${line.trimEnd()}`));

    const apk = path.join(job, "app/build/outputs/apk/debug/app-debug.apk");
    await fsp.access(apk);

    const id = crypto.randomBytes(18).toString("hex");
    const finalApk = path.join(ROOT, id + ".apk");
    await fsp.copyFile(apk, finalApk);

    console.log(`[BUILD] ${m.projectName} SUCCESS in ${Date.now()-started}ms`);
    res.json({
      ok:true,
      appName:m.appName,
      packageName:m.pkg,
      seconds:Math.round((Date.now()-started)/100)/10,
      download:`/download/${id}`
    });
  } catch (err) {
    const details = String(err?.message || err).slice(-6000);
    console.error(`[BUILD] FAILED after ${Date.now()-started}ms`, err);
    res.status(500).json({
      ok:false,
      error:"The Android build failed on the server.",
      details,
      hint:"Open Render → Logs and look for lines beginning with [BUILD] or [GRADLE]."
    });
  } finally {
    if (job) setTimeout(() => fsp.rm(job,{recursive:true,force:true}).catch(()=>{}), 45000);
  }
});

app.get("/download/:id", (req,res) => {
  const id = req.params.id.replace(/[^a-f0-9]/g,"");
  const p = path.join(ROOT,id+".apk");
  if (!fs.existsSync(p)) return res.status(404).send("APK expired or not found.");
  res.download(p, "my-html-app-debug.apk", () => {
    setTimeout(() => fs.rm(p,{force:true},()=>{}), 60000);
  });
});

process.on("uncaughtException", e => console.error("[FATAL]",e));
process.on("unhandledRejection", e => console.error("[UNHANDLED]",e));

app.listen(PORT, "0.0.0.0", () => console.log(`HTML APK Maker listening on 0.0.0.0:${PORT}`));
