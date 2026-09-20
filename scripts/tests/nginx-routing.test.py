#!/usr/bin/env python3
"""Verify the installer's real Nginx template on isolated loopback ports (Linux)."""
import http.server
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)


def available_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class API(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"path": self.path, "proto": self.headers.get("X-Forwarded-Proto")}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def main():
    for command in ("bash", "nginx", "openssl", "curl"):
        if not shutil.which(command):
            raise SystemExit(f"Missing {command}; run this check on Linux with Nginx installed.")
    installer = Path(__file__).resolve().parents[1] / "install.sh"
    source = installer.read_text()
    function = source.split("render_nginx() {\n", 1)[1].split("\napply_nginx() {", 1)[0]
    function = "render_nginx() {\n" + function + "\nrender_nginx\n"
    api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), API)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    nginx = None
    try:
        with tempfile.TemporaryDirectory(prefix="infocus-nginx-test-") as directory:
            work = Path(directory)
            root = work / "app"
            dist = root / "current/frontend/dist"
            (dist / "assets").mkdir(parents=True)
            (dist / "index.html").write_text("<!doctype html><div>INFOCUS routing fixture</div>")
            (dist / "assets/app-fixture.js").write_text("console.log('INFOCUS');")
            challenge = root / "acme/.well-known/acme-challenge"
            challenge.mkdir(parents=True)
            (challenge / "fixture").write_text("challenge-ok")
            cert, key = work / "cert.pem", work / "key.pem"
            run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=assets.example.test", "-addext",
                "subjectAltName=DNS:assets.example.test,DNS:first.example.test,DNS:second.example.test,DNS:unknown.example.test",
                "-keyout", str(key), "-out", str(cert))
            env = {**os.environ, "MARKER": "# Test fixture", "DOMAIN": "assets.example.test",
                   "ROOT": str(root), "CERT": str(cert), "KEY": str(key), "PORT": str(api.server_port)}
            site = run("bash", input=function, env=env).stdout
            http_port, https_port = available_port(), available_port()
            site = site.replace("listen 80;", f"listen 127.0.0.1:{http_port};")
            site = site.replace("listen 443 ssl;", f"listen 127.0.0.1:{https_port} ssl;")
            site = site.replace("listen [::]:80;", f"listen [::1]:{http_port};")
            site = site.replace("listen [::]:443 ssl;", f"listen [::1]:{https_port} ssl;")
            enabled = work / "sites-enabled"
            enabled.mkdir()
            for filename, host, body, ipv6 in [
                ("growtogether", "first.example.test", "EXISTING-FIRST", False),
                ("servit", "second.example.test", "EXISTING-SECOND", True),
            ]:
                blocks = []
                for port, secure in [(http_port, False), (https_port, True)]:
                    suffix = " ssl" if secure else ""
                    listeners = f"listen 127.0.0.1:{port}{suffix};"
                    if ipv6:
                        listeners += f"listen [::1]:{port}{suffix};"
                    blocks.append(f"""server {{
                        {listeners}
                        server_name {host};
                        ssl_certificate {cert};
                        ssl_certificate_key {key};
                        location / {{ return 200 '{body}'; }}
                    }}""")
                (enabled / filename).write_text("\n".join(blocks))
            config = work / "nginx.conf"
            config.write_text(f"""pid {work}/nginx.pid;
error_log {work}/error.log;
events {{ worker_connections 64; }}
http {{
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path {work}/client;
  proxy_temp_path {work}/proxy;
  fastcgi_temp_path {work}/fastcgi;
  uwsgi_temp_path {work}/uwsgi;
  scgi_temp_path {work}/scgi;
  include {enabled}/*;
}}
""")
            run("nginx", "-t", "-p", str(work), "-c", str(config))
            nginx = subprocess.Popen(["nginx", "-p", str(work), "-c", str(config), "-g", "daemon off;"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(50):
                    try:
                        with socket.create_connection(("127.0.0.1", https_port), timeout=0.2):
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise AssertionError("Isolated Nginx did not start: " + (work / "error.log").read_text())

                def request(route, secure=True, host="assets.example.test", ipv6=False):
                    port = https_port if secure else http_port
                    scheme = "https" if secure else "http"
                    response = run("curl", "--silent", "--show-error", "--max-time", "5", "--noproxy", "*",
                                   "--cacert", str(cert), "--resolve", f"{host}:{port}:" + ("[::1]" if ipv6 else "127.0.0.1"),
                                   "-w", "\n%{http_code}", f"{scheme}://{host}:{port}{route}").stdout
                    return response.rsplit("\n", 1)

                baselines = {}
                for secure in (False, True):
                    for host, ipv6, expected in [
                        ("first.example.test", False, "EXISTING-FIRST"),
                        ("second.example.test", False, "EXISTING-SECOND"),
                        ("second.example.test", True, "EXISTING-SECOND"),
                        ("unknown.example.test", False, "EXISTING-FIRST"),
                        ("unknown.example.test", True, "EXISTING-SECOND"),
                    ]:
                        value = request("/", secure, host, ipv6)
                        assert value == [expected, "200"], (host, secure, ipv6)
                        baselines[(secure, host, ipv6)] = value
                master_pid = (work / "nginx.pid").read_text().strip()
                (enabled / "zz-infocus-assets.conf").write_text(site)
                run("nginx", "-t", "-p", str(work), "-c", str(config))
                nginx.send_signal(signal.SIGHUP)
                for _ in range(50):
                    if request("/login")[0] == (dist / "index.html").read_text():
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError("New INFOCUS site did not become ready after graceful reload")
                assert nginx.poll() is None and (work / "nginx.pid").read_text().strip() == master_pid
                for (secure, host, ipv6), expected in baselines.items():
                    assert request("/", secure, host, ipv6) == expected, (host, secure, ipv6)
                for route in ("/login", "/assets/00000000-0000-0000-0000-000000000000"):
                    body, status = request(route)
                    assert status == "200" and body == (dist / "index.html").read_text(), route
                body, status = request("/api/health?fixture=1")
                assert status == "200" and json.loads(body) == {"path": "/api/health?fixture=1", "proto": "https"}
                assert request("/assets/app-fixture.js") == ["console.log('INFOCUS');", "200"]
                assert request("/assets/missing.js")[1] == "404"
                assert request("/.env")[1] == "403"
                assert request("/.well-known/acme-challenge/fixture", False) == ["challenge-ok", "200"]
                assert request("/login", False)[1] == "301"
                print("PASS: Two existing apps and IPv4/IPv6 implicit default hosts preserved across graceful reload; Nginx master unchanged; INFOCUS HTTPS, API, SPA, static files, hidden files, ACME and HTTP redirect.")
            finally:
                if nginx.poll() is None:
                    nginx.terminate()
                    try:
                        nginx.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        nginx.kill()
                        nginx.wait(timeout=5)
    finally:
        api.shutdown()
        api.server_close()


if __name__ == "__main__":
    main()
