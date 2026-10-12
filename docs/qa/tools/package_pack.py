#!/usr/bin/env python3
"""Make a new QA-only ZIP with every included file hashed; never overwrite a run."""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

qa = Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 docs/qa/tools/package_pack.py /absolute/new-team-qa.zip')
out = Path(sys.argv[1])
assert out.is_absolute() and not out.exists(), 'Output must be a new absolute path'
files = sorted(p for p in qa.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
assert all(not p.is_symlink() for p in files)
assert all(p.suffix not in ['.sqlite','.db','.env','.log','.apk'] for p in files)
manifest = {str(p.relative_to(qa)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
with zipfile.ZipFile(out,'x',zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.writestr('Schach-Team-QA/'+str(p.relative_to(qa)),p.read_bytes())
    z.writestr('Schach-Team-QA/SHA256SUMS.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(set(z.namelist())) == len(files)+1
    for name, digest in manifest.items():
        assert hashlib.sha256(z.read('Schach-Team-QA/'+name)).hexdigest() == digest
print(json.dumps({'status':'PASS','files':len(files),'entries':len(files)+1,'bytes':out.stat().st_size,
                  'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'archive':str(out)}))
