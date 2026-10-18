"""Isolated Ubuntu24 WebKit compatibility libraries for this Arch test host.
Only public packages; no system install or maintainer scripts.
"""
import urllib.request,json,pathlib,hashlib,subprocess,gzip,os
root=pathlib.Path(os.environ.get('WORKSPACE_MOBILE_LAB','/tmp/workspace-mobile-lab-20261019'));root.mkdir(exist_ok=True)
def fetch(url,path):
 with urllib.request.urlopen(url,timeout=90) as r,path.open('wb') as f:
  while chunk:=r.read(1<<20):f.write(chunk)
 return path
targets={'libicu74','libxml2','libflite1'};records={}
for component in ['main','universe']:
 data=gzip.decompress(urllib.request.urlopen('https://archive.ubuntu.com/ubuntu/dists/noble/'+component+'/binary-amd64/Packages.gz',timeout=90).read()).decode()
 for paragraph in data.split('\n\n'):
  fields={line.split(': ',1)[0]:line.split(': ',1)[1] for line in paragraph.splitlines() if ': ' in line and not line.startswith(' ')}
  if fields.get('Package') in targets:records[fields['Package']]=fields
 del data
assert targets<=records.keys(),records.keys()
compat=root/'webkit-compat';compat.mkdir(exist_ok=True)
for name,v in records.items():
 d=fetch('https://archive.ubuntu.com/ubuntu/'+v['Filename'],root/(name+'.deb'));assert hashlib.sha256(d.read_bytes()).hexdigest()==v['SHA256'];member=next(s for s in subprocess.check_output(['ar','t',str(d)],text=True).splitlines() if s.startswith('data.tar'))
 data=root/member
 with data.open('wb') as f:subprocess.run(['ar','p',str(d),member],stdout=f,check=True)
 subprocess.run(['tar','-xf',str(data),'-C',str(compat)],check=True)
for engine in ['gtk','wpe']:
 lib=pathlib.Path(os.environ.get('WORKSPACE_WEBKIT_BUILD','/tmp/workspace-mobile-browsers/webkit-2359'))/('minibrowser-'+engine)/'sys/lib'
 for f in (compat/'usr/lib/x86_64-linux-gnu').iterdir():
  if f.is_file() and not (lib/f.name).exists():(lib/f.name).symlink_to(f)
(root/'webkit-downloads.json').write_text(json.dumps(records,indent=2))
print('WEBKIT_LIBRARIES_READY',flush=True)
