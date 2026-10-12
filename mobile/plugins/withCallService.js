// Generated through Expo prebuild; never patch generated native projects by hand.
const {withAndroidManifest,withMainApplication,withDangerousMod}=require('expo/config-plugins');
const fs=require('node:fs/promises');const path=require('node:path');
module.exports=config=>{
 // The bridge lives in the generated MainActivity package (android.package); class names stay internal.
 const pkg=config.android?.package;if(!pkg||!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)+$/.test(pkg))throw new Error('Set a valid android.package before generating the call service.');
 const hard=new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(' '));
 const kotlinPackage=pkg.split('.').map(s=>hard.has(s)?'`'+s+'`':s).join('.');
 config=withAndroidManifest(config,c=>{const app=c.modResults.manifest.application[0];app.service??=[];if(!app.service.some(s=>s.$['android:name']==='.SchachCallService'))app.service.push({$:{'android:name':'.SchachCallService','android:exported':'false','android:foregroundServiceType':'microphone|mediaPlayback','android:stopWithTask':'true'}});return c});
 config=withMainApplication(config,c=>{if(!c.modResults.contents.includes('add(SchachCallPackage())')){const marker='PackageList(this).packages.apply {';if(!c.modResults.contents.includes(marker))throw new Error('Unsupported generated MainApplication; verify React Native package registration.');c.modResults.contents=c.modResults.contents.replace(marker,marker+'\n          add(SchachCallPackage())')};return c});
 return withDangerousMod(config,['android',async c=>{const target=path.join(c.modRequest.platformProjectRoot,'app/src/main/java',...pkg.split('.'));await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'SchachCallService.kt'),`package ${kotlinPackage}
import android.app.*
import android.content.Intent
import android.os.IBinder
import android.content.pm.ServiceInfo
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class SchachCallService : Service() {
 override fun onBind(intent: Intent?): IBinder? = null
 override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
  val manager = getSystemService(NotificationManager::class.java)
  manager.createNotificationChannel(NotificationChannel("schach-active-call", "Active company calls", NotificationManager.IMPORTANCE_LOW))
  val open = PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  val notice = Notification.Builder(this,"schach-active-call").setContentTitle("Workspace call in progress").setContentText("Open Workspace to manage or leave the call").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentIntent(open).setOngoing(true).build()
  if (android.os.Build.VERSION.SDK_INT >= 29) startForeground(4107,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(4107,notice)
  return START_NOT_STICKY
 }
 override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
}
class SchachCallModule(private val ctx: ReactApplicationContext): ReactContextBaseJavaModule(ctx) {
 override fun getName() = "SchachCallService"
 @ReactMethod fun start(promise: Promise) { try { ctx.startForegroundService(Intent(ctx,SchachCallService::class.java));promise.resolve(null) } catch(e: Exception) { promise.reject("call_service", "Start calls while the app is open and microphone access is allowed.",e) } }
 @ReactMethod fun stop() { ctx.stopService(Intent(ctx,SchachCallService::class.java)) }
}
class SchachCallPackage: ReactPackage {
 override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(SchachCallModule(ctx))
 override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*,*>> = emptyList()
}
`);return c}]);
};
