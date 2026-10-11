"""Source-only inventory and child-process isolation for owned disposable fixtures."""
import hashlib
from pathlib import Path
PREFIXES = ('FINANCE_', 'INTELLIGENCE_', 'PEOPLE_', 'REPORT_', 'COMMUNICATION_', 'LIVEKIT_', 'APNS_', 'FCM_', 'MFA_', 'BOOTSTRAP_', 'DB_', 'MEDIA_', 'AUTH_', 'DEPLOYMENT_', 'TEST_')
NAMES = {'DATABASE_URL', 'CLAMAV_ADDRESS', 'SEED_DEMO', 'SECURE_COOKIES', 'ENVIRONMENT', 'ALLOWED_ORIGINS', 'SESSION_HOURS', 'DISABLE_SCHEDULER', 'SERVICE_API_KEY'}
def scrub_runtime_env(source):
    return {key: value for key, value in source.items() if not key.startswith(PREFIXES) and key not in NAMES}
def migration_inventory(root):
    root = Path(root)
    primary = root/'backend/migrations'
    mirror = root/'encore/api/migrations'
    up = sorted(primary.glob('*.up.sql'), key=lambda path: int(path.name.split('_')[0]))
    versions = [int(path.name.split('_')[0]) for path in up]
    if not versions or versions != list(range(1, len(versions)+1)):
        raise ValueError('Migration versions must be unique and contiguous from 1')
    selected = [path for file in up for path in (file, file.with_name(file.name.replace('.up.sql', '.down.sql')))]
    names = {path.name for path in selected}
    if names != {p.name for p in primary.glob('*.sql')} or names != {p.name for p in mirror.glob('*.sql')}:
        raise ValueError('Migration up/down inventory differs or has extra files')
    hashes = {}
    for path in selected:
        peer = mirror/path.name
        if path.is_symlink() or peer.is_symlink() or not path.is_file() or not peer.is_file() or path.read_bytes() != peer.read_bytes():
            raise ValueError('Migration mirror differs: '+path.name)
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'up': up, 'maximum': versions[-1], 'sha256': hashes}
