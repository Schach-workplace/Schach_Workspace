"""Synthetic release isolation; never archives the real workspace."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('package_release', Path(__file__).with_name('package_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseIsolation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binding = patch.object(release, 'ROOT', self.root)
        self.binding.start()
        self.addCleanup(self.binding.stop)

    def write(self, name, value=b'synthetic'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
        return path

    def selected(self):
        return {p.relative_to(self.root).as_posix() for p in release.files()}

    def test_required_sources_and_demo_flag_remain_selected(self):
        required = ['shared/business/types.ts', 'mobile/src/Workspace.tsx', 'mobile/package-lock.json', 'frontend/dist/index.html', 'backend/migrations/58_test.up.sql', 'encore/api/migrations/58_test.up.sql', 'frontend/.env.example', 'frontend/.env.demo']
        for name in required:
            self.write(name, b'VITE_DATA_MODE=demo\n' if name.endswith('.env.demo') else b'synthetic')
        self.assertTrue(set(required) <= self.selected())
        self.write('frontend/.env.demo', b'VITE_DATA_MODE=demo\nPRIVATE=unexpected\n')
        with self.assertRaisesRegex(SystemExit, 'unexpected settings'):
            self.selected()

    def test_git_pointer_and_nested_worktrees_are_excluded(self):
        self.write('.git', b'gitdir: /synthetic-private/worktree')
        self.write('.worktrees/foreign/backend/config.json')
        self.write('nested/.worktrees/foreign/data/private.json')
        self.write('nested/.git/config')
        self.write('README.md')
        self.assertEqual(self.selected(), {'README.md'})

    def test_selected_file_and_directory_symlinks_are_refused(self):
        for directory in [False, True]:
            with self.subTest(directory=directory):
                target = self.root / ('targetdir' if directory else 'targetfile')
                if directory:
                    target.mkdir()
                else:
                    target.write_bytes(b'synthetic')
                link = self.root / 'selected'
                link.symlink_to(target, target_is_directory=directory)
                try:
                    with self.assertRaisesRegex(SystemExit, 'Refusing a symlink'):
                        self.selected()
                finally:
                    link.unlink()

    def test_demo_symlink_refused_before_reading_target(self):
        link = self.root / 'frontend/.env.demo'
        link.parent.mkdir()
        link.symlink_to(self.root / 'unreadable-nonexistent-target')
        with self.assertRaisesRegex(SystemExit, 'Refusing a symlink'):
            self.selected()

    def test_ignored_directory_symlink_is_never_read(self):
        (self.root / '.worktrees').symlink_to(self.root / 'nonexistent', target_is_directory=True)
        self.write('README.md')
        self.assertEqual(self.selected(), {'README.md'})


if __name__ == '__main__':
    unittest.main()
