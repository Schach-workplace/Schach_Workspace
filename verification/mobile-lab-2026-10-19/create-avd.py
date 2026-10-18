import pathlib,os,subprocess
root=pathlib.Path(os.environ.get('WORKSPACE_MOBILE_LAB','/tmp/workspace-mobile-lab-20261019'));java=next((root/'java').iterdir());sdk=root/'sdk'
env={**os.environ,'JAVA_HOME':str(java),'ANDROID_HOME':str(sdk),'ANDROID_SDK_ROOT':str(sdk),'ANDROID_USER_HOME':str(root/'android-user'),'ANDROID_EMULATOR_HOME':str(root/'android-user'),'ANDROID_AVD_HOME':str(root/'avd'),'ANDROID_ADB_SERVER_PORT':'5039','ADB_SERVER_SOCKET':'tcp:127.0.0.1:5039'}
cmd=[str(sdk/'cmdline-tools/latest/bin/avdmanager'),'create','avd','--name','workspace-qa-api36-20261019','--package','system-images;android-36;google_apis;x86_64','--device','pixel_5','--path',str(root/'avd/workspace-qa-api36-20261019.avd')]
subprocess.run(cmd,input='no\n',text=True,env=env,check=True)
subprocess.run([str(sdk/'emulator/emulator'),'-accel-check'],env=env,check=True)
print('AVD_READY',flush=True)
