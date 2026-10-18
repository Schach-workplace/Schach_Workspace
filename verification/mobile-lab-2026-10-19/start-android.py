import os,pathlib,subprocess,socket,signal
root=pathlib.Path(os.environ.get('WORKSPACE_MOBILE_LAB','/tmp/workspace-mobile-lab-20261019'));sdk=root/'sdk'
env={**os.environ,'ANDROID_HOME':str(sdk),'ANDROID_SDK_ROOT':str(sdk),'ANDROID_USER_HOME':str(root/'android-user'),'ANDROID_EMULATOR_HOME':str(root/'android-user'),'ANDROID_AVD_HOME':str(root/'avd'),'ANDROID_ADB_SERVER_PORT':'5039','ADB_SERVER_SOCKET':'tcp:127.0.0.1:5039','QT_QPA_PLATFORM':'offscreen'}
for port in [5039,5578,5579]:
 with socket.socket() as s:s.bind(('127.0.0.1',port))
adb=[str(sdk/'platform-tools/adb'),'-P','5039'];subprocess.run(adb+['start-server'],env=env,check=True)
p=None
try:
 p=subprocess.Popen([str(sdk/'emulator/emulator'),'-avd','workspace-qa-api36-20261019','-port','5578','-no-window','-no-audio','-no-snapshot','-no-boot-anim','-accel','on','-gpu','software','-cores','2','-memory','2048','-camera-back','none','-camera-front','none','-no-metrics'],env=env,start_new_session=True)
 print('Owned emulator PID',p.pid,flush=True);p.wait()
finally:
 if p is not None and p.poll() is None:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
 subprocess.run(adb+['kill-server'],env=env)
