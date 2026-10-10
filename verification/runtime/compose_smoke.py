#!/usr/bin/env python3
"""Build and verify Compose using newly owned volumes and fictional credentials."""
from __future__ import annotations

import argparse
import json
import secrets
import socket
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='Private evidence directory; logs may contain fictional fixture data')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    project = 'schach-communication-check-' + secrets.token_hex(6)
    private = out / (project + '.env')
    with private.open('x') as fixture:
        private.chmod(0o600)
        fixture.write('POSTGRES_PASSWORD=' + secrets.token_urlsafe(32) + '\n'
                      'BOOTSTRAP_EMAIL=compose-check@example.invalid\n'
                      'BOOTSTRAP_NAME=Disposable Local Check\n'
                      'BOOTSTRAP_PASSWORD=' + secrets.token_urlsafe(32) + '\n'
                      'MFA_ENCRYPTION_KEY=' + secrets.token_hex(32) + '\n')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    override = out / (project + '-override.yaml')
    override.write_text('services:\n  app:\n    ports: !override\n'
                        f'      - "127.0.0.1:{port}:8080"\n')
    command = ['docker', 'compose', '-p', project, '--env-file', str(private),
               '-f', str(ROOT / 'compose.yaml'), '-f', str(override)]
    result = {'status': 'failed', 'checks': [], 'cleanup': 'not started'}
    started = False

    def run(arguments, log):
        with (out / log).open('wb') as output:
            subprocess.run(command + arguments, cwd=ROOT, stdout=output,
                           stderr=subprocess.STDOUT, check=True, timeout=600)

    try:
        run(['config', '--quiet'], 'config.log')
        result['checks'].append('Compose config validates')
        run(['build', 'app', 'migrate'], 'build.log')
        result['checks'].append('Docker builds current web and both Go binaries')
        started = True
        run(['up', '-d', '--wait', '--wait-timeout', '150', 'app'], 'up.log')
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=15) as response:
            if response.status != 200:
                raise RuntimeError('App health did not pass')
        query = subprocess.run(command + ['exec', '-T', 'db', 'psql', '-U', 'schach',
            '-d', 'schach_workspace', '-At', '-c',
            'SELECT max(version),count(*) FROM schach_schema_migrations;'],
            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
        expected = len(list((ROOT / 'backend/migrations').glob('*.up.sql')))
        observed = query.stdout.strip()
        (out / 'migrations.log').write_text(observed + '\n')
        if observed != f'{expected}|{expected}':
            raise RuntimeError('Fresh migration ledger is incomplete: ' + observed)
        result['migration_versions'] = expected
        result['checks'].append('All versioned migrations execute before app health')
        run(['exec', '-T', 'app', 'sh', '-c',
             'test "$(id -u)" != 0 && test -w /app/media'], 'media-permissions.log')
        result['checks'].append('Non-root app can write private mounted media')
        result['status'] = 'passed'
    finally:
        try:
            if started:
                try:
                    run(['logs', '--no-color', 'app', 'migrate'], 'runtime.log')
                finally:
                    run(['down', '-v', '--remove-orphans'], 'cleanup.log')
                result['cleanup'] = 'owned project, volumes and network removed'
        finally:
            private.unlink(missing_ok=True)
            override.unlink(missing_ok=True)
            (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))


if __name__ == '__main__':
    main()
