#!/usr/bin/env python3
"""Exercise the install wizard through a real terminal; never deploy or contact a DB."""
import errno
import os
from pathlib import Path
import pty
import select
import shlex
import subprocess
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


def terminal_run(arguments, answers, cwd=ROOT, script=None):
    master, slave = pty.openpty()
    settings = termios.tcgetattr(slave)
    settings[3] &= ~termios.ECHO
    termios.tcsetattr(slave, termios.TCSANOW, settings)
    process = subprocess.Popen(["bash", str(script or ROOT / "install.sh"), *arguments],
                               stdin=slave, stdout=slave, stderr=slave, cwd=cwd, start_new_session=True)
    os.close(slave)
    output = bytearray()
    try:
        os.write(master, answers.encode())
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    output.extend(chunk)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
            elif process.poll() is not None:
                break
        else:
            raise AssertionError("Wizard timed out: " + output.decode(errors="replace"))
        return process.wait(timeout=3), output.decode(errors="replace")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
        os.close(master)


class InstallInputTests(unittest.TestCase):
    def test_four_defaults_produce_preview_without_email(self):
        status, output = terminal_run(["--interactive", "--dry-run"], "\n\n\n\n")
        self.assertEqual(status, 0, output)
        self.assertIn("assets.infocuscs.com; API 5002; PostgreSQL 5432; trusted HTTPS: true", output)
        self.assertIn("HTTPS: Let's Encrypt", output)
        self.assertNotIn("Certificate contact email:", output)
        self.assertNotIn("Checking installed prerequisites", output)

    def test_invalid_fields_retry_in_order(self):
        answers = "https://invalid/path\nassets.infocuscs.com\n80\n65536\n5002\nwrong\n5432\nmaybe\nyes\n"
        status, output = terminal_run(["--interactive", "--dry-run"], answers)
        self.assertEqual(status, 0, output)
        for error in ["Enter a hostname", "Enter an API port", "Enter a PostgreSQL port", "Enter yes or no"]:
            self.assertIn(error, output)
        self.assertNotIn("Certificate contact email:", output)

    def test_custom_values_and_no_certificate_skip_email(self):
        status, output = terminal_run(["--interactive", "--dry-run"], "assets.other.test\n6002\n5433\nno\n")
        self.assertEqual(status, 0, output)
        self.assertIn("assets.other.test; API 6002; PostgreSQL 5433; trusted HTTPS: false", output)
        self.assertNotIn("Certificate contact email:", output)

    def test_end_of_input_aborts_before_execution(self):
        status, output = terminal_run(["--interactive", "--dry-run"], "\n\n\n\x04")
        self.assertNotEqual(status, 0, output)
        self.assertIn("Input ended before setup was complete", output)
        self.assertNotIn("Dry run: no changes", output)
        self.assertNotIn("Checking installed prerequisites", output)

    def test_explicit_values_are_not_prompted_again(self):
        status, output = terminal_run(["--interactive", "--dry-run", "--domain", "assets.explicit.test",
                                      "--port", "6001", "--db-port", "5434", "--letsencrypt"], "")
        self.assertEqual(status, 0, output)
        self.assertNotIn("Application hostname [", output)
        self.assertNotIn("Internal API port [", output)
        self.assertNotIn("Enable trusted HTTPS", output)
        self.assertNotIn("Certificate contact email:", output)
        self.assertIn("assets.explicit.test; API 6001; PostgreSQL 5434", output)

    def test_noninteractive_https_does_not_require_email(self):
        result = subprocess.run(["bash", str(ROOT / "install.sh"), "--domain", "assets.infocuscs.com",
                                 "--letsencrypt", "--dry-run"], stdin=subprocess.DEVNULL,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("HTTPS: Let's Encrypt", result.stdout)

    def test_certificate_account_arguments_default_to_no_email(self):
        source = (ROOT / "scripts/install.sh").read_text()
        function = source.split("certificate_account_args() {", 1)[1].split("\n}", 1)[0]
        for email, expected in [("", ["--register-unsafely-without-email"]),
                                ("ops@example.com", ["--email", "ops@example.com"])]:
            with self.subTest(email=email):
                result = subprocess.run(["bash", "-c", "set -euo pipefail\nEMAIL=" + shlex.quote(email)
                                         + "\ncertificate_account_args() {" + function
                                         + '\n}\ncertificate_account_args\nprintf "%s\\n" "${CERTBOT_ACCOUNT_ARGS[@]}"'],
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines(), expected)

    def test_explicit_optional_email_is_validated(self):
        for email, expected in [("ops@example.com", 0), ("invalid-email", 1)]:
            with self.subTest(email=email):
                result = subprocess.run(["bash", str(ROOT / "install.sh"), "--domain", "assets.infocuscs.com",
                                         "--letsencrypt", "--email", email, "--dry-run"],
                                        stdin=subprocess.DEVNULL, text=True, capture_output=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                if expected:
                    self.assertIn("--email must be a valid contact address", result.stderr)

    def test_flags_and_launcher_work_without_a_terminal_from_another_directory(self):
        with tempfile.TemporaryDirectory(prefix="infocus launcher with spaces ") as directory:
            result = subprocess.run(["bash", str(ROOT / "install.sh"), "--domain", "assets.infocuscs.com",
                                     "--port", "5002", "--db-port", "5432", "--dry-run"],
                                    cwd=directory, stdin=subprocess.DEVNULL, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("API port: 5002; PostgreSQL port: 5432", result.stdout)
            result = subprocess.run(["bash", str(ROOT / "install.sh"), "--help"], cwd=directory,
                                    stdin=subprocess.DEVNULL, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("sudo bash install.sh", result.stdout)

    def test_interactive_mode_requires_a_terminal(self):
        result = subprocess.run(["bash", str(ROOT / "install.sh"), "--interactive", "--dry-run"],
                                stdin=subprocess.DEVNULL, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Interactive setup needs a terminal", result.stderr)

    @unittest.skipUnless(os.geteuid() == 0, "root needed to exercise the real sudo/no-arguments path")
    def test_zero_arguments_launch_the_wizard_and_eof_cancels(self):
        status, output = terminal_run([], "\x04")
        self.assertNotEqual(status, 0)
        self.assertIn("Application hostname [assets.infocuscs.com]", output)
        self.assertIn("Input ended before setup was complete", output)
        self.assertNotIn("Checking installed prerequisites", output)

    @unittest.skipUnless(os.geteuid() == 0, "managed configuration requires root ownership")
    def test_rerun_retains_managed_settings_without_disclosing_credentials(self):
        with tempfile.TemporaryDirectory(prefix="infocus rerun with spaces ") as directory:
            fixture = Path(directory)
            config = fixture / "configuration"
            config.mkdir()
            marker = "# Managed by infocus-assets installer\n"
            (config / "app.env").write_text(marker + "APP_URL=https://assets.existing.test\nPORT=6007\nJWT_SECRET=fixture-secret-never-printed\n")
            (config / "maintenance.env").write_text(marker + "PG_ADMIN_PORT=5439\nDATABASE_URL=fixture-credential-never-printed\n")
            script = fixture / "install fixture.sh"
            script.write_text((ROOT / "scripts/install.sh").read_text().replace("CONFIG=/etc/infocus-assets", "CONFIG=" + shlex.quote(str(config)), 1))
            status, output = terminal_run(["--interactive", "--dry-run"], "no\n", cwd=fixture, script=script)
            self.assertEqual(status, 0, output)
            self.assertIn("assets.existing.test; API 6007; PostgreSQL 5439", output)
            self.assertNotIn("Application hostname [", output)
            self.assertNotIn("fixture-secret", output)
            self.assertNotIn("fixture-credential", output)
            status, output = terminal_run(["--interactive", "--dry-run", "--port", "5999"], "\x04", cwd=fixture, script=script)
            self.assertNotEqual(status, 0)
            self.assertIn("existing API port cannot be changed", output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
