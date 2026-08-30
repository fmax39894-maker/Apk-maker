const express=require("express"),multer=require("multer"),fs=require("fs"),fsp=fs.promises,path=require("path"),os=require("os"),crypto=require("crypto"),{spawn}=require("child_process");
const app=express(),PORT=Number(process.env.PORT||10000),ROOT=path.join(os.tmpdir(),"html-apk-studio");
fs.mkdirSync(ROOT,{recursive:true});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:30*1024*1024,files:2}});
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(q,s)=>s.json({ok:true,service:"HTML APK Studio",androidHome:process.env.ANDROID_HOME||null}));
const jobs=new Map();
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
function pkg(v){let a=String(v||"com.example.myapp").toLowerCase().replace(/[^a-z0-9._]/g,".").replace(/\.+/g,".").replace(/^\.+|\.+$/g,"").split(".").filter(Boolean).map(x=>x.replace(/^[^a-z]+/,"")).filter(Boolean);if(a.length<2)a=["com","example",...(a.length?a:["myapp"])];return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(a.join("."))?a.join(".").slice(0,120):"com.example.myapp"}
function col(v,d){return /^#[0-9a-f]{6}$/i.test(v||"")?v:d}
function log(j,x,t="info"){for(const l of String(x).split(/\r?\n/).map(x=>x.trim()).filter(Boolean))j.logs.push({line:new Date().toLocaleTimeString()+"  "+l,type:t});j.logs=j.logs.slice(-160)}
function manifest(m){const map={INTERNET:"android.permission.INTERNET",CAMERA:"android.permission.CAMERA",RECORD_AUDIO:"android.permission.RECORD_AUDIO",ACCESS_FINE_LOCATION:"android.permission.ACCESS_FINE_LOCATION",ACCESS_COARSE_LOCATION:"android.permission.ACCESS_COARSE_LOCATION",READ_MEDIA_IMAGES:"android.permission.READ_MEDIA_IMAGES",POST_NOTIFICATIONS:"android.permission.POST_NOTIFICATIONS",VIBRATE:"android.permission.VIBRATE"};let p=(m.permissions||[]).filter(x=>map[x]).map(x=>`<uses-permission android:name="${map[x]}"/>`).join("\n");return `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-sdk android:minSdkVersion="${m.min}" android:targetSdkVersion="35"/>${p}<application android:theme="@style/AppTheme" android:label="${esc(m.name)}" android:icon="@drawable/app_icon" android:usesCleartextTraffic="${m.http}"><activity android:name=".MainActivity" android:screenOrientation="${m.orientation}" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`}
function activity(m){const map={CAMERA:"android.Manifest.permission.CAMERA",RECORD_AUDIO:"android.Manifest.permission.RECORD_AUDIO",ACCESS_FINE_LOCATION:"android.Manifest.permission.ACCESS_FINE_LOCATION",ACCESS_COARSE_LOCATION:"android.Manifest.permission.ACCESS_COARSE_LOCATION",READ_MEDIA_IMAGES:"android.Manifest.permission.READ_MEDIA_IMAGES",POST_NOTIFICATIONS:"android.Manifest.permission.POST_NOTIFICATIONS"};let a=(m.permissions||[]).filter(x=>map[x]).map(x=>map[x]).join(",");return `package ${m.pkg}; import android.app.Activity;import android.os.Bundle;import android.content.Intent;import android.content.pm.PackageManager;import android.net.Uri;import android.webkit.*;import android.graphics.Color; public class MainActivity extends Activity{WebView web;ValueCallback<Uri[]> cb;static final int PICK=41;public void onCreate(Bundle b){super.onCreate(b);web=new WebView(this);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(true);s.setAllowContentAccess(true);s.setBuiltInZoomControls(${m.zoom});s.setDisplayZoomControls(false);web.setBackgroundColor(Color.parseColor("${m.bg}"));web.setWebViewClient(new WebViewClient());web.setWebChromeClient(new WebChromeClient(){public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> c,FileChooserParams p){cb=c;try{startActivityForResult(p.createIntent(),PICK);return true;}catch(Exception e){cb=null;return false;}}});setContentView(web);web.loadUrl("file:///android_asset/index.html");perms();}void perms(){if(android.os.Build.VERSION.SDK_INT>=23){String[] a=new String[]{${a}};java.util.ArrayList<String> p=new java.util.ArrayList<>();for(String x:a)if(checkSelfPermission(x)!=PackageManager.PERMISSION_GRANTED)p.add(x);if(!p.isEmpty())requestPermissions(p.toArray(new String[0]),88);}}protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(r==PICK&&cb!=null){Uri[] u=null;if(c==RESULT_OK&&d!=null&&d.getData()!=null)u=new Uri[]{d.getData()};cb.onReceiveValue(u);cb=null;}}public void onBackPressed(){if(${m.back}&&web.canGoBack())web.goBack();else super.onBackPressed();}}`}
async function write(b,r,d){let p=path.join(b,r);await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,d)}
async function project(b,m,html,icon){
  const j=m.pkg.replace(/\./g,"/");
  await write(b,"settings.gradle.kts",`import org.gradle.api.initialization.resolve.RepositoriesMode

pluginManagement {
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

rootProject.name = "${m.project}"
include(":app")
`);
  await write(b,"build.gradle.kts",`plugins {
    id("com.android.application") version "8.6.1" apply false
}
`);
  await write(b,"gradle.properties",`org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8
org.gradle.daemon=false
org.gradle.parallel=false
org.gradle.caching=true
`);
  await write(b,"app/build.gradle.kts",`plugins {
    id("com.android.application")
}

android {
    namespace = "${m.pkg}"
    compileSdk = 35

    defaultConfig {
        applicationId = "${m.pkg}"
        minSdk = ${m.min}
        targetSdk = 35
        versionCode = ${m.code}
        versionName = "${m.version}"
    }
}
`);
  await write(b,"app/src/main/AndroidManifest.xml",manifest(m));
  await write(b,`app/src/main/java/${j}/MainActivity.java`,activity(m));
  await write(b,"app/src/main/res/values/styles.xml",`<resources>
<style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">
    <item name="android:statusBarColor">${m.status}</item>
    <item name="android:navigationBarColor">${m.nav}</item>
    <item name="android:windowLightStatusBar">${!m.dark}</item>
</style>
</resources>`);
  await write(b,"app/src/main/assets/index.html",html);
  await write(b,`app/src/main/res/drawable/app_icon.${m.iconExt||"png"}`,icon);
}

function runCmd(j, cmd, args, cwd, env={}){
  return new Promise((resolve,reject)=>{
    log(j, "$ " + cmd + " " + args.join(" "));
    const c=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:["ignore","pipe","pipe"]});
    c.stdout.on("data",d=>log(j,d));
    c.stderr.on("data",d=>log(j,d,"error"));
    c.on("error",reject);
    c.on("close",code=>code===0?resolve():reject(new Error(`${cmd} exited with code ${code}`)));
  });
}
async function directBuild(j,b){
  const sdk=process.env.ANDROID_HOME||"/opt/android-sdk";
  const bt=process.env.ANDROID_BUILD_TOOLS||path.join(sdk,"build-tools","35.0.0");
  const platform=path.join(sdk,"platforms","android-35","android.jar");
  const aapt2=path.join(bt,"aapt2"), d8=path.join(bt,"d8"), zipalign=path.join(bt,"zipalign"), apksigner=path.join(bt,"apksigner");
  const classes=path.join(b,"classes"), dexout=path.join(b,"dex"), res=path.join(b,"app/src/main/res"), assets=path.join(b,"app/src/main/assets");
  const out=path.join(b,"out");
  await fsp.mkdir(classes,{recursive:true}); await fsp.mkdir(dexout,{recursive:true}); await fsp.mkdir(out,{recursive:true});
  j.progress=25; j.stage="Compiling Android code";
  await runCmd(j,"javac",["-source","8","-target","8","-encoding","UTF-8","-classpath",platform,"-d",classes,path.join(b,"app/src/main/java",j.pkg.replace(/\./g,"/"),"MainActivity.java")],b);
  j.progress=40; j.stage="Creating DEX";
  await runCmd(j,d8,["--lib",platform,"--output",dexout,classes],b);
  j.progress=55; j.stage="Compiling resources";
  const compiled=path.join(out,"resources.zip");
  await runCmd(j,aapt2,["compile","--dir",res,"-o",compiled],b);
  j.progress=68; j.stage="Packaging APK";
  const unsigned=path.join(out,"unsigned.apk");
  await runCmd(j,aapt2,["link","-o",unsigned,"--manifest",path.join(b,"app/src/main/AndroidManifest.xml"),"-I",platform,"-R",compiled,"-A",assets,"--auto-add-overlay"],b);
  await runCmd(j,"sh",["-c",`cd ${JSON.stringify(dexout)} && zip -q -u ${JSON.stringify(unsigned)} classes.dex`],b);
  j.progress=80; j.stage="Aligning APK";
  const aligned=path.join(out,"aligned.apk");
  await runCmd(j,zipalign,["-f","-p","4",unsigned,aligned],b);
  j.progress=90; j.stage="Signing APK";
  const ks=path.join(b,"debug.keystore");
  await runCmd(j,"keytool",["-genkeypair","-v","-keystore",ks,"-storepass","android","-keypass","android","-alias","androiddebugkey","-keyalg","RSA","-keysize","2048","-validity","10000","-dname","CN=Android Debug,O=Android,C=US"],b);
  const apk=path.join(out,"app-debug.apk");
  await runCmd(j,apksigner,["sign","--ks",ks,"--ks-pass","pass:android","--key-pass","pass:android","--out",apk,aligned],b);
  await runCmd(j,apksigner,["verify","--verbose",apk],b);
  j.progress=100;
  return apk;
}
app.post("/api/build",upload.fields([{name:"html",maxCount:1},{name:"icon",maxCount:1}]),async(req,res)=>{try{let h=req.files?.html?.[0];if(!h)return res.status(400).json({ok:false,error:"No HTML source received."});let id=crypto.randomBytes(8).toString("hex"),b=path.join(ROOT,id),perms=JSON.parse(req.body.permissions||"[]"),m={name:String(req.body.name||"My HTML App").slice(0,70),pkg:pkg(req.body.pkg),version:/^\d+(\.\d+){0,3}$/.test(req.body.version||"")?req.body.version:"1.0.0",code:Math.max(1,parseInt(req.body.code)||1),orientation:["portrait","landscape","unspecified"].includes(req.body.orientation)?req.body.orientation:"portrait",min:[23,26,28].includes(Number(req.body.min))?Number(req.body.min):23,bg:col(req.body.bg,"#0b1020"),status:col(req.body.status,"#0b1020"),nav:col(req.body.nav,"#000000"),dark:req.body.dark==="true",zoom:req.body.zoom==="true",back:req.body.back!=="false",http:req.body.http==="true",permissions:perms,iconExt:((req.files?.icon?.[0]?.mimetype||"image/png").split("/")[1]||"png").toLowerCase().replace("jpeg","jpg"),project:"HtmlApkStudio"+id};let j={id,status:"queued",stage:"Queued",progress:4,logs:[],base:b,apk:null,name:m.name,pkg:m.pkg};jobs.set(id,j);const fallbackIcon=fs.readFileSync(path.join(__dirname,"public","default-icon.png"));await project(b,m,h.buffer.toString("utf8"),req.files?.icon?.[0]?.buffer||fallbackIcon);j.status="building";j.stage="Building APK";j.progress=18;log(j,"Android project generated.");log(j,"Package: "+m.pkg);directBuild(j,b).then(async a=>{await fsp.access(a);j.apk=a;j.status="done";j.stage="APK ready";j.progress=100;log(j,"BUILD SUCCESSFUL — APK created and signed.","success")}).catch(e=>{j.status="failed";j.stage="Build failed";log(j,e.stack||e.message,"error")});res.json({ok:true,id,pkg:m.pkg})}catch(e){res.status(500).json({ok:false,error:e.message||"Server error"})}});
app.get("/api/build/:id",(q,s)=>{let j=jobs.get(q.params.id);if(!j)return s.status(404).json({ok:false,error:"Build job not found."});s.json({ok:true,id:j.id,status:j.status,stage:j.stage,progress:j.progress,logs:j.logs,name:j.name,pkg:j.pkg,download:j.status==="done"?"/api/download/"+j.id:null})});
app.get("/api/download/:id",(q,s)=>{let j=jobs.get(q.params.id);if(!j||j.status!=="done"||!j.apk||!fs.existsSync(j.apk))return s.status(404).send("APK unavailable.");s.download(j.apk,j.name.replace(/[^a-zA-Z0-9_-]/g,"_")+".apk")});
app.listen(PORT,"0.0.0.0",()=>console.log("HTML APK Studio on "+PORT));