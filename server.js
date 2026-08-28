const express=require("express");
const multer=require("multer");
const fs=require("fs");
const fsp=fs.promises;
const path=require("path");
const os=require("os");
const crypto=require("crypto");
const {execFile}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);

const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
const PORT=process.env.PORT||10000;
const ROOT=path.join(os.tmpdir(),"html-apk-maker");
fs.mkdirSync(ROOT,{recursive:true});

app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(req,res)=>res.json({ok:true,service:"HTML APK Maker"}));

function safeText(x,max=100){return String(x||"").trim().slice(0,max)}
function validVersion(x){return /^[0-9]+(?:\.[0-9]+){0,3}$/.test(x)}
function makePackage(input){
  let p=safeText(input,120).toLowerCase();
  p=p.replace(/[^a-z0-9._]+/g,".");
  p=p.replace(/\.+/g,".").replace(/^\.+|\.+$/g,"");
  const parts=p.split(".").filter(Boolean).map(x=>x.replace(/^[^a-z]+/,""));
  let out=parts.filter(Boolean).join(".");
  if(out.split(".").length<2) out="com.htmlapk."+((out||"app").replace(/[^a-z0-9_]/g,""));
  if(!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(out)) out="com.htmlapk.app";
  return out.slice(0,120);
}
function xml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
function sh(cmd,args,cwd){return execFileAsync(cmd,args,{cwd,maxBuffer:20*1024*1024,timeout:8*60*1000})}

function manifest(m){
 const map={CAMERA:"android.permission.CAMERA",RECORD_AUDIO:"android.permission.RECORD_AUDIO",ACCESS_FINE_LOCATION:"android.permission.ACCESS_FINE_LOCATION",ACCESS_COARSE_LOCATION:"android.permission.ACCESS_COARSE_LOCATION",READ_MEDIA_IMAGES:"android.permission.READ_MEDIA_IMAGES",POST_NOTIFICATIONS:"android.permission.POST_NOTIFICATIONS",VIBRATE:"android.permission.VIBRATE",INTERNET:"android.permission.INTERNET"};
 const perms=(m.permissions||[]).filter(x=>map[x]).map(x=>`    <uses-permission android:name="${map[x]}"/>`).join("\n");
 return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${perms}
    <application android:allowBackup="true" android:label="${xml(m.appName)}" android:theme="@style/AppTheme" android:usesCleartextTraffic="${!!m.cleartext}">
        <activity android:name=".MainActivity" android:screenOrientation="${xml(m.orientation)}" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>`;
}
function javaMain(m){
 const runtimeMap={CAMERA:"Manifest.permission.CAMERA",RECORD_AUDIO:"Manifest.permission.RECORD_AUDIO",ACCESS_FINE_LOCATION:"Manifest.permission.ACCESS_FINE_LOCATION",ACCESS_COARSE_LOCATION:"Manifest.permission.ACCESS_COARSE_LOCATION",READ_MEDIA_IMAGES:"Manifest.permission.READ_MEDIA_IMAGES",POST_NOTIFICATIONS:"Manifest.permission.POST_NOTIFICATIONS"};
 const selected=(m.permissions||[]).filter(x=>runtimeMap[x]);
 const req=selected.map(x=>`"${runtimeMap[x]}"`).join(",");
 return `package ${m.pkg};
import android.app.*;import android.os.*;import android.content.*;import android.content.pm.PackageManager;import android.net.Uri;import android.provider.Settings;import android.webkit.*;import android.graphics.Color;
public class MainActivity extends Activity{
 WebView web; ValueCallback<Uri[]> uploadCallback; static final int FILE_REQUEST=700; static final int PERMISSION_REQUEST=701;
 @Override public void onCreate(Bundle b){super.onCreate(b);
  web=new WebView(this); WebSettings s=web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setBuiltInZoomControls(${!!m.zoom}); s.setDisplayZoomControls(false);
  web.setBackgroundColor(Color.parseColor("${m.bg}")); web.setWebViewClient(new WebViewClient());
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onPermissionRequest(final PermissionRequest r){runOnUiThread(()->r.grant(r.getResources()));}
   @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){uploadCallback=cb;try{startActivityForResult(p.createIntent(),FILE_REQUEST);}catch(Exception e){uploadCallback=null;return false;}return true;}
  });
  setContentView(web); web.loadUrl("file:///android_asset/index.html"); requestSelectedPermissions();
 }
 void requestSelectedPermissions(){if(Build.VERSION.SDK_INT>=23){String[] p=new String[]{${req}};java.util.ArrayList<String>a=new java.util.ArrayList<>();for(String x:p)if(checkSelfPermission(x)!=PackageManager.PERMISSION_GRANTED)a.add(x);if(!a.isEmpty())requestPermissions(a.toArray(new String[0]),PERMISSION_REQUEST);}}
 @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(r==FILE_REQUEST&&uploadCallback!=null){Uri[] a=null;if(c==RESULT_OK&&d!=null){if(d.getData()!=null)a=new Uri[]{d.getData()};else if(d.getClipData()!=null){int n=d.getClipData().getItemCount();a=new Uri[n];for(int i=0;i<n;i++)a[i]=d.getClipData().getItemAt(i).getUri();}}uploadCallback.onReceiveValue(a);uploadCallback=null;}}
 @Override public void onBackPressed(){if(${!!m.back}&&web.canGoBack())web.goBack();else super.onBackPressed();}
}`;
}
function projectFiles(m,html){
 const pkgPath=m.pkg.replace(/\./g,"/");
 const files={};
 files["settings.gradle.kts"]=`pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
rootProject.name="${m.projectName}"
include(":app")`;
 files["build.gradle.kts"]=`plugins { id("com.android.application") version "8.6.1" apply false }`;
 files["gradle.properties"]="org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\n";
 files["app/build.gradle.kts"]=`plugins { id("com.android.application") }
android {
 namespace="${m.pkg}"
 compileSdk=35
 defaultConfig { applicationId="${m.pkg}"; minSdk=${m.minSdk}; targetSdk=35; versionCode=${m.versionCode}; versionName="${xml(m.version)}" }
}`;
 files["app/src/main/AndroidManifest.xml"]=manifest(m);
 files[`app/src/main/java/${pkgPath}/MainActivity.java`]=javaMain(m);
 files["app/src/main/res/values/styles.xml"]=`<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:statusBarColor">${m.statusBar}</item><item name="android:navigationBarColor">${m.navBar}</item><item name="android:windowLightStatusBar">${!m.dark}</item></style></resources>`;
 files["app/src/main/assets/index.html"]=html;
 files["BUILD_INFO.txt"]=`Built by HTML APK Maker\nApp: ${m.appName}\nPackage: ${m.pkg}\nVersion: ${m.version}\n`;
 return files;
}
async function writeFiles(base,files){
 for(const [rel,data] of Object.entries(files)){
   const p=path.join(base,rel); await fsp.mkdir(path.dirname(p),{recursive:true}); await fsp.writeFile(p,data);
 }
}
async function buildProject(base){
 const gradle=process.env.GRADLE_BIN||"/opt/gradle/bin/gradle";
 await sh(gradle,["--no-daemon","--stacktrace","assembleDebug"],base);
 const apk=path.join(base,"app/build/outputs/apk/debug/app-debug.apk");
 await fsp.access(apk); return apk;
}
app.post("/build",upload.single("html"),async(req,res)=>{
 let job=null;
 try{
  if(!req.file) return res.status(400).json({error:"Please choose an index.html file."});
  const html=req.file.buffer.toString("utf8");
  if(html.length>10*1024*1024)return res.status(400).json({error:"HTML file is too large."});
  const rawName=safeText(req.body.appName,80)||"My HTML App";
  const pkg=makePackage(req.body.packageName||rawName);
  const m={appName:rawName,pkg,version:validVersion(req.body.version)?req.body.version:"1.0.0",
   versionCode:Math.max(1,parseInt(req.body.versionCode||"1",10)||1),
   orientation:["portrait","landscape","unspecified"].includes(req.body.orientation)?req.body.orientation:"portrait",
   minSdk:[23,26,28].includes(Number(req.body.minSdk))?Number(req.body.minSdk):23,
   bg:/^#[0-9a-f]{6}$/i.test(req.body.bg)?req.body.bg:"#0b1020",
   statusBar:/^#[0-9a-f]{6}$/i.test(req.body.statusBar)?req.body.statusBar:"#0b1020",
   navBar:/^#[0-9a-f]{6}$/i.test(req.body.navBar)?req.body.navBar:"#000000",
   dark:req.body.dark==="true",zoom:req.body.zoom==="true",back:req.body.back!=="false",
   cleartext:req.body.cleartext==="true",
   permissions:JSON.parse(req.body.permissions||"[]"),
   projectName:"HTMLAPK_"+crypto.randomBytes(4).toString("hex")};
  job=path.join(ROOT,m.projectName); await fsp.mkdir(job,{recursive:true});
  await writeFiles(job,projectFiles(m,html));
  const apk=await buildProject(job);
  const id=crypto.randomBytes(16).toString("hex");
  const final=path.join(ROOT,id+".apk"); await fsp.copyFile(apk,final);
  res.json({ok:true,packageName:m.pkg,appName:m.appName,download:`/download/${id}`,message:"APK built successfully."});
 }catch(e){
  console.error(e);
  res.status(500).json({error:"APK build failed.",details:(e.stderr||e.stdout||e.message||"Unknown build error").slice(-5000)});
 }finally{
  if(job) setTimeout(()=>fsp.rm(job,{recursive:true,force:true}).catch(()=>{}),30000);
 }
});
app.get("/download/:id",(req,res)=>{
 const id=req.params.id.replace(/[^a-f0-9]/g,"");
 const p=path.join(ROOT,id+".apk");
 if(!fs.existsSync(p))return res.status(404).send("APK expired or not found.");
 res.download(p,"app-debug.apk",()=>setTimeout(()=>fs.rm(p,{force:true},()=>{}),60000));
});
app.listen(PORT,()=>console.log("HTML APK Maker running on "+PORT));
