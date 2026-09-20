#!/usr/bin/env python3
"""Linux root-only regression for the installer's administrator subprocess cwd.

Run: sudo python3 scripts/tests/installer-admin-launch.test.py
Extracts only bootstrap_admin() from the real installer. Uses temporary fixtures
and the existing nobody account; never runs installation, Node, services or SQL.
"""
import errno
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

try:
    import pwd
except ImportError:
    pwd = None


ROOT = Path(__file__).resolve().parents[2]
LINUX_ROOT = sys.platform.startswith("linux") and getattr(os, "geteuid", lambda: -1)() == 0


@unittest.skipUnless(LINUX_ROOT, "Linux root is required for the real runuser permission regression")
class InstallerAdminLaunchTests(unittest.TestCase):
    def setUp(self):
        for command in ("bash", "runuser", "true"):
            if not shutil.which(command):
                self.skipTest(f"Missing required Linux command: {command}")
        try:
            self.account = pwd.getpwnam("nobody")
        except KeyError:
            self.skipTest("An existing nobody account is required; this test never creates users")
        self.assertNotEqual(self.account.pw_uid, 0)
        source = (ROOT / "scripts/install.sh").read_text(encoding="utf-8")
        match = re.search(r"^bootstrap_admin\(\) \{\n.*?^\}", source, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(match, "Installer must expose its actual bootstrap_admin() helper for regression coverage")
        self.function = match.group(0)
        self.temp = tempfile.TemporaryDirectory(prefix="infocus admin launch ")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        # Traversable by nobody through its group, but not writable by it.
        os.chown(self.work, 0, self.account.pw_gid)
        self.work.chmod(0o750)
        self.release = self.work / "root owned release"
        self.backend = self.release / "backend"
        self.tsx = self.release / "node_modules/tsx/dist/cli.mjs"
        self.bootstrap = self.backend / "scripts/bootstrap-installer-admin.ts"
        self.config = self.work / "private configuration"
        self.env_file = self.config / "app.env"
        self.caller = self.work / "private caller home"
        self.node = self.work / "fake node"
        self.probe = self.work / "launch probe.py"
        for file in (self.tsx, self.bootstrap):
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("// Read-only bootstrap launch fixture.\n", encoding="utf-8")
            file.chmod(0o644)
        for directory in (self.release, *self.release.rglob("*")):
            if directory.is_dir():
                directory.chmod(0o755)
            self.assertEqual(directory.stat().st_uid, 0)
        self.config.mkdir()
        os.chown(self.config, 0, self.account.pw_gid)
        self.config.chmod(0o750)
        self.env_file.write_text("PROBE_RESULT=existing-admin\n", encoding="utf-8")
        os.chown(self.env_file, 0, self.account.pw_gid)
        self.env_file.chmod(0o640)
        self.caller.mkdir()
        self.caller.chmod(0o750)
        # Keep caller's group root: a sudo-launched process may inherit this cwd,
        # but nobody cannot traverse it (like /home/ubuntu 750 or /root 700).
        os.chown(self.caller, 0, 0)
        expected = {
            "uid": self.account.pw_uid,
            "cwd": str(self.backend),
            "release": str(self.release),
            "env_file": str(self.env_file),
            "arguments": [f"--env-file={self.env_file}", str(self.tsx), str(self.bootstrap)],
            "true": shutil.which("true"),
        }
        probe = r'''
import errno, json, os, subprocess, sys
from pathlib import Path
expected = json.loads(EXPECTED_JSON)
# This is the same OS operation responsible for esbuild's spawn EACCES:
# resolving and entering an explicit child cwd after privileges were dropped.
try:
    subprocess.run([expected["true"]], cwd=os.getcwd(), check=True, timeout=5)
except OSError as error:
    if error.errno == errno.EACCES:
        print("PROBE_SPAWN_EACCES", file=sys.stderr)
        sys.exit(errno.EACCES)
    raise
assert os.geteuid() == expected["uid"], "bootstrap did not drop privileges"
assert os.getcwd() == expected["cwd"], "bootstrap inherited the caller directory"
assert sys.argv[1:] == expected["arguments"], "bootstrap arguments or path quoting changed"
assert os.environ.get("HOME") == "/var/lib/infocus-assets", "service HOME changed"
assert os.environ.get("PATH"), "service PATH is missing"
for key in ("CALLER_SECRET", "DATABASE_URL", "NODE_OPTIONS", "PYTHONPATH"):
    assert key not in os.environ, "caller environment leaked into the service process"
allowed = {"HOME", "PATH", "PWD", "SHLVL", "_", "LC_CTYPE"}
assert set(os.environ) <= allowed, "unexpected inherited environment variables"
for filename in [expected["release"], expected["cwd"], expected["env_file"], *sys.argv[2:]]:
    item = Path(filename)
    assert item.stat().st_uid == 0, "bootstrap fixture is not root-owned"
    assert os.access(item, os.R_OK), "bootstrap fixture is not readable by service account"
    assert not os.access(item, os.W_OK), "service account can modify release or config"
result = Path(expected["env_file"]).read_text().strip().split("=", 1)[1]
if result == "failure":
    print("PROBE_EXPECTED_FAILURE", file=sys.stderr)
    sys.exit(73)
assert result in ("created", "existing-admin")
print(result)
'''.replace("EXPECTED_JSON", repr(json.dumps(expected)))
        self.probe.write_text(probe, encoding="utf-8")
        self.probe.chmod(0o644)
        # This executable replaces only Node; real runuser/env/cwd permission
        # behavior is exercised. Use absolute interpreter/probe paths throughout.
        self.node.write_text("#!/bin/sh\nexec " + shlex.quote(sys.executable) + " "
                             + shlex.quote(str(self.probe)) + ' "$@"\n', encoding="utf-8")
        self.node.chmod(0o755)
        self.shell_env = {
            **os.environ,
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "CALLER_SECRET": "fixture-secret-must-not-be-inherited",
            "DATABASE_URL": "fixture-db-must-not-be-inherited",
            "NODE_OPTIONS": "--require=caller-injected-module",
            "PYTHONPATH": "caller-injected-python-path",
        }
        # Do not let an inherited shell startup file run during this regression.
        for key in ("BASH_ENV", "ENV", "LD_PRELOAD"):
            self.shell_env.pop(key, None)

    def run_shell(self, body):
        values = {
            "RELEASE": str(self.release), "APP": "nobody", "NODE": str(self.node),
            "ENV_FILE": str(self.env_file),
        }
        script = "set -Eeuo pipefail\n" + "\n".join(
            key + "=" + shlex.quote(value) for key, value in values.items()
        ) + "\n" + body + "\n"
        return subprocess.run(["bash", "-c", script], cwd=self.caller, env=self.shell_env,
                              stdin=subprocess.DEVNULL, text=True, capture_output=True, timeout=15)

    def test_old_inherited_private_cwd_reproduces_real_spawn_eacces(self):
        # Negative control: the original launch, without the helper's cd.
        original = ('runuser -u "$APP" -- env -i HOME=/var/lib/infocus-assets PATH="$PATH" '
                    '"$NODE" --env-file="$ENV_FILE" "$RELEASE/node_modules/tsx/dist/cli.mjs" '
                    '"$RELEASE/backend/scripts/bootstrap-installer-admin.ts"')
        for mode in (0o750, 0o700):
            with self.subTest(caller_mode=oct(mode)):
                self.caller.chmod(mode)
                result = self.run_shell(original)
                self.assertEqual(result.returncode, errno.EACCES, result.stderr)
                self.assertIn("PROBE_SPAWN_EACCES", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_actual_helper_uses_readable_backend_cwd_and_preserves_machine_output(self):
        for mode, status in ((0o750, "created"), (0o700, "existing-admin")):
            with self.subTest(caller_mode=oct(mode), status=status):
                self.caller.chmod(mode)
                self.env_file.write_text(f"PROBE_RESULT={status}\n", encoding="utf-8")
                result = self.run_shell(self.function + '\noriginal_pwd=$PWD\nbootstrap_admin\n'
                                        '[[ "$PWD" == "$original_pwd" ]]')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, status + "\n")
                self.assertEqual(result.stderr, "")
                self.assertFalse((self.release / "probe-write").exists())

    def test_actual_helper_propagates_bootstrap_failure_without_success_output(self):
        self.env_file.write_text("PROBE_RESULT=failure\n", encoding="utf-8")
        result = self.run_shell(self.function + "\nbootstrap_admin")
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "PROBE_EXPECTED_FAILURE\n")


if __name__ == "__main__":
    unittest.main(verbosity=2)
