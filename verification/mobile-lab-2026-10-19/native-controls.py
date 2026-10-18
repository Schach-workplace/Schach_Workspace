"""ADB controls restricted to this lab's newly owned emulator and private ADB server."""
import os,pathlib,subprocess,time,xml.etree.ElementTree as ET,re,shlex
LAB=pathlib.Path(os.environ.get('WORKSPACE_MOBILE_LAB','/tmp/workspace-mobile-lab-20261019'))
ADB=[str(LAB/'sdk/platform-tools/adb'),'-P','5039','-s','emulator-5578']
ENV={**os.environ,'ANDROID_USER_HOME':str(LAB/'android-user'),'ADB_SERVER_SOCKET':'tcp:127.0.0.1:5039'}
OUT=pathlib.Path(__file__).parent/'native';OUT.mkdir(exist_ok=True)
def cmd(*args,timeout=30,binary=False):
 r=subprocess.run(ADB+list(args),env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,check=True)
 return r.stdout if binary else r.stdout.decode(errors='replace')
assert 'workspace-qa-api36-20261019' in cmd('emu','avd','name'), 'Refusing a different emulator'
def dump():
 cmd('shell','rm','-f','/sdcard/workspace-lab-window.xml')
 status=cmd('shell','uiautomator','dump','--compressed','/sdcard/workspace-lab-window.xml',timeout=20)
 assert 'dumped to:' in status, 'No fresh UI hierarchy: '+status
 text=cmd('exec-out','cat','/sdcard/workspace-lab-window.xml');return ET.fromstring(text),text
def text(node):return node.attrib.get('content-desc') or node.attrib.get('text') or ''
def find(label,exact=True,field=False,root=None):
 if root is None:root,_=dump()
 return next((n for n in root.iter('node') if (text(n)==label if exact else label in text(n)) and (not field or n.attrib.get('class','').endswith('EditText'))),None)
def wait(label,exact=True,timeout=45):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  try:n=find(label,exact)
  except AssertionError as e:
   if 'No fresh UI hierarchy:' not in str(e):raise
   n=None
  if n is not None:return n
  time.sleep(.25)
 raise AssertionError('Native control not found: '+label)
def tapnode(n):
 bounds=list(map(int,re.findall(r'\d+',n.attrib['bounds'])));assert len(bounds)==4
 cmd('shell','input','tap',str((bounds[0]+bounds[2])//2),str((bounds[1]+bounds[3])//2));time.sleep(.3)
def tap(label,exact=True):tapnode(wait(label,exact))
def fill(label,value):
 n=find(label,field=True);assert n is not None,'Editable field absent: '+label;tapnode(n);time.sleep(.4)
 cmd('shell','input','keycombination','113','29')
 cmd('shell','input','keyevent','67');time.sleep(.2)
 if value:cmd('shell','input','text',shlex.quote(value.replace(' ','%s')))
 time.sleep(.3)
 field=find(label,field=True)
 assert field is not None and (field.attrib.get('text')==value or not value and field.attrib.get('text') in ('',field.attrib.get('hint'))), 'Injected field text did not match requested input: '+label
def back():cmd('shell','input','keyevent','4');time.sleep(.3)
def screenshot(name):
 _,xml=dump();(OUT/(name+'.xml')).write_text(xml)
 (OUT/(name+'.png')).write_bytes(cmd('exec-out','screencap','-p',binary=True))
def openroute(path):
 import json
 if 'company=' not in path:
  company=json.loads(pathlib.Path(__file__).with_name('native-fixture.json').read_text())['company']
  path+=('&' if '?' in path else '?')+'company='+company
 cmd('shell','am','start','-a','android.intent.action.VIEW','-d',shlex.quote('exp://127.0.0.1:19019/--/'+path.lstrip('/')),'-p','host.exp.exponent');time.sleep(.4)
def labels():
 root,_=dump();return [text(n) for n in root.iter('node') if text(n)]
if __name__=='__main__':
 print('\n'.join(labels()))
