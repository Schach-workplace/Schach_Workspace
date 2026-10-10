#!/usr/bin/env python3
"""Run real Encore in an isolated source copy with owned disposable namespaces."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True, help='Evidence directory (contains runtime logs; keep private)')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
output = args.output.resolve()
checks = []
result = {'status': 'failed', 'checks': checks, 'limitations': ['Managed cron, production TLS/private ingress and deployed proxy are separate deployment gates.']}
processes = []
app_id = None


def command(cmd, cwd, env=None, filename='commands.log'):
    with (output / filename).open('ab') as log:
        subprocess.run(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=180)


def call(base, method, path, body=None, headers=None):
    headers = headers or {}
    if body is not None:
        body = json.dumps(body).encode()
        headers = {**headers, 'Content-Type': 'application/json'}
    request = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


def start(cwd, namespace, seed=False, refusal=False):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = dict(os.environ)
    env.pop('SEED_DEMO', None)
    env.pop('ENVIRONMENT', None)
    env.pop('MEDIA_ROOT', None)
    env.pop('CLAMAV_ADDRESS', None)
    for name in list(env):
        if name.startswith(('COMMUNICATION_', 'LIVEKIT_', 'APNS_', 'FCM_', 'MFA_')):
            env.pop(name)
    if seed:
        env['SEED_DEMO'] = 'true'
    log_path = output / f'{namespace}-{len(processes)}.log'
    with log_path.open('wb') as log:
        process = subprocess.Popen(['encore', 'run', '--namespace', namespace, '--browser', 'never', '--watch=false', '--port', str(port)], cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    processes.append(process)
    base = f'http://127.0.0.1:{port}'
    for _ in range(180):
        try:
            status, _, _ = call(base, 'GET', '/api/health')
            if status == 200:
                assert not refusal, 'Weak/missing bootstrap unexpectedly started'
                return process, base
        except (OSError, TimeoutError):
            pass
        log_text = log_path.read_text(errors='replace')
        if refusal and ('Password must contain' in log_text or 'empty database:' in log_text):
            stop(process)
            return process, None
        if process.poll() is not None:
            raise RuntimeError(f'Encore exited during startup; inspect {log_path.name}')
        time.sleep(0.5)
    stop(process)
    raise RuntimeError(f'Encore startup timed out; inspect {log_path.name}')

def communication_check(base):
    status, body, headers = call(base, 'POST', '/api/auth/login', {'email':'founder@schach.demo','password':'SchachDemo!2026'})
    assert status == 200
    owner_cookie = headers.get('Set-Cookie').split(';')[0]
    session=json.loads(body);cid=session['companies'][0]['id'];owner=session['user']['id']
    password=secrets.token_urlsafe(24);email='runtime-chat@example.invalid'
    status,body,_=call(base,'POST',f'/api/companies/{cid}/people',{'name':'Runtime participant','email':email,'password':password,'role':'member','capacityHours':40},{'Cookie':owner_cookie})
    assert status==200;member=json.loads(body)['id']
    status,body,headers=call(base,'POST','/api/auth/login',{'email':email,'password':password});assert status==200
    member_cookie=headers.get('Set-Cookie').split(';')[0]
    status,body,_=call(base,'POST',f'/api/companies/{cid}/conversations',{'title':'Runtime private group','kind':'group','participantIds':[owner,member]},{'Cookie':owner_cookie});assert status==200
    conv=json.loads(body)['id'];config={'Base':base,'Company':cid,'Conversation':conv,'Member':member,'OwnerCookie':owner_cookie,'MemberCookie':member_cookie}
    with (output/'stream.log').open('wb') as log:
        subprocess.run(['go','run',str(ROOT/'verification/runtime/stream_check.go')],cwd=ROOT/'backend',input=json.dumps(config).encode(),stdout=log,stderr=subprocess.STDOUT,check=True,timeout=90)
    checks.append('Real Encore WebSocket through reverse proxy: origin/hints/removal')
    return cid,conv,owner_cookie

def communication_restart_check(base,state):
    cid,conv,cookie=state;path=f'/api/companies/{cid}/conversations/{conv}/messages'
    status,body,_=call(base,'POST',path,{'clientMessageId':'runtime-persisted','body':'Runtime private marker'},{'Cookie':cookie});assert status==200
    message=json.loads(body)['message']['id']
    status,body,_=call(base,'GET',path,headers={'Cookie':cookie});assert status==200
    rows=json.loads(body)['messages'];assert len(rows)==1 and rows[0]['id']==message
    checks.append('Acknowledged message and retry ID survive actual Encore process restart')

try:
    with tempfile.TemporaryDirectory(prefix='schach-encore-smoke-') as temporary:
        root = Path(temporary)
        ignore = shutil.ignore_patterns('.encore', '.superpowers', '.secrets.local.cue', 'encore.gen.*', 'node_modules', 'bin', '*.db*')
        for directory in ('backend', 'encore'):
            shutil.copytree(ROOT / directory, root / directory, ignore=ignore)
        cwd = root / 'encore'
        configuration = cwd / 'api/config.cue'
        configuration.write_text(configuration.read_text().replace('BootstrapEmail: ""', 'BootstrapEmail: "bootstrap@example.invalid"'))
        override = cwd / '.secrets.local.cue'
        secret = secrets.token_urlsafe(32)
        override.write_text('BootstrapPassword: ' + json.dumps(secret) + '\n')
        override.chmod(0o600)
        for namespace in ('smoke-demo', 'smoke-bootstrap', 'smoke-weak'):
            command(['encore', 'namespace', 'create', namespace], cwd)
        app_id = json.loads((cwd / '.encore/manifest.json').read_text())['local_id']
        command(['encore', 'namespace', 'switch', 'smoke-demo'], cwd)
        command(['encore', 'check'], cwd, {**os.environ, 'SEED_DEMO': 'true'}, 'check.log')
        checks.append('Actual Encore analyzer/check succeeds')
        demo, base = start(cwd, 'smoke-demo', seed=True)
        for headers in ({}, {'X-Encore-Cron-Execution': 'spoof'}):
            status, _, _ = call(base, 'POST', '/api.RunScheduled', {}, headers)
            assert status == 403, f'Local scheduled invocation returned {status}'
        checks.append('Direct and spoofed cron invocations rejected')
        command(['python3', str(ROOT / 'verification/runtime/tcp_scenarios.py'), '--url', base, '--api-only', '--allow-demo-mutations', '--report', str(output / 'api-result.json')], ROOT, filename='api.log')
        api = json.loads((output / 'api-result.json').read_text())
        assert api['status'] == 'passed' and api['workspaceChecks'] >= 38 and api['financeChecks'] >= 53
        checks.append('Workspace/finance API scenarios pass over native Encore TCP')
        communication_state=communication_check(base)
        stop(demo)
        override.write_text('BootstrapPassword: "short"\n')
        start(cwd, 'smoke-weak', refusal=True)
        checks.append('Non-demo bootstrap refuses weak password')
        override.write_text('BootstrapPassword: ' + json.dumps(secret) + '\n')
        bootstrap, base = start(cwd, 'smoke-bootstrap')
        status, body, headers = call(base, 'POST', '/api/auth/login', {'email': 'bootstrap@example.invalid', 'password': secret})
        assert status == 200
        identity = json.loads(body)['user']['id']
        cookie = headers.get('Set-Cookie').split(';')[0]
        stop(bootstrap)
        override.write_text('BootstrapPassword: ' + json.dumps(secrets.token_urlsafe(32)) + '\n')
        bootstrap, base = start(cwd, 'smoke-bootstrap')
        status, body, _ = call(base, 'GET', '/api/auth/session', headers={'Cookie': cookie})
        assert status == 200 and json.loads(body)['user']['id'] == identity
        status, body, _ = call(base, 'POST', '/api/auth/login', {'email': 'bootstrap@example.invalid', 'password': secret})
        assert status == 200 and json.loads(body)['user']['id'] == identity
        checks.append('Strong bootstrap succeeds; account and session survive restart without password reset')
        stop(bootstrap)
        demo, base = start(cwd, 'smoke-demo', seed=True)
        status, _, _ = call(base, 'GET', '/api/health')
        assert status == 200
        checks.append('Populated demo database survives restart')
        communication_restart_check(base,communication_state)
        stop(demo)
        command(['go', 'test', './...'], cwd, filename='sdk.log')
        checks.append('Generated-wrapper SDK compilation succeeds')
        result['status'] = 'passed'
finally:
    for process in processes:
        stop(process)
    if app_id:
        listing = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}'], capture_output=True, text=True, check=True).stdout.splitlines()
        owned = [name for name in listing if name.startswith('sqldb-' + app_id + '-')]
        if owned:
            subprocess.run(['docker', 'rm', '-f', '--volumes', *owned], stdout=subprocess.DEVNULL, check=True)
        result['ownedDatabaseContainersRemoved'] = len(owned)
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
