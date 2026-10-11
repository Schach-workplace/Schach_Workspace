"""Synthetic contract checks; never starts servers, reads real DSNs, or touches DBs."""
import ast
import importlib.util
import json
import subprocess
import sys
import tempfile
import types
import unittest
import urllib.parse
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
class RuntimeContractTests(unittest.TestCase):
    def test_default_command_children_scrub_foreign_application_options(self):
        for name in ['planning_goals_runtime.py', 'people_runtime.py', 'intelligence_standalone.py', 'intelligence_encore.py']:
            tree = ast.parse((ROOT/'verification/runtime'/name).read_text())
            function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ['cmd', 'command'])
            spec = importlib.util.spec_from_file_location('runtime_contract', ROOT/'verification/runtime/runtime_contract.py'); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
            calls = []
            def run(*args, **kwargs):
                calls.append(kwargs); return types.SimpleNamespace(returncode=0)
            with tempfile.TemporaryDirectory() as tmp:
                namespace = dict(ROOT=Path(tmp), out=Path(tmp), os=types.SimpleNamespace(environ={'PATH':'/synthetic-tools', 'INTELLIGENCE_ENABLED':'true', 'DATABASE_URL':'foreign', 'TEST_DATABASE_URL':'foreign'}), subprocess=types.SimpleNamespace(run=run, STDOUT=subprocess.STDOUT), scrub_runtime_env=module.scrub_runtime_env)
                exec(compile(ast.Module(body=[function], type_ignores=[]), name, 'exec'), namespace)
                namespace[function.name](['synthetic-child'])
                self.assertEqual(calls[-1]['env'], {'PATH':'/synthetic-tools'}, name)
                owned = {'PATH':'/owned-tools', 'INTELLIGENCE_ENABLED':'false'}
                namespace[function.name](['synthetic-child'], env=owned)
                self.assertEqual(calls[-1]['env'], owned, name)
    def test_incompatible_calendar_flags_rejected_before_output_or_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'must-not-exist'
            result = subprocess.run([sys.executable, str(ROOT/'verification/runtime/planning_goals_runtime.py'), '--output', str(output), '--allow-demo-mutations', '--calendar-civil-only', '--browser'], env={'PATH': '/usr/bin:/bin'}, capture_output=True)
            self.assertEqual(result.returncode, 2, result.stderr.decode())
            self.assertFalse(output.exists())
    def test_owning_environment_functions_remove_inherited_application_settings(self):
        inherited = dict(PATH='/tools', HOME='/home/synthetic', TEST_DATABASE_URL='synthetic', DB_PASSWORD='synthetic', DB_POOL_SIZE='999', FINANCE_OCR_ENABLED='true', INTELLIGENCE_ENABLED='true', PEOPLE_CREDENTIAL_RETRY_KEYS_JSON='synthetic', REPORT_ARTIFACT_ROOT='/foreign', COMMUNICATION_ROOT='/foreign', LIVEKIT_API_KEY='synthetic', APNS_KEY_ID='synthetic', FCM_SERVICE_ACCOUNT_FILE='/foreign', MFA_ENCRYPTION_KEY='synthetic', BOOTSTRAP_PASSWORD='synthetic', DATABASE_URL='synthetic', MEDIA_ROOT='/foreign', CLAMAV_ADDRESS='foreign', SECURE_COOKIES='true', ENVIRONMENT='production', ALLOWED_ORIGINS='foreign', DISABLE_SCHEDULER='false', SESSION_HOURS='1')
        for name in ['planning_goals_runtime.py', 'people_runtime.py']:
            tree = ast.parse((ROOT/'verification/runtime'/name).read_text())
            function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'env_for')
            namespace = dict(os=types.SimpleNamespace(environ=inherited), urllib=types.SimpleNamespace(parse=urllib.parse), json=json, out=Path('/synthetic-owned'), credential_key='synthetic-fresh')
            helper = ROOT/'verification/runtime/runtime_contract.py'
            if helper.exists():
                spec = importlib.util.spec_from_file_location('runtime_contract', helper); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                namespace['scrub_runtime_env'] = module.scrub_runtime_env
            exec(compile(ast.Module(body=[function], type_ignores=[]), name, 'exec'), namespace)
            actual = namespace['env_for']()
            self.assertEqual(actual['PATH'], inherited['PATH'])
            self.assertEqual(actual['HOME'], inherited['HOME'])
            for key in ['TEST_DATABASE_URL', 'DB_PASSWORD', 'DB_POOL_SIZE', 'COMMUNICATION_ROOT', 'LIVEKIT_API_KEY', 'MFA_ENCRYPTION_KEY', 'BOOTSTRAP_PASSWORD', 'DATABASE_URL', 'CLAMAV_ADDRESS', 'ENVIRONMENT']:
                self.assertNotIn(key, actual, (name, key))
            self.assertEqual(actual['DISABLE_SCHEDULER'], 'true')
            for key in ['INTELLIGENCE_ENABLED', 'FINANCE_OCR_ENABLED', 'FINANCE_PDF_ENABLED']: self.assertEqual(actual[key], 'false')
    def test_inventory_validates_contiguous_pairs_and_exact_mirror_checksums(self):
        spec = importlib.util.spec_from_file_location('runtime_contract', ROOT/'verification/runtime/runtime_contract.py'); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for owner in ['backend/migrations', 'encore/api/migrations']:
                (root/owner).mkdir(parents=True)
                for version in [1, 2]:
                    for direction in ['up', 'down']:
                        (root/owner/f'{version}_synthetic.{direction}.sql').write_text(f'-- {version} {direction}\n')
            inventory = module.migration_inventory(root)
            self.assertEqual(len(inventory['up']), 2)
            self.assertEqual(inventory['maximum'], 2)
            self.assertEqual(len(inventory['sha256']), 4)
            path = root/'encore/api/migrations/2_synthetic.down.sql'; path.write_text('-- wrong\n')
            with self.assertRaises(ValueError): module.migration_inventory(root)
            path.unlink()
            with self.assertRaises(ValueError): module.migration_inventory(root)
            for owner in ['backend/migrations', 'encore/api/migrations']:
                for direction in ['up', 'down']:
                    (root/owner/f'2_synthetic.{direction}.sql').unlink(missing_ok=True)
                    (root/owner/f'3_synthetic.{direction}.sql').write_text('-- gap\n')
            with self.assertRaises(ValueError): module.migration_inventory(root)
if __name__ == '__main__': unittest.main()
