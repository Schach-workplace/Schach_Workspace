#!/usr/bin/env python3
"""Check generated config after `npm --prefix mobile run prebuild`; no binary/device claim."""
import plistlib
import xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[2]
android=ET.parse(root/'mobile/android/app/src/main/AndroidManifest.xml').getroot()
a='{http://schemas.android.com/apk/res/android}';t='{http://schemas.android.com/tools}'
permissions={p.get(a+'name'):p.get(t+'node') for p in android.findall('uses-permission')}
for name in ['CAMERA','RECORD_AUDIO','FOREGROUND_SERVICE_MICROPHONE','FOREGROUND_SERVICE_MEDIA_PLAYBACK']:
 assert 'android.permission.'+name in permissions and permissions['android.permission.'+name]!='remove', 'Required permission removed: '+name
with (root/'mobile/ios/SchachWorkspace/Info.plist').open('rb') as f:info=plistlib.load(f)
assert 'voice notes' in info['NSMicrophoneUsageDescription'] and 'calls' in info['NSMicrophoneUsageDescription']
assert 'evidence' in info['NSCameraUsageDescription'] and 'receipts' in info['NSCameraUsageDescription']
print('Generated Android/iOS camera, microphone and foreground-service config passed; no binary/device certification.')
