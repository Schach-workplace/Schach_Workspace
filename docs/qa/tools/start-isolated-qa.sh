#!/usr/bin/env bash
# Creates only a NEW disposable fixture. Never adopts existing workspace data.
set -euo pipefail
if (( $# != 0 )); then
  echo 'Usage: bash docs/qa/tools/start-isolated-qa.sh (optional SCHACH_QA_PORT environment)' >&2
  exit 2
fi
qa_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
qa_port="${SCHACH_QA_PORT:-9080}"
case "$qa_port" in ''|*[!0-9]*) echo 'QA port must be numeric' >&2; exit 2;; esac
if (( qa_port < 1024 || qa_port > 65535 || qa_port == 8080 )); then
  echo 'Choose a private test port 1024-65535, other than workspace port 8080' >&2
  exit 2
fi
for qa_tool in python3 go npm; do command -v "$qa_tool" >/dev/null || { echo "Missing required tool: $qa_tool" >&2; exit 2; }; done
if [[ ! -d "$qa_repo_root/frontend/node_modules" ]]; then
  echo 'Run npm ci in frontend/ before starting this isolated fixture.' >&2
  exit 2
fi
python3 - "$qa_port" <<'PY'
import socket,sys
sock=socket.socket()
sock.bind(('127.0.0.1',int(sys.argv[1])))
sock.close()
PY
umask 077
qa_parent="${XDG_STATE_HOME:-${HOME}/.local/state}/schach-qa"
mkdir -p -- "$qa_parent"
qa_run_root="$(mktemp -d "$qa_parent/run-XXXXXXXX")"
chmod 700 "$qa_run_root"
python3 - "$qa_run_root" "$qa_repo_root" "$qa_port" <<'PY'
from pathlib import Path
import json,os,secrets,sys
run,repo,port=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],
     'LANG':'C.UTF-8','DISABLE_SCHEDULER':'false',
     'ALLOWED_ORIGINS':'http://127.0.0.1:'+port,
     'PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID':'qa-local',
     'PEOPLE_CREDENTIAL_RETRY_KEYS_JSON':json.dumps({'qa-local':secrets.token_hex(32)}),
     'MFA_ENCRYPTION_KEY':secrets.token_hex(32),
     'MEDIA_ROOT':str(run/'media'),'FINANCE_INTAKE_ROOT':str(run/'intakes'),
     'REPORT_ARTIFACT_ROOT':str(run/'reports')}
with(run/'environment.json').open('x')as f:
    os.chmod(f.name,0o600);json.dump(env,f)
runner='''#!/usr/bin/env python3
from pathlib import Path
import json,os,sys,socket
root=Path(__file__).resolve().parent
env=json.loads((root/'environment.json').read_text())
port=PORT
probe=socket.socket();probe.bind(('127.0.0.1',port));probe.close()
args=[str(root/'server'),'-db',str(root/'qa.sqlite'),'-addr','127.0.0.1:'+str(port),'-frontend',str(root/'frontend-dist')]
if sys.argv[1:]==['--first-seed']:
    if(root/'qa.sqlite').exists():raise SystemExit('first seed requires absent database')
    args.append('--demo')
elif sys.argv[1:]:raise SystemExit('unsupported argument')
os.chdir(REPO_BACKEND)
os.execve(args[0],args,env)
'''.replace('PORT',repr(int(port))).replace('REPO_BACKEND',repr(str(repo/'backend')))
(run/'run.py').write_text(runner);os.chmod(run/'run.py',0o700)
restart='#!/usr/bin/env bash\nset -euo pipefail\nexec python3 "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/run.py"\n'
(run/'restart.sh').write_text(restart);os.chmod(run/'restart.sh',0o700)
PY
(cd -- "$qa_repo_root/backend" && go build -o "$qa_run_root/server" ./cmd/server)
(cd -- "$qa_repo_root/frontend" && VITE_API_URL='' VITE_DATA_MODE=api NODE_ENV=production npm run build -- --outDir "$qa_run_root/frontend-dist")
printf 'Disposable fictional QA URL: http://127.0.0.1:%s\nPrivate run directory: %s\nRestart: %s/restart.sh\nCtrl+C stops only this foreground fixture.\n' "$qa_port" "$qa_run_root" "$qa_run_root"
exec python3 "$qa_run_root/run.py" --first-seed
