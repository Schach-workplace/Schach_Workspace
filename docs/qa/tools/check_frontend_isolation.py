#!/usr/bin/env python3
"""Controlled hostile-env build regression. Does not start an app or send requests."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

QA = Path(__file__).resolve().parents[1]
REPO = QA.parents[1]
parent = Path.home() / '.local/state/schach-qa-validation'
parent.mkdir(parents=True, exist_ok=True, mode=0o700)
run = Path(tempfile.mkdtemp(prefix='frontend-isolation-', dir=parent))
run.chmod(0o700)
marker = 'https://qa-inherited.invalid'
results = {}
probe = "import {resolveConfig} from 'vite'; const c=await resolveConfig({},'build','production'); console.log(JSON.stringify({api:c.env.VITE_API_URL,mode:c.env.VITE_DATA_MODE}));"
for phase in ['inherited', 'forced']:
    env = os.environ.copy()
    env.update(VITE_API_URL=marker, VITE_DATA_MODE='demo', NODE_ENV='production')
    if phase == 'forced':
        env.update(VITE_API_URL='', VITE_DATA_MODE='api')
    resolved = subprocess.run(['node', '--input-type=module', '-e', probe], cwd=REPO/'frontend',
                              env=env, capture_output=True, text=True, check=True)
    config = json.loads(resolved.stdout.strip().splitlines()[-1])
    out = run / phase
    with (run / (phase + '.log')).open('w') as log:
        built = subprocess.run(['npm', 'run', 'build', '--', '--outDir', str(out)],
                               cwd=REPO/'frontend', env=env, stdout=log, stderr=subprocess.STDOUT)
    assert built.returncode == 0, (phase, 'build failed; see private log')
    matches = sum(marker.encode() in p.read_bytes() for p in out.rglob('*.js'))
    results[phase] = dict(resolved=config, bundlesWithInheritedURL=matches, buildExit=0)
assert results['inherited']['resolved'] == {'api': marker, 'mode': 'demo'}
assert results['inherited']['bundlesWithInheritedURL'] > 0
assert results['forced']['resolved'] == {'api': '', 'mode': 'api'}
assert results['forced']['bundlesWithInheritedURL'] == 0
launcher = (QA / 'tools/start-isolated-qa.sh').read_text()
assert "VITE_API_URL='' VITE_DATA_MODE=api NODE_ENV=production npm run build" in launcher
report = dict(status='PASS', scope='QA frontend build isolation only; no app/manual cases executed',
              beforeFix='Inherited synthetic URL and demo mode reproduce the unsafe build configuration',
              afterFix='Explicit overrides resolve empty same-origin URL and API mode; marker absent',
              results=results, privateArtifacts=str(run))
(run/'result.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report))
