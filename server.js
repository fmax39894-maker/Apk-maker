const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ROOT = path.join(os.tmpdir(), "html-apk-studio-v4");
fs.mkdirSync(ROOT, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 2
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "html") return cb(null, true);
    if (file.fieldname === "icon") {
      const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
      return cb(ok ? null : new Error("Icon must be PNG, JPG or WEBP."), ok);
    }
    cb(null, true);
  }
});

const jobs = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "HTML APK Studio Pro V4",
    androidHome: process.env.ANDROID_HOME || null,
    gradle: process.env.GRADLE_BIN || "/opt/gradle/bin/gradle"
  });
});

function clean(v, max = 100) {
  return String(v ?? "").trim().slice(0, max);
}

function validColor(v, fallback) {
  return /^#[0-9a-f]{6}$/i.test(v || "") ? v : fallback;
}

function packageName(v) {
  let p = clean(v).toLowerCase()
    .replace(/[^a-z0-9._]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  let parts = p.split(".")
    .filter(Boolean)
    .map(x => x.replace(/^[^a-z]+/, ""))
    .filter(Boolean);

  if (!parts.length) parts = ["app"];
  if (parts.length < 2) parts = ["com", "htmlapk", ...parts];

  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(parts.join("."))) {
    return "com.htmlapk.app";
  }
  return parts.join(".").slice(0, 120);
}

function xml(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function log(job, message, type = "info") {
  const line = `${new Date().toISOString().slice(11, 19)}  ${message}`;
  job.logs.push({ line, type });
  if (job.logs.length > 200) job.logs.shift();
  console.log(`[${job.id}] ${line}`);
}

async function writeFile(base, rel, data) {
  const target = path.join(base, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data);
}

function manifest(m) {
  const map = {
    INTERNET: "android.permission.INTERNET",
    CAMERA: "android.permission.CAMERA",
    RECORD_AUDIO: "android.permission.RECORD_AUDIO",
    ACCESS_FINE_LOCATION: "android.permission.ACCESS_FINE_LOCATION",
    ACCESS_COARSE_LOCATION: "android.permission.ACCESS_COARSE_LOCATION",
    READ_MEDIA_IMAGES: "android.permission.READ_MEDIA_IMAGES",
    POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS",
    VIBRATE: "android.permission.VIBRATE"
  };

  const permissions = (m.permissions || [])
    .filter(p => map[p])
    .map(p => `    <uses-permission android:name="${map[p]}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${permissions}
    <application
        android:allowBackup="true"
        android:label="${xml(m.appName)}"
        android:icon="@drawable/app_icon"
        android:roundIcon="@drawable/app_icon"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="${m.cleartext}">
        <activity
            android:name=".MainActivity"
            android:screenOrientation="${m.orientation}"
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
  const permissionMap = {
    CAMERA: "Manifest.permission.CAMERA",
    RECORD_AUDIO: "Manifest.permission.RECORD_AUDIO",
    ACCESS_FINE_LOCATION: "Manifest.permission.ACCESS_FINE_LOCATION",
    ACCESS_COARSE_LOCATION: "Manifest.permission.ACCESS_COARSE_LOCATION",
    READ_MEDIA_IMAGES: "Manifest.permission.READ_MEDIA_IMAGES",
    POST_NOTIFICATIONS: "Manifest.permission.POST_NOTIFICATIONS"
  };

  const requested = (m.permissions || [])
    .filter(p => permissionMap[p])
    .map(p => permissionMap[p]);

  const array = requested.length ? requested.join(",") : "";

  return `package ${m.pkg};

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.*;
import android.graphics.Color;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private static final int FILES = 77;
    private static final int PERMS = 78;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(${m.zoom});
        settings.setDisplayZoomControls(false);

        web.setBackgroundColor(Color.parseColor("${m.bg}"));
        web.setWebViewClient(new WebViewClient());

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params) {
                chooser = callback;
                try {
                    startActivityForResult(params.createIntent(), FILES);
                } catch (Exception e) {
                    chooser = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        requestRuntimePermissions();
    }

    private void requestRuntimePermissions() {
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            String[] wanted = new String[]{${array}};
            java.util.ArrayList<String> pending = new java.util.ArrayList<>();
            for (String p : wanted) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    pending.add(p);
                }
            }
            if (!pending.isEmpty()) {
                requestPermissions(pending.toArray(new String[0]), PERMS);
            }
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);

        if (request == FILES && chooser != null) {
            Uri[] resultUris = null;

            if (result == RESULT_OK && data != null) {
                if (data.getData() != null) {
                    resultUris = new Uri[]{data.getData()};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    resultUris = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        resultUris[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }

            chooser.onReceiveValue(resultUris);
            chooser = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (${m.back} && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
`;
}

function projectFiles(m, html, iconBuffer) {
  const pp = m.pkg.replace(/\./g, "/");

  return {
    "settings.gradle.kts": `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name="${m.projectName}"
include(":app")
`,
    "build.gradle.kts": `plugins {
    id("com.android.application") version "8.6.1" apply false
}
`,
    "gradle.properties": `org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8
android.useAndroidX=true
org.gradle.daemon=false
org.gradle.parallel=false
`,
    "app/build.gradle.kts": `plugins {
    id("com.android.application")
}

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
}
`,
    "app/src/main/AndroidManifest.xml": manifest(m),
    [`app/src/main/java/${pp}/MainActivity.java`]: mainJava(m),
    "app/src/main/res/values/styles.xml": `<resources>
    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:statusBarColor">${m.statusBar}</item>
        <item name="android:navigationBarColor">${m.navBar}</item>
        <item name="android:windowLightStatusBar">${!m.dark}</item>
    </style>
</resources>
`,
    "app/src/main/assets/index.html": html,
    "app/src/main/res/drawable/app_icon.png": iconBuffer
  };
}

async function createProject(base, m, html, icon) {
  const files = projectFiles(m, html, icon);
  for (const [rel, data] of Object.entries(files)) {
    await writeFile(base, rel, data);
  }
}

function runGradle(job, base) {
  return new Promise((resolve, reject) => {
    const bin = process.env.GRADLE_BIN || "/opt/gradle/bin/gradle";
    const args = ["--no-daemon", "--stacktrace", "--console=plain", "assembleDebug"];

    log(job, "Starting Android build.", "build");

    const child = spawn(bin, args, {
      cwd: base,
      env: {
        ...process.env,
        GRADLE_USER_HOME: path.join(base, ".gradle")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      log(job, "Build stopped: 10-minute safety timeout.", "error");
      child.kill("SIGKILL");
      reject(new Error("Build exceeded the 10-minute safety limit."));
    }, 10 * 60 * 1000);

    const consume = data => {
      for (const line of String(data).split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;

        let progress = job.progress;
        if (/compile|merge|process|package/i.test(text)) progress = Math.min(92, progress + 2);
        if (/BUILD SUCCESSFUL/i.test(text)) progress = 98;
        job.progress = Math.max(job.progress, progress);

        log(job, text, /error|failed/i.test(text) ? "error" : "gradle");
      }
    };

    child.stdout.on("data", consume);
    child.stderr.on("data", consume);

    child.on("error", err => {
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", code => {
      finished = true;
      clearTimeout(timeout);

      if (code === 0) resolve();
      else reject(new Error(`Gradle exited with code ${code}. See the build log below.`));
    });
  });
}

app.post("/api/build", upload.fields([
  { name: "html", maxCount: 1 },
  { name: "icon", maxCount: 1 }
]), async (req, res) => {
  try {
    const htmlFile = req.files?.html?.[0];
    const iconFile = req.files?.icon?.[0];

    if (!htmlFile) {
      return res.status(400).json({ ok: false, error: "HTML source is missing." });
    }

    const defaultIcon = await fsp.readFile(path.join(__dirname, "public", "default-icon.png"));

    let permissions = [];
    try { permissions = JSON.parse(req.body.permissions || "[]"); } catch {}

    const appName = clean(req.body.appName, 80) || "My HTML App";
    const id = crypto.randomBytes(10).toString("hex");

    const m = {
      appName,
      pkg: packageName(req.body.packageName || appName),
      version: /^\d+(?:\.\d+){0,3}$/.test(req.body.version || "") ? req.body.version : "1.0.0",
      versionCode: Math.max(1, parseInt(req.body.versionCode || "1") || 1),
      orientation: ["portrait", "landscape", "unspecified"].includes(req.body.orientation)
        ? req.body.orientation : "portrait",
      minSdk: [23, 26, 28].includes(Number(req.body.minSdk))
        ? Number(req.body.minSdk) : 23,
      bg: validColor(req.body.bg, "#0b1020"),
      statusBar: validColor(req.body.statusBar, "#0b1020"),
      navBar: validColor(req.body.navBar, "#000000"),
      dark: req.body.dark === "true",
      zoom: req.body.zoom === "true",
      back: req.body.back !== "false",
      cleartext: req.body.cleartext === "true",
      permissions,
      projectName: "HTMLAPK_" + id
    };

    const base = path.join(ROOT, m.projectName);
    const job = {
      id,
      status: "queued",
      stage: "Queued",
      progress: 3,
      logs: [],
      base,
      apk: null,
      appName: m.appName,
      packageName: m.pkg,
      created: Date.now()
    };

    jobs.set(id, job);
    await fsp.mkdir(base, { recursive: true });

    log(job, `App: ${m.appName}`);
    log(job, `Package: ${m.pkg}`);
    log(job, "Creating Android project...");

    await createProject(
      base,
      m,
      htmlFile.buffer.toString("utf8"),
      iconFile ? iconFile.buffer : defaultIcon
    );

    job.status = "building";
    job.stage = "Building APK";
    job.progress = 18;
    log(job, "Project created. Gradle is now running.", "build");

    runGradle(job, base)
      .then(async () => {
        const apk = path.join(base, "app/build/outputs/apk/debug/app-debug.apk");
        await fsp.access(apk);

        job.apk = apk;
        job.status = "done";
        job.stage = "APK ready";
        job.progress = 100;

        log(job, "BUILD SUCCESSFUL — APK is ready.", "success");
      })
      .catch(err => {
        job.status = "failed";
        job.stage = "Build failed";
        job.progress = 0;
        log(job, err.message, "error");
      });

    res.json({
      ok: true,
      id,
      appName: m.appName,
      packageName: m.pkg
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message || "Could not create build job."
    });
  }
});

app.get("/api/build/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      ok: false,
      error: "Build job not found or expired."
    });
  }

  res.json({
    ok: true,
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    logs: job.logs.slice(-80),
    appName: job.appName,
    packageName: job.packageName,
    download: job.status === "done" ? `/api/download/${job.id}` : null
  });
});

app.get("/api/download/:id", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job || job.status !== "done" || !job.apk || !fs.existsSync(job.apk)) {
    return res.status(404).send("APK is no longer available.");
  }

  res.download(job.apk, `${job.appName.replace(/[^a-zA-Z0-9_-]/g, "_")}.apk`);
});

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;

  for (const [id, job] of jobs) {
    if (job.created < cutoff) {
      jobs.delete(id);
      fsp.rm(job.base, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 5 * 60 * 1000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTML APK Studio Pro V4 listening on ${PORT}`);
});
