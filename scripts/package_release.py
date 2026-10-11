#!/usr/bin/env python3
"""Create a source release with compiled UI, excluding local data and dependencies."""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import os
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP_DIRS = {'.git', '.worktrees', '.superpowers', 'node_modules', '.encore', 'bin', 'test-results', 'playwright-report', 'coverage', '__pycache__', '.pytest_cache', '.expo', '.gradle', '.idea'}
SKIP_NAMES = {'.git', '.worktrees', '.env', '.env.local', '.secrets.local.cue', '.DS_Store', 'RELEASE_MANIFEST.sha256'}
SKIP_SUFFIXES = {'.db', '.db-shm', '.db-wal', '.log', '.pyc', '.zip', '.keystore', '.jks', '.p8', '.pem', '.apk', '.aab', '.ipa'}


def files():
    for directory, folders, names in os.walk(ROOT):
        base = pathlib.Path(directory)
        relative_dir = base.relative_to(ROOT)
        folders[:] = sorted(folder for folder in folders if folder not in SKIP_DIRS and not (relative_dir == pathlib.Path('mobile') and folder in {'android', 'ios', 'dist'}) and not (relative_dir == pathlib.Path('deploy') and folder == 'secrets') and not (relative_dir == pathlib.Path('.') and folder == 'data') and not (relative_dir.parts[:1] == ('verification',) and folder == 'logs'))
        for folder in folders:
            path = base / folder
            if path.is_symlink():
                raise SystemExit(f'Refusing a symlink in the release: {path.relative_to(ROOT)}')
        for name in sorted(names):
            path = base / name
            relative = path.relative_to(ROOT)
            # This checked, non-secret build flag is required to reproduce the
            # offline demo. Every other local dotenv file remains excluded.
            demo_build_flag = relative.as_posix() == 'frontend/.env.demo'
            if name in SKIP_NAMES or name.startswith('.env') and name != '.env.example' and not demo_build_flag or name.startswith('encore.gen.') or relative.as_posix() == 'deploy/livekit.yaml' or path.suffix in SKIP_SUFFIXES or name.endswith(('.db-shm', '.db-wal')):
                continue
            if path.is_symlink():
                raise SystemExit(f'Refusing a symlink in the release: {relative}')
            if demo_build_flag and path.read_bytes() != b'VITE_DATA_MODE=demo\n':
                raise SystemExit('Demo build config contains unexpected settings')
            yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT.parent/'Schach_Workspace.zip')
    args = parser.parse_args()
    # Validate selected paths before required-file or migration content reads.
    source = list(files())
    required = ['README.md', 'docs/VERIFICATION.md', 'docs/OPERATIONS.md', 'preview.html', 'frontend/dist/index.html', 'frontend/src/data/demo.ts', 'frontend/src/data/api.ts', 'frontend/src/data/sample.json', 'frontend/src/store.tsx', 'backend/go.mod', 'encore/go.mod', 'backend/migrations/2_department_finance.up.sql', 'frontend/src/pages/Finance.tsx', 'frontend/src/data/demo-finance.ts', 'docs/FINANCE_GUIDE.md', 'docs/FINANCE_UPGRADE.md', 'docs/COMMUNICATION_IMPLEMENTATION.md', 'docs/COMMUNICATION_OPERATIONS.md', 'mobile/README.md', 'mobile/package.json', 'mobile/package-lock.json', 'verification/communication-2026-10-10/result.json', 'frontend/.env.demo', 'mobile/src/Workspace.tsx', 'mobile/plugins/withCallService.js', 'backend/cmd/migrate/main.go', 'backend/migrations/24_communication_exports.up.sql']
    for name in required:
        if not (ROOT/name).is_file():
            raise SystemExit(f'Build the deliverable first: missing {name}')
    for path in (ROOT/'backend/migrations').glob('*.sql'):
        peer = ROOT/'encore/api/migrations'/path.name
        if not peer.is_file() or peer.read_bytes() != path.read_bytes():
            raise SystemExit(f'Migration mirror differs: {path.name}')
    included = {path.relative_to(ROOT).as_posix() for path in source}
    if not set(required).issubset(included):
        raise SystemExit(f'Required source excluded: {set(required)-included}')
    manifest = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(ROOT).as_posix()}\n' for path in source)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in source:
            archive.write(path, 'Schach_Workspace/'+path.relative_to(ROOT).as_posix())
        archive.writestr('Schach_Workspace/RELEASE_MANIFEST.sha256', manifest)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise SystemExit('Archive integrity check failed')
        for line in manifest.splitlines():
            digest, relative = line.split('  ', 1)
            if hashlib.sha256(archive.read('Schach_Workspace/'+relative)).hexdigest() != digest:
                raise SystemExit(f'Archive content verification failed: {relative}')
    print(f'Created {output}: {len(source)+1} files, {output.stat().st_size:,} bytes')
    print(f'SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
